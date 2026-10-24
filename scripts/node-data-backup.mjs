import { temporaryRoots } from '../lib/node/temporary-roots.mjs';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, rmdir, symlink, unlink, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const databaseName = 'hirehire.sqlite';
const objectsDirectory = 'private-objects';
const photoPattern = /^private-objects\/intake-photos\/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/;
const maximumPhotoBytes = 2 * 1024 * 1024;
const maximumManifestBytes = 32 * 1024 * 1024;
// Fixed original source migrations, not arbitrary SQL supplied by a backup.
const migrationChain = Object.freeze([
  { name: '0000_parched_betty_ross.sql', sha256: '961b6edcec35c84b0abd1fff613be3a5d8b4fa3691c0107fcee4cf57d8e74954' },
  { name: '0001_handy_robbie_robertson.sql', sha256: 'ed55b672db12efc6677801e4fb217b3965f37033ea69314c0b36381567cc5edd' },
]);
const businessTables = ['candidate_publications', 'intake_photos', 'intake_rate_limits', 'intake_records', 'record_matches', 'site_settings'];

export class DataBackupError extends Error {
  constructor(code, message) { super(message); this.name = 'DataBackupError'; this.code = code; }
}
const fail = (code, message) => { throw new DataBackupError(code, message); };

function inside(path, directory) {
  const remainder = relative(directory, path);
  return remainder === '' || remainder !== '..' && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder);
}

function safeRoot(input, testing) {
  if (typeof input !== 'string' || !isAbsolute(input) || input.includes('\\') || input.includes('\0')) fail('INVALID_ROOT', 'An absolute private root is required.');
  const root = resolve(input);
  if (root === sep || root.split(sep).some(part => ['public', 'release', 'releases', 'dist', '.next', '.git', 'node_modules'].includes(part))) fail('INVALID_ROOT', 'Private roots must be outside public and release directories.');
  const forbidden = [...(testing ? [] : [resolve(process.cwd()), ...temporaryRoots]), '/dev', '/proc', '/sys', '/run', '/var/run'];
  if (forbidden.some(path => inside(root, path))) fail('INVALID_ROOT', 'A private persistent root outside the application release is required.');
  return root;
}

function safeSqliteVersion(version) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) return false;
  const [major, minor, patch] = version.split('.').map(Number);
  return [major, minor, patch].every(Number.isSafeInteger) && (major > 3 || major === 3 && (minor > 51 || minor === 51 && patch >= 3 || minor === 50 && patch >= 7 || minor === 44 && patch >= 6));
}

function sqliteVersion() {
  let version = process.versions.sqlite;
  if (!version) {
    const probe = new DatabaseSync(':memory:');
    try { version = probe.prepare('SELECT sqlite_version() AS version').get().version; }
    finally { probe.close(); }
  }
  if (!safeSqliteVersion(version)) fail('UNSAFE_SQLITE', 'SQLite must include the verified WAL-reset fix: >=3.51.3, 3.50.7+, or 3.44.6+.');
  return version;
}

async function existing(path) {
  try { return await lstat(path); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function directoryTree(path, create = false) {
  const rootOwner = (await lstat(sep)).uid;
  let cursor = sep;
  for (const part of path.split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    let stat = await existing(cursor);
    if (!stat && create) {
      try { await mkdir(cursor, { mode: 0o700 }); }
      catch (error) { if (error?.code !== 'EEXIST') throw error; }
      stat = await lstat(cursor);
    }
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) fail('UNSAFE_DIRECTORY', 'Private directory trees cannot contain links or missing directories.');
    if (typeof process.getuid !== 'function' || stat.uid !== rootOwner && stat.uid !== process.getuid()) fail('UNSAFE_DIRECTORY', 'Directory parents must be controlled by root or the service user.');
    if ((stat.mode & 0o022) && !(['/tmp', '/var/tmp'].includes(cursor) && (stat.mode & 0o1000))) fail('UNSAFE_DIRECTORY', 'Directory parents must not be writable by other users.');
  }
  if (await realpath(path) !== path) fail('UNSAFE_DIRECTORY', 'The private directory path changed.');
}

async function privateDirectory(path) {
  await directoryTree(path);
  const stat = await lstat(path);
  if (stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700) fail('UNSAFE_DIRECTORY', 'Run as the service owner; private directories must use mode 0700.');
  return stat;
}

function privateFile(stat, maximum = Number.MAX_SAFE_INTEGER) {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600) fail('UNSAFE_FILE', 'Private files must be service-owned regular files, mode 0600, with one link.');
  if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > maximum) fail('UNSAFE_FILE', 'A private file exceeds its permitted byte limit.');
}

function unchanged(a, b) { return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs; }
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function hashOrCopy(source, destination, maximum = Number.MAX_SAFE_INTEGER) {
  const before = await lstat(source);
  privateFile(before, maximum);
  let input, output;
  try {
    input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await input.stat();
    privateFile(opened, maximum);
    if (!unchanged(before, opened)) fail('SOURCE_CHANGED', 'Source changed during opening; keep writes stopped and retry.');
    if (destination) output = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const digest = createHash('sha256');
    let position = 0;
    while (position < opened.size) {
      const buffer = new Uint8Array(Math.min(1024 * 1024, opened.size - position));
      const { bytesRead } = await input.read(buffer, 0, buffer.byteLength, position);
      if (!bytesRead) fail('SOURCE_CHANGED', 'Source was truncated during copying.');
      digest.update(buffer.subarray(0, bytesRead));
      if (output) {
        let offset = 0;
        while (offset < bytesRead) {
          const { bytesWritten } = await output.write(buffer, offset, bytesRead - offset);
          if (!bytesWritten) fail('COPY_FAILED', 'Private file copy did not complete.');
          offset += bytesWritten;
        }
      }
      position += bytesRead;
    }
    if (!unchanged(opened, await input.stat()) || !unchanged(opened, await lstat(source))) fail('SOURCE_CHANGED', 'Source changed during copying; keep writes stopped and retry.');
    if (output) { await output.chmod(0o600); await output.sync(); }
    return { bytes: opened.size, sha256: digest.digest('hex') };
  } finally {
    try { if (input) await input.close(); }
    finally { if (output) await output.close(); }
  }
}

async function inventory(root, backup = false) {
  await privateDirectory(root);
  const allowed = new Set(backup ? [databaseName, objectsDirectory, 'manifest.json'] : [databaseName, `${databaseName}-wal`, `${databaseName}-shm`, `${databaseName}-journal`, objectsDirectory]);
  const top = (await readdir(root)).sort();
  if (!top.includes(databaseName) || !top.includes(objectsDirectory) || top.some(name => !allowed.has(name))) fail('UNRECOGNIZED_FILES', 'Private root contains missing or unrecognized files; preserve it for review.');
  const databaseFiles = top.filter(name => name !== objectsDirectory && name !== 'manifest.json');
  for (const name of databaseFiles) privateFile(await lstat(join(root, name)));
  const objectRoot = join(root, objectsDirectory);
  await privateDirectory(objectRoot);
  const groups = await readdir(objectRoot);
  if (groups.length !== 1 || groups[0] !== 'intake-photos') fail('UNRECOGNIZED_FILES', 'The private object prefix must be the reviewed intake photo prefix.');
  const photos = join(objectRoot, 'intake-photos');
  await privateDirectory(photos);
  const objectFiles = (await readdir(photos)).sort().map(name => `${objectsDirectory}/intake-photos/${name}`);
  for (const name of objectFiles) {
    if (!photoPattern.test(name)) fail('UNRECOGNIZED_FILES', 'Unknown object keys or incomplete uploads require review before backup.');
    privateFile(await lstat(join(root, name)), maximumPhotoBytes);
  }
  return { databaseFiles, objectFiles };
}

function validateSchema(database) {
  const columns = {
    intake_records: ['id', 'reference', 'kind', 'data_json', 'search_text', 'status', 'notes', 'created_at', 'updated_at', 'idempotency_hash', 'request_hash', 'original_data_json', 'next_follow_up', 'photo_id', 'requested_candidate_ids'],
    intake_rate_limits: ['key', 'attempts', 'expires_at'],
    candidate_publications: ['id', 'intake_id', 'profile_json', 'state', 'created_at', 'updated_at'],
    intake_photos: ['id', 'token_hash', 'object_key', 'content_type', 'byte_length', 'expires_at', 'attached_record_id', 'created_at'],
    record_matches: ['id', 'employer_id', 'jobseeker_id', 'stage', 'notes', 'interview_at', 'created_at', 'updated_at'],
    site_settings: ['id', 'info_json', 'updated_at'],
    _hirehire_migrations: ['name', 'sha256', 'applied_at'],
  };
  const nullable = new Set(['intake_records.original_data_json', 'intake_photos.attached_record_id']);
  const integers = new Set(['intake_rate_limits.attempts', 'intake_rate_limits.expires_at', 'intake_photos.byte_length', 'intake_photos.expires_at']);
  const defaults = {
    'intake_records.status': "'新登記'", 'intake_records.notes': "''", 'intake_records.next_follow_up': "''", 'intake_records.photo_id': "''", 'intake_records.requested_candidate_ids': "'[]'",
    'candidate_publications.state': "'draft'", 'record_matches.stage': "'待聯絡'", 'record_matches.notes': "''", 'record_matches.interview_at': "''",
  };
  const indexes = {
    intake_records: [['intake_reference_unique', 1, ['reference']], ['intake_idempotency_unique', 1, ['idempotency_hash']], ['intake_created_index', 0, ['created_at']], ['intake_kind_status_index', 0, ['kind', 'status']]],
    candidate_publications: [['candidate_intake_unique', 1, ['intake_id']], ['candidate_state_updated_index', 0, ['state', 'updated_at']]],
    intake_photos: [['photo_expiry_index', 0, ['expires_at']]],
    record_matches: [['match_pair_unique', 1, ['employer_id', 'jobseeker_id']], ['match_stage_index', 0, ['stage']]],
  };
  const foreignKeys = { candidate_publications: ['intake_id'], intake_photos: ['attached_record_id'], record_matches: ['employer_id', 'jobseeker_id'] };
  for (const [table, expected] of Object.entries(columns)) {
    const actual = database.prepare(`PRAGMA table_info(${table})`).all();
    if (actual.length !== expected.length || actual.some((row, index) => {
      const key = `${table}.${row.name}`;
      return row.name !== expected[index] || row.type.toUpperCase() !== (integers.has(key) ? 'INTEGER' : 'TEXT') || row.notnull !== (nullable.has(key) ? 0 : 1) || row.pk !== (index === 0 ? 1 : 0) || row.dflt_value !== (defaults[key] ?? null);
    })) fail('DATABASE_SCHEMA', 'Snapshot columns do not match the immutable reviewed schema.');
    const expectedIndexes = indexes[table] || [], actualIndexes = database.prepare(`PRAGMA index_list(${table})`).all().filter(row => row.origin !== 'pk');
    if (actualIndexes.length !== expectedIndexes.length || expectedIndexes.some(([name, unique, names]) => {
      const definition = actualIndexes.find(row => row.name === name), fields = database.prepare(`PRAGMA index_info(${name})`).all();
      return !definition || definition.unique !== unique || definition.partial !== 0 || fields.length !== names.length || fields.some((row, index) => row.name !== names[index]);
    })) fail('DATABASE_SCHEMA', 'Snapshot indexes do not match the immutable reviewed schema.');
    const expectedForeignKeys = foreignKeys[table] || [], actualForeignKeys = database.prepare(`PRAGMA foreign_key_list(${table})`).all();
    if (actualForeignKeys.length !== expectedForeignKeys.length || actualForeignKeys.some(row => !expectedForeignKeys.includes(row.from) || row.table !== 'intake_records' || row.to !== 'id' || row.on_delete !== 'CASCADE' || row.on_update !== 'NO ACTION')) fail('DATABASE_SCHEMA', 'Snapshot foreign-key definitions do not match the immutable reviewed schema.');
  }
}

function validateDatabase(path, files) {
  let database;
  try {
    database = new DatabaseSync(path, { readOnly: true, enableForeignKeyConstraints: true, allowExtension: false });
    const integrity = database.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') fail('DATABASE_INTEGRITY', 'SQLite integrity validation failed.');
    if (database.prepare('PRAGMA foreign_key_check').get()) fail('DATABASE_FOREIGN_KEYS', 'SQLite foreign-key validation failed.');
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' ORDER BY name").all().map(row => row.name);
    if (JSON.stringify(tables) !== JSON.stringify(['_hirehire_migrations', ...businessTables].sort())) fail('DATABASE_SCHEMA', 'The snapshot must contain exactly the reviewed business tables and migration journal.');
    if (database.prepare("SELECT name FROM sqlite_master WHERE type IN ('trigger', 'view') LIMIT 1").get()) fail('DATABASE_SCHEMA', 'Unreviewed database views or triggers are not supported.');
    validateSchema(database);
    const applied = database.prepare('SELECT name, sha256, applied_at FROM _hirehire_migrations ORDER BY name').all();
    if (applied.length !== migrationChain.length || applied.some((row, index) => row.name !== migrationChain[index].name || row.sha256 !== migrationChain[index].sha256 || typeof row.applied_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.applied_at))) fail('DATABASE_JOURNAL', 'The immutable migration journal does not match the reviewed chain.');
    const invalidJson = database.prepare(`SELECT COUNT(*) AS total FROM intake_records WHERE NOT json_valid(data_json) OR (original_data_json IS NOT NULL AND NOT json_valid(original_data_json)) OR NOT json_valid(requested_candidate_ids) OR json_type(requested_candidate_ids) != 'array'`).get().total;
    if (invalidJson || database.prepare('SELECT 1 FROM candidate_publications WHERE NOT json_valid(profile_json) LIMIT 1').get() || database.prepare('SELECT 1 FROM site_settings WHERE NOT json_valid(info_json) LIMIT 1').get()) fail('DATABASE_JSON', 'The snapshot contains invalid stored JSON.');
    if (database.prepare("SELECT 1 FROM intake_records WHERE kind NOT IN ('employer', 'jobseeker') LIMIT 1").get() || database.prepare("SELECT 1 FROM candidate_publications p LEFT JOIN intake_records i ON i.id = p.intake_id WHERE i.id IS NULL OR i.kind != 'jobseeker' OR p.state NOT IN ('draft', 'published', 'paused') LIMIT 1").get() || database.prepare("SELECT 1 FROM record_matches m LEFT JOIN intake_records e ON e.id = m.employer_id LEFT JOIN intake_records j ON j.id = m.jobseeker_id WHERE e.id IS NULL OR j.id IS NULL OR e.kind != 'employer' OR j.kind != 'jobseeker' LIMIT 1").get()) fail('DATABASE_RELATIONSHIPS', 'Business record relationships are invalid.');
    if (database.prepare("SELECT 1 FROM intake_records i LEFT JOIN intake_photos ph ON ph.id = i.photo_id WHERE i.photo_id != '' AND (ph.id IS NULL OR ph.attached_record_id IS NULL OR ph.attached_record_id != i.id OR i.kind != 'jobseeker') LIMIT 1").get() || database.prepare("SELECT 1 FROM intake_photos ph LEFT JOIN intake_records i ON i.id = ph.attached_record_id WHERE ph.attached_record_id IS NOT NULL AND (i.id IS NULL OR i.photo_id != ph.id OR i.kind != 'jobseeker') LIMIT 1").get()) fail('DATABASE_RELATIONSHIPS', 'Photo ownership relationships are invalid.');
    const objectFiles = new Map(files.filter(file => file.name !== databaseName).map(file => [file.name, file]));
    for (const row of database.prepare('SELECT id, object_key, byte_length, content_type, token_hash, expires_at FROM intake_photos').all()) {
      const name = `${objectsDirectory}/${row.object_key}`, object = objectFiles.get(name);
      if (!photoPattern.test(name) || row.object_key !== `intake-photos/${row.id}` || !object || object.bytes !== row.byte_length || !['image/jpeg', 'image/png'].includes(row.content_type) || !/^[a-f\d]{64}$/.test(row.token_hash) || !Number.isSafeInteger(row.expires_at) || row.expires_at < 0) fail('DATABASE_OBJECTS', 'Photo metadata does not match the complete private object inventory.');
    }
  } catch (error) {
    if (error instanceof DataBackupError) throw error;
    fail('DATABASE_VALIDATION', 'The database snapshot cannot be validated.');
  } finally { database?.close(); }
}

async function stageFor(destination) {
  if (await existing(destination)) fail('DESTINATION_EXISTS', 'The destination must be new and nonexistent; an active directory is never overwritten.');
  const parent = dirname(destination);
  await directoryTree(parent, true);
  const stage = join(parent, `.${basename(destination)}.hirehire-stage-${randomUUID()}`);
  await mkdir(stage, { mode: 0o700 });
  try {
    await privateDirectory(stage);
    for (const directory of [join(stage, objectsDirectory), join(stage, objectsDirectory, 'intake-photos')]) await mkdir(directory, { mode: 0o700 });
    return stage;
  } catch (error) { await rm(stage, { recursive: true, force: true }); throw error; }
}

async function publishStage(stage, destination) {
  await directoryTree(dirname(destination));
  // Exclusive reservation prevents replacing any pre-existing destination. Rename
  // only replaces our own newly created empty reservation. A concurrent service
  // opening it would make it nonempty and cause rename to refuse the replacement.
  try { await mkdir(destination, { mode: 0o700 }); }
  catch (error) { if (error?.code === 'EEXIST') fail('DESTINATION_EXISTS', 'The destination appeared during preparation; nothing was overwritten.'); throw error; }
  const reservation = await privateDirectory(destination);
  try {
    const current = await privateDirectory(destination);
    if (current.dev !== reservation.dev || current.ino !== reservation.ino || (await readdir(destination)).length) fail('DESTINATION_CHANGED', 'The destination reservation changed; publication refused.');
    await rename(stage, destination);
    await syncDirectory(dirname(destination));
  } catch (error) {
    const current = await existing(destination);
    if (current && current.dev === reservation.dev && current.ino === reservation.ino && (await readdir(destination)).length === 0) await rmdir(destination);
    throw error;
  }
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || Object.keys(manifest).sort().join(',') !== 'createdAt,files,formatVersion,migrations,sqliteVersion') fail('MANIFEST_INVALID', 'The backup manifest format is invalid.');
  if (manifest.formatVersion !== 1 || typeof manifest.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(manifest.createdAt) || !safeSqliteVersion(manifest.sqliteVersion) || JSON.stringify(manifest.migrations) !== JSON.stringify(migrationChain) || !Array.isArray(manifest.files) || !manifest.files.length) fail('MANIFEST_INVALID', 'The backup manifest metadata or migration chain is invalid.');
  const names = new Set();
  for (const file of manifest.files) {
    if (!file || typeof file !== 'object' || Array.isArray(file) || Object.keys(file).sort().join(',') !== 'bytes,name,sha256' || typeof file.name !== 'string' || file.name !== databaseName && !photoPattern.test(file.name) || names.has(file.name) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.name !== databaseName && file.bytes > maximumPhotoBytes || typeof file.sha256 !== 'string' || !/^[a-f\d]{64}$/.test(file.sha256)) fail('MANIFEST_INVALID', 'A backup file entry is invalid, repeated or outside the private key namespace.');
    names.add(file.name);
  }
  if (!names.has(databaseName) || manifest.files.find(file => file.name === databaseName).bytes === 0) fail('MANIFEST_INVALID', 'A complete nonempty database snapshot is required.');
}

async function readManifest(root) {
  const path = join(root, 'manifest.json');
  const info = await hashOrCopy(path, undefined, maximumManifestBytes);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let bytes;
  try {
    const stat = await handle.stat();
    privateFile(stat, maximumManifestBytes);
    const chunks = []; let total = 0;
    while (true) {
      const buffer = new Uint8Array(64 * 1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > maximumManifestBytes) fail('MANIFEST_INVALID', 'The manifest exceeds its byte limit.');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    bytes = Buffer.concat(chunks, total);
  }
  finally { await handle.close(); }
  if (bytes.length !== info.bytes || sha(bytes) !== info.sha256) fail('SOURCE_CHANGED', 'The backup manifest changed during validation.');
  let manifest;
  try { manifest = JSON.parse(bytes.toString('utf8')); }
  catch { fail('MANIFEST_INVALID', 'The backup manifest is not valid JSON.'); }
  validateManifest(manifest);
  return { manifest, manifestSha256: info.sha256 };
}

async function verifyFileInventory(root, manifest) {
  const actual = await inventory(root, true);
  const expectedNames = manifest.files.map(file => file.name).sort();
  if (JSON.stringify([databaseName, ...actual.objectFiles].sort()) !== JSON.stringify(expectedNames)) fail('MANIFEST_FILES', 'Backup files do not match the complete manifest.');
  for (const file of manifest.files) {
    const actual = await hashOrCopy(join(root, file.name), undefined, file.name === databaseName ? Number.MAX_SAFE_INTEGER : maximumPhotoBytes);
    if (actual.bytes !== file.bytes || actual.sha256 !== file.sha256) fail('MANIFEST_HASH', 'A backup file size or checksum does not match.');
  }
}

export async function runDataBackup(action, options) {
  if (action !== 'backup' && action !== 'restore') fail('USAGE', 'Choose backup or restore.');
  if (options?.offlineConfirmed !== true) fail('OFFLINE_CONFIRMATION_REQUIRED', 'Stop the service and all public writes first, then provide --offline-confirmed true. This flag is an operator confirmation, not a process check.');
  const version = sqliteVersion();
  const dataRoot = safeRoot(options.dataRoot, options.allowTemporaryRootForTests === true);
  const backupRoot = safeRoot(options.backupRoot, options.allowTemporaryRootForTests === true);
  if (inside(dataRoot, backupRoot) || inside(backupRoot, dataRoot)) fail('ROOT_OVERLAP', 'Data and backup roots must be separate, nonoverlapping directories.');
  const destination = action === 'backup' ? backupRoot : dataRoot;
  if (await existing(destination)) fail('DESTINATION_EXISTS', 'The destination must be new and nonexistent; active data is never overwritten.');
  let stage;
  try {
    let manifest, manifestSha256;
    if (action === 'backup') {
      const originalInventory = await inventory(dataRoot);
      stage = await stageFor(destination);
      const cloneRoot = join(stage, '.snapshot-source');
      await mkdir(cloneRoot, { mode: 0o700 });
      const sourceFingerprints = [];
      for (const name of originalInventory.databaseFiles) {
        const info = await hashOrCopy(join(dataRoot, name), join(cloneRoot, name));
        sourceFingerprints.push({ name, ...info });
      }
      const files = [];
      for (const name of originalInventory.objectFiles) {
        const info = await hashOrCopy(join(dataRoot, name), join(stage, name), maximumPhotoBytes);
        files.push({ name, ...info }); sourceFingerprints.push({ name, ...info });
      }
      const snapshotPath = join(stage, databaseName);
      const empty = await open(snapshotPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await empty.close();
      let clone;
      try {
        // SQLite touches only the private copy, including any SHM read marks.
        // The original DB/WAL/SHM and photos are opened solely through fs reads.
        clone = new DatabaseSync(join(cloneRoot, databaseName), { readOnly: true, allowExtension: false });
        clone.prepare('VACUUM INTO ?').run(snapshotPath);
      } finally { clone?.close(); }
      const snapshotInfo = await hashOrCopy(snapshotPath);
      files.unshift({ name: databaseName, ...snapshotInfo });
      validateDatabase(snapshotPath, files);
      await rm(cloneRoot, { recursive: true });
      const finalInventory = await inventory(dataRoot);
      if (JSON.stringify(finalInventory) !== JSON.stringify(originalInventory)) fail('SOURCE_CHANGED', 'Source inventory changed; keep writes stopped and retry.');
      for (const file of sourceFingerprints) {
        const now = await hashOrCopy(join(dataRoot, file.name), undefined, photoPattern.test(file.name) ? maximumPhotoBytes : Number.MAX_SAFE_INTEGER);
        if (now.bytes !== file.bytes || now.sha256 !== file.sha256) fail('SOURCE_CHANGED', 'Source bytes changed; keep writes stopped and retry.');
      }
      manifest = { formatVersion: 1, createdAt: new Date().toISOString(), sqliteVersion: version, migrations: migrationChain, files };
      const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
      if (manifestBytes.byteLength > maximumManifestBytes) fail('MANIFEST_INVALID', 'The complete manifest exceeds the supported byte limit; no backup was promoted.');
      const output = await open(join(stage, 'manifest.json'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await output.writeFile(manifestBytes); await output.sync(); } finally { await output.close(); }
      manifestSha256 = sha(manifestBytes);
      await verifyFileInventory(stage, manifest);
    } else {
      await privateDirectory(backupRoot);
      const verified = await readManifest(backupRoot);
      manifest = verified.manifest; manifestSha256 = verified.manifestSha256;
      await verifyFileInventory(backupRoot, manifest);
      stage = await stageFor(destination);
      for (const file of manifest.files) {
        const info = await hashOrCopy(join(backupRoot, file.name), join(stage, file.name), file.name === databaseName ? Number.MAX_SAFE_INTEGER : maximumPhotoBytes);
        if (info.bytes !== file.bytes || info.sha256 !== file.sha256) fail('SOURCE_CHANGED', 'Backup changed while copying into the new data directory.');
      }
      validateDatabase(join(stage, databaseName), manifest.files);
      const restored = await inventory(stage);
      if (restored.databaseFiles.length !== 1 || JSON.stringify(restored.objectFiles) !== JSON.stringify(manifest.files.filter(file => file.name !== databaseName).map(file => file.name).sort())) fail('RESTORE_FILES', 'Restored files do not match the complete snapshot.');
      // Recheck the source manifest and all files before promotion. Restore does
      // not write a database journal, sidecar, manifest or lock in the backup.
      if ((await readManifest(backupRoot)).manifestSha256 !== manifestSha256) fail('SOURCE_CHANGED', 'Backup manifest changed during restore.');
      await verifyFileInventory(backupRoot, manifest);
    }
    for (const directory of [join(stage, objectsDirectory, 'intake-photos'), join(stage, objectsDirectory), stage]) await syncDirectory(directory);
    await publishStage(stage, destination);
    stage = null;
    return { status: 'succeeded', action, files: manifest.files.length, objects: manifest.files.length - 1, bytes: manifest.files.reduce((total, file) => total + file.bytes, 0), manifestSha256, sourceUnchanged: true, offlineConfirmedByOperator: true };
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true });
  }
}

function parseArguments(args) {
  const action = args[0];
  if (action !== 'backup' && action !== 'restore') fail('USAGE', 'Choose backup or restore.');
  const parsed = {};
  const allowed = new Map([['--data-root', 'dataRoot'], ['--backup-root', 'backupRoot'], ['--offline-confirmed', 'offlineConfirmed'], ['--allow-temporary-for-tests', 'allowTemporaryRootForTests']]);
  for (let index = 1; index < args.length; index += 2) {
    const name = allowed.get(args[index]), value = args[index + 1];
    if (!name || Object.hasOwn(parsed, name) || value === undefined) fail('USAGE', 'Arguments must use unique supported flags and explicit values.');
    if (name === 'offlineConfirmed' || name === 'allowTemporaryRootForTests') {
      if (!['true', 'false'].includes(value)) fail('USAGE', 'Confirmation flags require true or false.');
      parsed[name] = value === 'true';
    } else parsed[name] = value;
  }
  return { action, options: parsed };
}

const usage = `Stop the HireHire service and all public writes before either operation. Run as the private data directory's service owner. --offline-confirmed is a manual assertion; this tool does not stop processes or change runtime configuration.

node scripts/node-data-backup.mjs backup --data-root /data/hirehire --backup-root /data/hirehire-backups/NEW-NAME --offline-confirmed true
node scripts/node-data-backup.mjs restore --backup-root /data/hirehire-backups/SAVED-NAME --data-root /data/hirehire-restored/NEW-NAME --offline-confirmed true

Destinations must not exist. The complete private snapshot is verified and promoted from a new staging directory; no active root is overwritten. Restore verifies all sizes and SHA-256 hashes, SQLite integrity, foreign keys, the immutable migration journal and photo relationships. Original roots are preserved. Neither operation imports data from Sites or changes DNS, permissions, runtime environment or deployment.
Only synthetic local checks may add --allow-temporary-for-tests true. Do not use that flag in production.
`;

async function syntheticChecks() {
  sqliteVersion();
  const project = dirname(dirname(fileURLToPath(import.meta.url)));
  const evidenceRoot = join(project, 'work', 'gcp-migration');
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  const fixture = await mkdtemp(join(evidenceRoot, 'data-backup-fixture-'));
  const dataRoot = join(fixture, 'source'), backupRoot = join(fixture, 'backup'), restoredRoot = join(fixture, 'restored');
  const testing = { offlineConfirmed: true, allowTemporaryRootForTests: true };
  let source, checks = 0;
  const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
  const check = (value, label) => { assert(value, label); checks++; };
  const rejected = async (action, options, code) => { await assert.rejects(() => runDataBackup(action, options), error => error instanceof DataBackupError && error.code === code); checks++; };
  const fresh = name => join(fixture, `${name}-${randomUUID()}`);
  let successfulBackup, successfulRestore;
  try {
    for (const path of [dataRoot, join(dataRoot, objectsDirectory), join(dataRoot, objectsDirectory, 'intake-photos')]) await mkdir(path, { mode: 0o700 });
    const initial = await open(join(dataRoot, databaseName), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600); await initial.close();
    source = new DatabaseSync(join(dataRoot, databaseName));
    source.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA wal_autocheckpoint = 0;');
    for (const migration of migrationChain) {
      const sql = await readFile(join(project, 'drizzle', migration.name));
      equal(sha(sql), migration.sha256, 'Synthetic setup uses only the immutable reviewed SQL.');
      source.exec(sql.toString('utf8').replaceAll('--> statement-breakpoint', ''));
    }
    source.exec('CREATE TABLE _hirehire_migrations (name TEXT PRIMARY KEY NOT NULL, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL)');
    for (const migration of migrationChain) source.prepare('INSERT INTO _hirehire_migrations VALUES (?, ?, ?)').run(migration.name, migration.sha256, '2026-10-14T00:00:00.001Z');
    const seekerId = randomUUID(), employerId = randomUUID(), photoId = randomUUID(), pendingId = randomUUID();
    const originalJson = '{"z":"合成備份資料","a":true,"publicProfileConsent":false,"phone":"00000000"}';
    const insert = source.prepare('INSERT INTO intake_records (id, reference, kind, data_json, search_text, created_at, updated_at, idempotency_hash, request_hash, original_data_json, photo_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const syntheticTime = '2026-10-14T00:00:00.001Z';
    for (const [id, kind, photo] of [[seekerId, 'jobseeker', photoId], [employerId, 'employer', '']]) insert.run(id, `SYNTHETIC-${id}`, kind, originalJson, 'synthetic', syntheticTime, syntheticTime, sha(id), sha(`request-${id}`), originalJson, photo);
    source.prepare('INSERT INTO candidate_publications (id, intake_id, profile_json, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), seekerId, '{}', 'paused', syntheticTime, syntheticTime);
    source.prepare('INSERT INTO record_matches (id, employer_id, jobseeker_id, stage, notes, interview_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), employerId, seekerId, '待聯絡', 'SYNTHETIC_PRIVATE_NOTE', '', syntheticTime, syntheticTime);
    const portrait = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2]);
    for (const [id, attached] of [[photoId, seekerId], [pendingId, null]]) {
      await writeFile(join(dataRoot, objectsDirectory, 'intake-photos', id), portrait, { mode: 0o600 });
      source.prepare('INSERT INTO intake_photos (id, token_hash, object_key, content_type, byte_length, expires_at, attached_record_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, sha(`synthetic-token-${id}`), `intake-photos/${id}`, 'image/png', portrait.byteLength, attached ? 0 : 1900000000, attached, syntheticTime);
    }
    const rowSnapshot = Object.fromEntries(businessTables.map(table => [table, source.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]));
    const before = [];
    for (const name of [databaseName, `${databaseName}-wal`, `${databaseName}-shm`, `${objectsDirectory}/intake-photos/${photoId}`, `${objectsDirectory}/intake-photos/${pendingId}`]) before.push({ name, ...await hashOrCopy(join(dataRoot, name)) });
    check(before.find(file => file.name.endsWith('-wal')).bytes > 0, 'Committed synthetic records still exist in the source WAL.');
    await rejected('backup', { dataRoot, backupRoot, allowTemporaryRootForTests: true }, 'OFFLINE_CONFIRMATION_REQUIRED');
    equal(await existing(backupRoot), null, 'Missing offline confirmation does not create a destination.');
    await rejected('backup', { ...testing, dataRoot, backupRoot: join(dataRoot, 'nested') }, 'ROOT_OVERLAP');
    await rejected('backup', { ...testing, dataRoot, backupRoot: join(fixture, 'public', 'bad') }, 'INVALID_ROOT');
    successfulBackup = await runDataBackup('backup', { ...testing, dataRoot, backupRoot });
    equal(successfulBackup.objects, 2, 'Attached and pending private objects are both retained.');
    equal(successfulBackup.sourceUnchanged, true, 'Backup reports read-only original sources.');
    for (const file of before) equal(await hashOrCopy(join(dataRoot, file.name)), { bytes: file.bytes, sha256: file.sha256 }, 'Original DB, WAL, SHM and photos are byte-identical after backup.');
    const backupManifest = await readManifest(backupRoot);
    equal(backupManifest.manifestSha256, successfulBackup.manifestSha256, 'The complete saved manifest hash matches the receipt.');
    equal((await lstat(backupRoot)).mode & 0o777, 0o700, 'Backup root mode is private.');
    for (const file of backupManifest.manifest.files) equal((await lstat(join(backupRoot, file.name))).mode & 0o777, 0o600, 'Snapshot and object modes are private.');
    await rejected('backup', { ...testing, dataRoot, backupRoot }, 'DESTINATION_EXISTS');
    await rejected('restore', { ...testing, dataRoot, backupRoot }, 'DESTINATION_EXISTS');
    successfulRestore = await runDataBackup('restore', { ...testing, dataRoot: restoredRoot, backupRoot });
    const restored = new DatabaseSync(join(restoredRoot, databaseName), { readOnly: true });
    try {
      equal(Object.fromEntries(businessTables.map(table => [table, restored.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()])), rowSnapshot, 'Restored records, raw JSON, private notes, versions, pending tokens and matches are exact.');
      equal(restored.prepare('SELECT COUNT(*) AS total FROM _hirehire_migrations').get().total, 2, 'The original migration journal is restored, not regenerated.');
    } finally { restored.close(); }
    for (const file of backupManifest.manifest.files) equal(await hashOrCopy(join(restoredRoot, file.name)), { bytes: file.bytes, sha256: file.sha256 }, 'Every restored file matches the original manifest.');
    equal((await readManifest(backupRoot)).manifestSha256, successfulBackup.manifestSha256, 'Restore does not rewrite the backup manifest.');

    const manifestPath = join(backupRoot, 'manifest.json'), originalManifest = await readFile(manifestPath), databasePath = join(backupRoot, databaseName), originalDatabase = await readFile(databasePath);
    const photoPath = join(backupRoot, objectsDirectory, 'intake-photos', photoId);
    await writeFile(photoPath, new Uint8Array([1, 2, 3]), { mode: 0o600 });
    const tamperedPhotoTarget = fresh('tampered-photo');
    await rejected('restore', { ...testing, dataRoot: tamperedPhotoTarget, backupRoot }, 'MANIFEST_HASH');
    equal(await existing(tamperedPhotoTarget), null, 'A tampered object creates no restored root.');
    await writeFile(photoPath, portrait, { mode: 0o600 });
    const badNames = JSON.parse(originalManifest);
    badNames.files[1].name = '../escape';
    await writeFile(manifestPath, JSON.stringify(badNames), { mode: 0o600 });
    await rejected('restore', { ...testing, dataRoot: fresh('traversal'), backupRoot }, 'MANIFEST_INVALID');
    await writeFile(manifestPath, originalManifest, { mode: 0o600 });
    const duplicate = JSON.parse(originalManifest); duplicate.files.push({ ...duplicate.files[1] });
    await writeFile(manifestPath, JSON.stringify(duplicate), { mode: 0o600 });
    await rejected('restore', { ...testing, dataRoot: fresh('duplicate'), backupRoot }, 'MANIFEST_INVALID');
    await writeFile(manifestPath, originalManifest, { mode: 0o600 });
    const manifestForChangedDatabase = async () => {
      const altered = JSON.parse(originalManifest), info = await hashOrCopy(databasePath);
      Object.assign(altered.files.find(file => file.name === databaseName), info);
      await writeFile(manifestPath, JSON.stringify(altered), { mode: 0o600 });
    };
    const corrupted = Buffer.from(originalDatabase); corrupted[0] ^= 0xff;
    await writeFile(databasePath, corrupted, { mode: 0o600 });
    await manifestForChangedDatabase();
    const corruptTarget = fresh('corrupt-db');
    await rejected('restore', { ...testing, dataRoot: corruptTarget, backupRoot }, 'DATABASE_VALIDATION');
    equal(await existing(corruptTarget), null, 'An invalid but rehashed database is rejected before promotion.');
    await writeFile(databasePath, originalDatabase, { mode: 0o600 });
    await writeFile(manifestPath, originalManifest, { mode: 0o600 });
    const badForeignKey = new DatabaseSync(databasePath);
    badForeignKey.exec('PRAGMA foreign_keys = OFF');
    badForeignKey.prepare('INSERT INTO candidate_publications (id, intake_id, profile_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), randomUUID(), '{}', syntheticTime, syntheticTime);
    badForeignKey.close();
    await manifestForChangedDatabase();
    await rejected('restore', { ...testing, dataRoot: fresh('foreign-key'), backupRoot }, 'DATABASE_FOREIGN_KEYS');
    await writeFile(databasePath, originalDatabase, { mode: 0o600 });
    await writeFile(manifestPath, originalManifest, { mode: 0o600 });
    const badJournal = new DatabaseSync(databasePath);
    badJournal.prepare('UPDATE _hirehire_migrations SET sha256 = ? WHERE name = ?').run('synthetic-invalid-hash', migrationChain[0].name);
    badJournal.close();
    await manifestForChangedDatabase();
    await rejected('restore', { ...testing, dataRoot: fresh('journal'), backupRoot }, 'DATABASE_JOURNAL');
    await writeFile(databasePath, originalDatabase, { mode: 0o600 });
    await writeFile(manifestPath, originalManifest, { mode: 0o600 });
    const badObject = join(backupRoot, objectsDirectory, 'intake-photos', 'unknown-key');
    await writeFile(badObject, portrait, { mode: 0o600 });
    await rejected('restore', { ...testing, dataRoot: fresh('unknown-object'), backupRoot }, 'UNRECOGNIZED_FILES');
    await unlink(badObject);
    const alias = join(fixture, 'backup-link');
    await symlink(backupRoot, alias);
    await rejected('restore', { ...testing, dataRoot: fresh('linked-root'), backupRoot: alias }, 'UNSAFE_DIRECTORY');
    await unlink(photoPath);
    await symlink(join(dataRoot, objectsDirectory, 'intake-photos', photoId), photoPath);
    await rejected('restore', { ...testing, dataRoot: fresh('linked-object'), backupRoot }, 'UNSAFE_FILE');
    await unlink(photoPath); await writeFile(photoPath, portrait, { mode: 0o600 });
    await verifyFileInventory(backupRoot, backupManifest.manifest);
    check(!(await readdir(fixture)).some(name => name.includes('.hirehire-stage-')), 'Failed restore staging directories are removed exactly.');
    for (const file of before) equal(await hashOrCopy(join(dataRoot, file.name)), { bytes: file.bytes, sha256: file.sha256 }, 'Tamper checks never alter original source bytes.');
  } finally {
    source?.close();
    assert(dirname(fixture) === evidenceRoot && basename(fixture).startsWith('data-backup-fixture-'), 'Cleanup is limited to this exact generated synthetic fixture.');
    await rm(fixture, { recursive: true, force: true });
  }
  const report = { status: 'passed', assertions: checks, sqliteVersion: sqliteVersion(), syntheticRecords: 2, objects: 2, productionRequests: 0, originalSourceByteChecksPassed: true, backup: successfulBackup, restore: successfulRestore, fixtureRemoved: true };
  const reportPath = join(evidenceRoot, `data-backup-check-${randomUUID()}.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return { ...report, reportPath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length === 3 && process.argv[2] === '--help') process.stdout.write(usage);
  else {
    try {
      if (process.argv.length === 3 && process.argv[2] === '--unit') process.stdout.write(`${JSON.stringify(await syntheticChecks())}\n`);
      else {
        const { action, options } = parseArguments(process.argv.slice(2));
        process.stdout.write(`${JSON.stringify(await runDataBackup(action, options))}\n`);
      }
    } catch (error) {
      process.stderr.write(`${JSON.stringify({ status: 'failed', code: error instanceof DataBackupError ? error.code : error?.code || 'BACKUP_OPERATION_FAILED', error: error instanceof DataBackupError ? error.message : 'Private storage operation failed; preserve both roots and review filesystem access. No raw data is logged.' })}\n`);
      process.exitCode = 1;
    }
  }
}
