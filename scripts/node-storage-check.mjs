import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { chmod, copyFile, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, rmdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSafeSqliteVersion, openSqliteDatabase } from '../lib/node/sqlite.mjs';
import { PrivateFileStore } from '../lib/node/private-file-store.mjs';

assert(process.argv.includes('--unit'), 'Use --unit; this check only uses an owned temporary directory and synthetic records.');
const temporaryParent = await realpath(tmpdir());
const fixture = await mkdtemp(join(temporaryParent, 'hirehire-node-storage-'));
const migrations = fileURLToPath(new URL('../drizzle/', import.meta.url));
const dataRoot = join(fixture, 'database'), objectRoot = join(fixture, 'objects');
const databaseOptions = { dataRoot, migrationDirectory: migrations, allowTemporaryRootForTests: true };
const objectOptions = { objectRoot, allowTemporaryRootForTests: true };
const maximumBytes = 2 * 1024 * 1024;
let checks = 0;
const databases = new Set();
const check = (value, message) => { assert(value, message); checks++; };
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const reject = async (operation, message) => { await assert.rejects(operation, message); checks++; };
const throws = (operation, message) => { assert.throws(operation, message); checks++; };
function database(options = databaseOptions) { const db = openSqliteDatabase(options); databases.add(db); return db; }
function close(db) { db.close(); databases.delete(db); }
const key = () => `intake-photos/${randomUUID()}`;
const recordSql = 'INSERT INTO intake_records (id, reference, kind, data_json, search_text, created_at, updated_at, idempotency_hash, request_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
function recordStatement(db, id, data = '{"z":"合成資料","a":true}') {
  const hash = createHash('sha256').update(id).digest('hex');
  return db.prepare(recordSql).bind(id, `SYNTHETIC-${id}`, 'jobseeker', data, 'synthetic-storage-only', '2026-10-14T00:00:00.001Z', '2026-10-14T00:00:00.001Z', hash, hash);
}

try {
  for (const version of ['3.51.2', '3.50.6', '3.44.5', '3.49.2', '3.45.9', 'unknown', undefined, '3.51.3-unknown']) equal(isSafeSqliteVersion(version), false, 'An unknown or unpatched SQLite version is refused.');
  for (const version of ['3.51.3', '3.50.7', '3.44.6', '3.53.3']) equal(isSafeSqliteVersion(version), true, 'An upstream fixed SQLite version is accepted.');
  equal(isSafeSqliteVersion(process.versions.sqlite), true, 'The current builtin SQLite has the WAL-reset fix.');
  throws(() => openSqliteDatabase({ ...databaseOptions, dataRoot: 'relative' }), /absolute/);
  throws(() => openSqliteDatabase({ ...databaseOptions, allowTemporaryRootForTests: false }), /persistent/);
  throws(() => openSqliteDatabase({ ...databaseOptions, dataRoot: join(process.cwd(), 'work', 'must-not-create'), allowTemporaryRootForTests: false }), /forbidden/);
  throws(() => openSqliteDatabase({ ...databaseOptions, dataRoot: join(process.cwd(), 'work', 'must-not-create'), forbiddenRoots: [join(process.cwd(), 'work')] }), /forbidden/);
  throws(() => new PrivateFileStore({ ...objectOptions, objectRoot: join(fixture, 'public', 'objects') }), /public/);
  throws(() => new PrivateFileStore({ ...objectOptions, objectRoot: join(fixture, 'releases', 'objects') }), /release/);
  throws(() => new PrivateFileStore({ ...objectOptions, allowTemporaryRootForTests: false }), /persistent/);
  throws(() => new PrivateFileStore({ ...objectOptions, maxBytes: maximumBytes + 1 }), /2MiB/);

  let db = database();
  equal((await db.prepare('PRAGMA journal_mode').first()).journal_mode, 'wal', 'WAL is enabled.');
  equal((await db.prepare('PRAGMA foreign_keys').first()).foreign_keys, 1, 'Foreign keys are enforced.');
  equal((await db.prepare('PRAGMA busy_timeout').first()).timeout, 5000, 'The validated busy timeout is installed.');
  equal((await db.prepare('PRAGMA synchronous').first()).synchronous, 2, 'FULL synchronization is enabled.');
  const beforeJournal = await db.prepare('SELECT name, sha256, applied_at FROM _hirehire_migrations ORDER BY name').all();
  equal(beforeJournal.results.length, 2, 'The two original migrations are journalled once.');
  equal(beforeJournal.results.map(row => row.sha256), ['961b6edcec35c84b0abd1fff613be3a5d8b4fa3691c0107fcee4cf57d8e74954', 'ed55b672db12efc6677801e4fb217b3965f37033ea69314c0b36381567cc5edd'], 'The original SQL bytes are pinned.');
  equal((await lstat(dataRoot)).mode & 0o777, 0o700, 'Database directory is private.');
  for (const name of await readdir(dataRoot)) equal((await lstat(join(dataRoot, name))).mode & 0o777, 0o600, 'Database and sidecar files are private.');

  const firstId = randomUUID(), originalJson = '{"z":"合成原文 100%_\\\\","a":true,"age":"38.0","blank":""}';
  const inserted = await recordStatement(db, firstId, originalJson).run();
  equal(inserted.meta.changes, 1, 'run() maps the actual affected-row count.');
  equal((await db.prepare('SELECT data_json, updated_at FROM intake_records WHERE id = ?').bind(firstId).first()).data_json, originalJson, 'JSON property order and raw text are unchanged.');
  equal(await db.prepare('SELECT updated_at FROM intake_records WHERE id = ?').bind(firstId).first('updated_at'), '2026-10-14T00:00:00.001Z', 'The original millisecond version is unchanged.');
  equal(await db.prepare('SELECT id FROM intake_records WHERE id = ?').bind(randomUUID()).first(), null, 'Missing first() is null.');
  const stale = await db.prepare('UPDATE intake_records SET notes = ? WHERE id = ? AND updated_at = ?').bind('synthetic', firstId, '2026-10-14T00:00:00.000Z').run();
  equal(stale.meta.changes, 0, 'A stale conditional update has zero changes.');
  const secondId = randomUUID();
  const transaction = await db.batch([
    recordStatement(db, secondId),
    db.prepare('UPDATE intake_records SET notes = ? WHERE id = ? RETURNING id, notes').bind('synthetic-returning', secondId),
    db.prepare('SELECT id FROM intake_records WHERE id = ?').bind(secondId),
  ]);
  equal(transaction[1].results, [{ id: secondId, notes: 'synthetic-returning' }], 'Batch preserves RETURNING rows.');
  equal(transaction[1].meta.changes, 1, 'Batch write reports its changes.');
  equal(transaction[2].results, [{ id: secondId }], 'Batch returns SELECT rows.');
  equal(transaction[2].meta.changes, 0, 'A SELECT does not inherit previous write changes.');
  const rollbackId = randomUUID();
  await reject(() => db.batch([
    recordStatement(db, rollbackId),
    db.prepare('INSERT INTO candidate_publications (id, intake_id, profile_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').bind(randomUUID(), randomUUID(), '{}', 'synthetic-time', 'synthetic-time'),
  ]), /FOREIGN KEY/);
  equal(await db.prepare('SELECT id FROM intake_records WHERE id = ?').bind(rollbackId).first(), null, 'A later constraint failure rolls the entire batch back.');
  equal(await db.prepare('DELETE FROM intake_records WHERE id = ? RETURNING id').bind(secondId).first(), { id: secondId }, 'first() supports DELETE RETURNING.');
  const other = database({ ...databaseOptions, databaseName: 'other.sqlite' });
  const wrongOwnerId = randomUUID();
  await reject(() => db.batch([recordStatement(db, wrongOwnerId), other.prepare('SELECT 1 AS value')]), /same database/);
  equal(await db.prepare('SELECT id FROM intake_records WHERE id = ?').bind(wrongOwnerId).first(), null, 'Mixed-owner batches fail before any write.');
  close(other);
  throws(() => db.prepare('/* controlled */ COMMIT'), /Transaction control/);
  throws(() => db.prepare('ATTACH DATABASE ? AS other'), /Transaction control/);
  throws(() => db.prepare('SELECT ?').bind(Number.NaN), /bindings/);

  const store = new PrivateFileStore(objectOptions);
  await store.ready();
  await store.checkReady();
  check(true, 'Readiness rechecks the live private directories.');
  const portraitKey = key(), originalBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2]);
  await store.put(portraitKey, originalBytes, { httpMetadata: { contentType: 'image/png' } });
  equal((await lstat(objectRoot)).mode & 0o777, 0o700, 'Object root is private.');
  equal((await lstat(join(objectRoot, 'intake-photos'))).mode & 0o777, 0o700, 'Object prefix is private.');
  equal((await lstat(join(objectRoot, portraitKey))).mode & 0o777, 0o600, 'Object file is private.');
  const object = await store.get(portraitKey);
  equal(object.size, originalBytes.byteLength, 'Object size is raw body length.');
  equal(new Uint8Array(await object.arrayBuffer()), originalBytes, 'arrayBuffer returns exact raw bytes.');
  equal(new Uint8Array(await new Response((await store.get(portraitKey)).body).arrayBuffer()), originalBytes, 'The Web stream returns exact bytes.');
  const cancellable = await store.get(portraitKey);
  await cancellable.body.cancel();
  check(true, 'An unread object stream can be cancelled without opening a file.');
  equal(await store.get(key()), null, 'Missing object is null.');
  await store.delete(key());
  check(true, 'Deleting a missing object is idempotent.');
  for (const invalid of ['', '../escape', 'intake-photos/../escape', '/intake-photos/test', 'intake-photos\\test', `intake-photos/${randomUUID()}/extra`, 'budget-images/test', `intake-photos/${randomUUID()}\0`]) {
    await reject(() => store.get(invalid), /object key/);
    await reject(() => store.put(invalid, originalBytes), /object key/);
    await reject(() => store.delete(invalid), /object key/);
  }
  await reject(() => store.put(key(), originalBytes, { httpMetadata: { contentType: 'text/html' } }), /JPEG and PNG/);
  await reject(() => store.put(portraitKey, new Uint8Array(maximumBytes + 1)), /byte limit/);
  equal(new Uint8Array(await (await store.get(portraitKey)).arrayBuffer()), originalBytes, 'Oversized bytes do not replace a committed object.');
  let streamCancelled = false, pull = 0;
  await reject(() => store.put(portraitKey, new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(++pull === 1 ? maximumBytes : 1)); },
    cancel() { streamCancelled = true; },
  })), /byte limit/);
  check(streamCancelled, 'Oversized streams are cancelled.');
  equal(new Uint8Array(await (await store.get(portraitKey)).arrayBuffer()), originalBytes, 'A failed streamed write retains the old object atomically.');
  check(!(await readdir(join(objectRoot, 'intake-photos'))).some(name => name.endsWith('.upload')), 'Failed writes leave no temporary uploads.');
  const failedStream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); controller.error(new Error('synthetic stream failure')); } });
  await reject(() => store.put(portraitKey, failedStream), /synthetic stream failure/);
  check(!(await readdir(join(objectRoot, 'intake-photos'))).some(name => name.endsWith('.upload')), 'A producer failure also cleans up its temporary upload.');
  const oversizedKey = key();
  await writeFile(join(objectRoot, oversizedKey), new Uint8Array(maximumBytes + 1), { mode: 0o600 });
  await reject(() => store.get(oversizedKey), /byte limit/);
  await unlink(join(objectRoot, oversizedKey));

  const outside = join(fixture, 'synthetic-outside');
  await writeFile(outside, originalBytes, { mode: 0o600 });
  const linkedKey = key();
  await symlink(outside, join(objectRoot, linkedKey));
  await reject(() => store.get(linkedKey), /regular/);
  await reject(() => store.put(linkedKey, originalBytes), /regular/);
  await reject(() => store.delete(linkedKey), /regular/);
  equal(new Uint8Array(await readFile(outside)), originalBytes, 'Rejected symbolic links preserve their target.');
  await unlink(join(objectRoot, linkedKey));
  await chmod(objectRoot, 0o755);
  await reject(() => store.checkReady(), /private/);
  await chmod(objectRoot, 0o700);
  const prefixPath = join(objectRoot, 'intake-photos');
  await chmod(prefixPath, 0o755);
  await reject(() => store.checkReady(), /private/);
  await chmod(prefixPath, 0o700);
  const movedRoot = join(fixture, 'moved-objects');
  await rename(objectRoot, movedRoot);
  await reject(() => store.checkReady(), /ENOENT/);
  await rename(movedRoot, objectRoot);
  const movedPrefix = join(objectRoot, 'moved-intake-photos');
  await rename(prefixPath, movedPrefix);
  await mkdir(prefixPath, { mode: 0o700 });
  await reject(() => store.checkReady(), /changed/);
  await rmdir(prefixPath);
  await rename(movedPrefix, prefixPath);
  await store.checkReady();
  check(true, 'Restoring exact fixture inodes restores readiness.');
  await link(outside, join(objectRoot, linkedKey));
  await reject(() => store.get(linkedKey), /regular/);
  await reject(() => store.put(linkedKey, originalBytes), /regular/);
  await reject(() => store.delete(linkedKey), /regular/);
  await unlink(join(objectRoot, linkedKey));
  const rootAlias = join(fixture, 'root-alias');
  await symlink(objectRoot, rootAlias);
  await reject(() => new PrivateFileStore({ ...objectOptions, objectRoot: rootAlias }).ready(), /symbolic links/);
  throws(() => openSqliteDatabase({ ...databaseOptions, dataRoot: rootAlias }), /symbolic links/);
  const databaseLinkRoot = join(fixture, 'database-link');
  await mkdir(databaseLinkRoot, { mode: 0o700 });
  await symlink(outside, join(databaseLinkRoot, 'hirehire.sqlite'));
  throws(() => openSqliteDatabase({ ...databaseOptions, dataRoot: databaseLinkRoot }), /regular/);
  await unlink(join(databaseLinkRoot, 'hirehire.sqlite'));
  await link(outside, join(databaseLinkRoot, 'hirehire.sqlite'));
  throws(() => openSqliteDatabase({ ...databaseOptions, dataRoot: databaseLinkRoot }), /regular/);

  close(db);
  db = database();
  equal((await db.prepare('SELECT name, sha256, applied_at FROM _hirehire_migrations ORDER BY name').all()).results, beforeJournal.results, 'Restart does not reapply or rewrite migrations.');
  equal((await db.prepare('SELECT data_json FROM intake_records WHERE id = ?').bind(firstId).first()).data_json, originalJson, 'Committed records survive restart byte-for-byte.');
  const restartedStore = new PrivateFileStore(objectOptions);
  equal(new Uint8Array(await (await restartedStore.get(portraitKey)).arrayBuffer()), originalBytes, 'Objects survive a fresh store instance.');
  await restartedStore.delete(portraitKey);
  equal(await restartedStore.get(portraitKey), null, 'Committed object deletion survives readback.');
  const migrationName = beforeJournal.results[0].name, migrationHash = beforeJournal.results[0].sha256;
  await db.prepare('UPDATE _hirehire_migrations SET sha256 = ? WHERE name = ?').bind('synthetic-wrong-hash', migrationName).run();
  throws(() => openSqliteDatabase(databaseOptions), /journal/);
  await db.prepare('UPDATE _hirehire_migrations SET sha256 = ? WHERE name = ?').bind(migrationHash, migrationName).run();
  const unknownRoot = join(fixture, 'unknown-schema');
  await mkdir(unknownRoot, { mode: 0o700 });
  const unknownPath = join(unknownRoot, 'hirehire.sqlite'), unknown = new DatabaseSync(unknownPath);
  unknown.exec('CREATE TABLE unrecognized_business (id TEXT PRIMARY KEY)'); unknown.close();
  await chmod(unknownPath, 0o600);
  throws(() => openSqliteDatabase({ ...databaseOptions, dataRoot: unknownRoot }), /Unrecognized/);
  const changedMigrationRoot = join(fixture, 'changed-migrations');
  await mkdir(changedMigrationRoot, { mode: 0o700 });
  for (const name of beforeJournal.results.map(row => row.name)) await copyFile(join(migrations, name), join(changedMigrationRoot, name));
  await writeFile(join(changedMigrationRoot, migrationName), 'SELECT 1;\n', { mode: 0o600 });
  throws(() => openSqliteDatabase({ ...databaseOptions, migrationDirectory: changedMigrationRoot }), /checksum/);
  close(db);
  throws(() => db.prepare('SELECT 1').all(), /closed/);
  console.log(JSON.stringify({ status: 'passed', assertions: checks, storage: 'owned temporary directory only', realRecords: 0, productionRequests: 0 }));
} finally {
  for (const db of databases) db.close();
  assert(dirname(fixture) === temporaryParent && fixture.startsWith(join(temporaryParent, 'hirehire-node-storage-')), 'Cleanup is restricted to the exact generated fixture directory.');
  await rm(fixture, { recursive: true, force: true });
}
