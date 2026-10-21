import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { constants, chmodSync, closeSync, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

// This adapter implements the D1 subset used by HireHire. No request, SQL values,
// database rows or paths are logged here. Keep dataRoot on the confirmed persistent
// disk, separate from the code release. An absolute path alone cannot prove that
// its underlying mount is persistent; deployment must verify that separately.
const migrationManifest = Object.freeze([
  ['0000_parched_betty_ross.sql', '961b6edcec35c84b0abd1fff613be3a5d8b4fa3691c0107fcee4cf57d8e74954'],
  ['0001_handy_robbie_robertson.sql', 'ed55b672db12efc6677801e4fb217b3965f37033ea69314c0b36381567cc5edd'],
]);
const businessTables = new Set(['intake_records', 'intake_rate_limits', 'candidate_publications', 'intake_photos', 'record_matches', 'site_settings']);
const journalTable = '_hirehire_migrations';
const privateToken = Symbol('HireHire SQLite statement');
const databaseState = new WeakMap();
const statementState = new WeakMap();

// Enforce the upstream WAL-reset fix before creating or opening any data file.
export function isSafeSqliteVersion(version) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) return false;
  const [major, minor, patch] = version.split('.').map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger)) return false;
  return major > 3 || major === 3 && (minor > 51 || minor === 51 && patch >= 3 || minor === 50 && patch >= 7 || minor === 44 && patch >= 6);
}

function assertSafeSqliteRuntime() {
  let version = process.versions.sqlite;
  if (!version) {
    const probe = new DatabaseSync(':memory:');
    try { version = probe.prepare('SELECT sqlite_version() AS version').get().version; }
    finally { probe.close(); }
  }
  if (!isSafeSqliteVersion(version)) throw new Error('SQLite requires the verified WAL-reset fix: >=3.51.3, 3.50.7+, or 3.44.6+.');
}

function inside(path, directory) {
  const remainder = relative(directory, path);
  return remainder === '' || remainder !== '..' && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder);
}

function privateRootPath(input, options) {
  if (typeof input !== 'string' || !isAbsolute(input) || input.includes('\\') || input.includes('\0')) throw new Error('A private absolute data root is required.');
  const root = resolve(input);
  if (root === sep || root.split(sep).some(part => ['public', 'release', 'releases', 'dist', '.next', '.git', 'node_modules'].includes(part))) throw new Error('Data must be outside public and release directories.');
  const forbidden = [...(options.allowTemporaryRootForTests ? [] : [resolve(process.cwd())]), '/proc', '/sys', '/dev', '/run', '/var/run', ...(options.forbiddenRoots || [])];
  for (const path of forbidden) {
    if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Forbidden roots must be absolute.');
    if (inside(root, resolve(path))) throw new Error('Data root overlaps a forbidden directory.');
  }
  if (!options.allowTemporaryRootForTests && ['/tmp', '/var/tmp'].some(path => inside(root, path))) throw new Error('A persistent data root is required.');
  return root;
}

function inspectDirectoryTree(path, create = false) {
  const rootOwner = lstatSync(sep).uid; // Container filesystems may map root to an overflow UID.
  let cursor = sep;
  for (const part of path.split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    let stat = lstatSync(cursor, { throwIfNoEntry: false });
    if (!stat && create) {
      try { mkdirSync(cursor, { mode: 0o700 }); }
      catch (error) { if (error?.code !== 'EEXIST') throw error; }
      stat = lstatSync(cursor);
    }
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Private data directories cannot contain symbolic links.');
    if (typeof process.getuid !== 'function' || stat.uid !== rootOwner && stat.uid !== process.getuid()) throw new Error('Private data parents must be controlled by root or the service user.');
    if ((stat.mode & 0o022) && !(['/tmp', '/var/tmp'].includes(cursor) && (stat.mode & 0o1000))) throw new Error('Private data parents cannot be writable by other users.');
  }
  if (realpathSync(path) !== path) throw new Error('Private data path changed.');
}

function ownedPrivateFile(stat) {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || typeof process.getuid !== 'function' || stat.uid !== process.getuid()) throw new Error('Database files must be regular, service-owned files with one link.');
}

function protectExistingFile(path) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return;
  ownedPrivateFile(stat);
  const descriptor = openSync(path, constants.O_RDWR | constants.O_NOFOLLOW);
  try {
    const current = fstatSync(descriptor);
    ownedPrivateFile(current);
    if (current.dev !== stat.dev || current.ino !== stat.ino) throw new Error('Database file changed during opening.');
    fchmodSync(descriptor, 0o600);
  } finally { closeSync(descriptor); }
}

function migrationSources(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) throw new Error('An absolute migration directory is required.');
  return migrationManifest.map(([name, expectedHash]) => {
    const path = join(directory, name);
    const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes;
    try {
      const stat = fstatSync(descriptor);
      if (!stat.isFile() || stat.size > 256 * 1024) throw new Error('Migration source is not an expected regular file.');
      bytes = readFileSync(descriptor);
    } finally { closeSync(descriptor); }
    const checksum = createHash('sha256').update(bytes).digest('hex');
    if (checksum !== expectedHash) throw new Error('Immutable migration checksum mismatch.');
    return { name, checksum, sql: bytes.toString('utf8').replaceAll('--> statement-breakpoint', '') };
  });
}

function validateBusinessSchema(connection) {
  const columns = {
    intake_records: ['id', 'reference', 'kind', 'data_json', 'search_text', 'status', 'notes', 'created_at', 'updated_at', 'idempotency_hash', 'request_hash', 'original_data_json', 'next_follow_up', 'photo_id', 'requested_candidate_ids'],
    intake_rate_limits: ['key', 'attempts', 'expires_at'],
    candidate_publications: ['id', 'intake_id', 'profile_json', 'state', 'created_at', 'updated_at'],
    intake_photos: ['id', 'token_hash', 'object_key', 'content_type', 'byte_length', 'expires_at', 'attached_record_id', 'created_at'],
    record_matches: ['id', 'employer_id', 'jobseeker_id', 'stage', 'notes', 'interview_at', 'created_at', 'updated_at'],
    site_settings: ['id', 'info_json', 'updated_at'],
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
    const actual = connection.prepare(`PRAGMA table_info(${table})`).all();
    if (actual.length !== expected.length || actual.some((row, index) => {
      const key = `${table}.${row.name}`;
      return row.name !== expected[index] || row.type.toUpperCase() !== (integers.has(key) ? 'INTEGER' : 'TEXT') || row.notnull !== (nullable.has(key) ? 0 : 1) || row.pk !== (index === 0 ? 1 : 0) || row.dflt_value !== (defaults[key] ?? null);
    })) throw new Error('Business table schema does not match the reviewed migrations.');
    const expectedIndexes = indexes[table] || [];
    const actualIndexes = connection.prepare(`PRAGMA index_list(${table})`).all().filter(row => row.origin !== 'pk');
    if (actualIndexes.length !== expectedIndexes.length || expectedIndexes.some(([name, unique, names]) => {
      const definition = actualIndexes.find(row => row.name === name);
      const fields = connection.prepare(`PRAGMA index_info(${name})`).all();
      return !definition || definition.unique !== unique || definition.partial !== 0 || fields.length !== names.length || fields.some((row, index) => row.name !== names[index]);
    })) throw new Error('Business indexes do not match the reviewed migrations.');
    const expectedForeignKeys = foreignKeys[table] || [];
    const actualForeignKeys = connection.prepare(`PRAGMA foreign_key_list(${table})`).all();
    if (actualForeignKeys.length !== expectedForeignKeys.length || actualForeignKeys.some(row => !expectedForeignKeys.includes(row.from) || row.table !== 'intake_records' || row.to !== 'id' || row.on_delete !== 'CASCADE' || row.on_update !== 'NO ACTION')) throw new Error('Business foreign keys do not match the reviewed migrations.');
  }
}

function migrate(connection, migrations) {
  connection.exec('BEGIN IMMEDIATE');
  try {
    const tables = connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*'").all().map(row => row.name);
    if (tables.some(name => !businessTables.has(name) && name !== journalTable)) throw new Error('Unrecognized database schema; explicit reviewed import is required.');
    if (connection.prepare("SELECT name FROM sqlite_master WHERE type IN ('view', 'trigger') LIMIT 1").get()) throw new Error('Unrecognized views or triggers; explicit reviewed import is required.');
    if (tables.length && !tables.includes(journalTable)) throw new Error('An existing schema without a verified migration journal cannot be adopted automatically.');
    connection.exec(`CREATE TABLE IF NOT EXISTS ${journalTable} (name TEXT PRIMARY KEY NOT NULL, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL)`);
    const applied = connection.prepare(`SELECT name, sha256 FROM ${journalTable} ORDER BY name`).all();
    if (applied.some((row, index) => row.name !== migrations[index]?.name || row.sha256 !== migrations[index]?.checksum)) throw new Error('Migration journal does not match the immutable migration chain.');
    const save = connection.prepare(`INSERT INTO ${journalTable} (name, sha256, applied_at) VALUES (?, ?, ?)`);
    for (const migration of migrations.slice(applied.length)) {
      connection.exec(migration.sql);
      save.run(migration.name, migration.checksum, new Date().toISOString());
    }
    validateBusinessSchema(connection);
    if (connection.prepare('PRAGMA foreign_key_check').get()) throw new Error('Database foreign-key validation failed.');
    connection.exec('COMMIT');
  } catch (error) {
    try { connection.exec('ROLLBACK'); }
    catch { throw new Error('Migration rollback failed; database startup refused.', { cause: error }); }
    throw error;
  }
}

function stateFor(database) {
  const state = databaseState.get(database);
  if (!state || state.closed) throw new Error('Database is closed.');
  return state;
}

function statementFor(statement) {
  const state = statementState.get(statement);
  if (!state) throw new TypeError('An adapter-owned prepared statement is required.');
  stateFor(state.owner);
  return state;
}

function bindingsCopy(bindings) {
  return bindings.map(value => {
    if (value === null || typeof value === 'string' || typeof value === 'bigint') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (ArrayBuffer.isView(value)) return new Uint8Array(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    throw new TypeError('SQLite bindings must be finite numbers, strings, null, bigint or byte views.');
  });
}

function exactNumber(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('SQLite metadata exceeds the safe integer range.');
  return number;
}

function allSynchronously(state) {
  const connection = stateFor(state.owner).connection;
  const before = connection.prepare('SELECT total_changes() AS total').get().total;
  const results = state.prepared.all(...state.bindings).map(row => Object.fromEntries(Object.entries(row)));
  const after = connection.prepare('SELECT total_changes() AS total, last_insert_rowid() AS id').get();
  return { results, success: true, meta: { changes: exactNumber(after.total - before), last_row_id: exactNumber(after.id) } };
}

export class SqlitePreparedStatement {
  constructor(token, owner, prepared, bindings = []) {
    if (token !== privateToken) throw new TypeError('Use database.prepare().');
    statementState.set(this, { owner, prepared, bindings });
  }

  bind(...bindings) {
    const state = statementFor(this);
    return new SqlitePreparedStatement(privateToken, state.owner, state.prepared, bindingsCopy(bindings));
  }

  async first(columnName) {
    const state = statementFor(this);
    const row = state.prepared.get(...state.bindings);
    if (!row) return null;
    if (columnName === undefined) return Object.fromEntries(Object.entries(row));
    if (typeof columnName !== 'string' || !Object.hasOwn(row, columnName)) throw new Error('Requested result column is unavailable.');
    return row[columnName];
  }

  async all() { return allSynchronously(statementFor(this)); }

  async run() {
    const state = statementFor(this);
    const result = state.prepared.run(...state.bindings);
    return { results: [], success: true, meta: { changes: exactNumber(result.changes), last_row_id: exactNumber(result.lastInsertRowid) } };
  }
}

export class SqliteDatabase {
  constructor(token, connection) {
    if (token !== privateToken) throw new TypeError('Use openSqliteDatabase().');
    databaseState.set(this, { connection, closed: false });
  }

  prepare(sql) {
    if (typeof sql !== 'string' || !sql.trim()) throw new TypeError('SQL is required.');
    // Business callers cannot end a batch or attach another file via this port.
    const start = sql.replace(/\/\*[\s\S]*?\*\/|--[^\n]*(?:\n|$)/g, '').trimStart();
    if (/^(?:BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|ATTACH|DETACH)\b/i.test(start)) throw new Error('Transaction control belongs to the database adapter.');
    const state = stateFor(this);
    return new SqlitePreparedStatement(privateToken, this, state.connection.prepare(sql));
  }

  async batch(statements) {
    const { connection } = stateFor(this);
    if (!Array.isArray(statements)) throw new TypeError('A statement array is required.');
    const states = statements.map(statement => {
      const state = statementFor(statement);
      if (state.owner !== this) throw new Error('Every batch statement must belong to the same database adapter.');
      return state;
    });
    if (!states.length) return [];
    // All execution stays synchronous on this one connection. No await or promise
    // callback can interleave writes between the guard and photo attachment.
    connection.exec('BEGIN IMMEDIATE');
    try {
      const results = states.map(allSynchronously);
      connection.exec('COMMIT');
      return results;
    } catch (error) {
      try { connection.exec('ROLLBACK'); }
      catch {
        databaseState.get(this).closed = true;
        try { connection.close(); } catch { /* Refuse further use of this connection. */ }
        throw new Error('Batch rollback failed; database connection was disabled.', { cause: error });
      }
      throw error;
    }
  }

  close() {
    const state = databaseState.get(this);
    if (!state || state.closed) return;
    state.connection.close();
    state.closed = true;
  }
}

export function openSqliteDatabase(options) {
  if (!options || typeof options !== 'object') throw new TypeError('Database options are required.');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || major === 22 && minor < 13) throw new Error('Node 22.13 or newer is required.');
  assertSafeSqliteRuntime();
  const root = privateRootPath(options.dataRoot, options);
  const name = options.databaseName ?? 'hirehire.sqlite';
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\.sqlite$/.test(name)) throw new Error('A simple SQLite filename is required.');
  const timeout = options.busyTimeoutMs ?? 5000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 30000) throw new Error('SQLite busy timeout must be between 1 and 30000 milliseconds.');
  const migrations = migrationSources(options.migrationDirectory);
  inspectDirectoryTree(root, true);
  const rootStat = lstatSync(root);
  if (typeof process.getuid !== 'function' || rootStat.uid !== process.getuid()) throw new Error('The data root must belong to the service user.');
  chmodSync(root, 0o700);
  const path = join(root, name);
  for (const suffix of ['', '-wal', '-shm', '-journal']) protectExistingFile(`${path}${suffix}`);
  const descriptor = openSync(path, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try { ownedPrivateFile(fstatSync(descriptor)); fchmodSync(descriptor, 0o600); }
  finally { closeSync(descriptor); }
  let connection;
  try {
    connection = new DatabaseSync(path, { enableForeignKeyConstraints: true, enableDoubleQuotedStringLiterals: false, allowExtension: false });
    connection.exec(`PRAGMA busy_timeout = ${timeout}; PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;`);
    if (connection.prepare('PRAGMA journal_mode = WAL').get().journal_mode !== 'wal' || connection.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) throw new Error('SQLite WAL and foreign keys are required.');
    const capability = connection.prepare("SELECT json_extract('{\"ok\":true}', '$.ok') AS consent, (SELECT COUNT(*) FROM json_each('[1,2]')) AS elements, unixepoch() AS seconds").get();
    if (capability.consent !== 1 || capability.elements !== 2 || !Number.isSafeInteger(capability.seconds)) throw new Error('SQLite JSON and epoch functions are required.');
    migrate(connection, migrations);
    for (const suffix of ['', '-wal', '-shm', '-journal']) protectExistingFile(`${path}${suffix}`);
    return new SqliteDatabase(privateToken, connection);
  } catch (error) {
    try { connection?.close(); } catch { /* Startup remains closed. */ }
    throw error;
  }
}
