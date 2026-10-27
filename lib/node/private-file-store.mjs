import { temporaryRoots } from './temporary-roots.mjs';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const maximumObjectBytes = 2 * 1024 * 1024;
const objectKeyPattern = /^intake-photos\/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/;
const pathLocks = new Map();

async function withPathLock(path, operation) {
  const previous = pathLocks.get(path) || Promise.resolve();
  let release;
  const turn = new Promise(resolveTurn => { release = resolveTurn; });
  pathLocks.set(path, turn);
  await previous;
  try { return await operation(); }
  finally { release(); if (pathLocks.get(path) === turn) pathLocks.delete(path); }
}

function inside(path, directory) {
  const remainder = relative(directory, path);
  return remainder === '' || remainder !== '..' && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder);
}

function privateRootPath(input, options) {
  if (typeof input !== 'string' || !isAbsolute(input) || input.includes('\\') || input.includes('\0')) throw new Error('A private absolute object root is required.');
  const root = resolve(input);
  if (root === sep || root.split(sep).some(part => ['public', 'release', 'releases', 'dist', '.next', '.git', 'node_modules'].includes(part))) throw new Error('Objects must be outside public and release directories.');
  for (const path of [...(options.allowTemporaryRootForTests ? [] : [resolve(process.cwd())]), '/proc', '/sys', '/dev', '/run', '/var/run', ...(options.forbiddenRoots || [])]) {
    if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Forbidden roots must be absolute.');
    if (inside(root, resolve(path))) throw new Error('Object root overlaps a forbidden directory.');
  }
  if (!options.allowTemporaryRootForTests && temporaryRoots.some(path => inside(root, path))) throw new Error('A persistent object root is required.');
  return root;
}

async function directoryTree(path, create = false) {
  const rootOwner = (await lstat(sep)).uid;
  let cursor = sep;
  for (const part of path.split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    let stat;
    try { stat = await lstat(cursor); }
    catch (error) {
      if (error?.code !== 'ENOENT' || !create) throw error;
      try { await mkdir(cursor, { mode: 0o700 }); }
      catch (mkdirError) { if (mkdirError?.code !== 'EEXIST') throw mkdirError; }
      stat = await lstat(cursor);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Object directories cannot contain symbolic links.');
    if (typeof process.getuid !== 'function' || stat.uid !== rootOwner && stat.uid !== process.getuid()) throw new Error('Private object parents must be controlled by root or the service user.');
    if ((stat.mode & 0o022) && !(['/tmp', '/var/tmp'].includes(cursor) && (stat.mode & 0o1000))) throw new Error('Private object parents cannot be writable by other users.');
  }
  if (await realpath(path) !== path) throw new Error('Private object path changed.');
}

function ownerMatches(stat) { return typeof process.getuid === 'function' && stat.uid === process.getuid(); }
function privateDirectory(stat) {
  if (!stat.isDirectory() || stat.isSymbolicLink() || !ownerMatches(stat) || (stat.mode & 0o777) !== 0o700) throw new Error('Object directories must be private and service-owned.');
}
function privateObject(stat, maximumBytes) {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !ownerMatches(stat) || (stat.mode & 0o777) !== 0o600) throw new Error('Objects must be private regular files with one link.');
  if (!Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > maximumBytes) throw new Error('Object exceeds the permitted byte limit.');
}

async function missingFile(path) {
  try { return await lstat(path); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function copyForRollback(source, destination, expected, maximumBytes) {
  let input, output;
  try {
    input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await input.stat();
    privateObject(stat, maximumBytes);
    if (stat.dev !== expected.dev || stat.ino !== expected.ino || stat.size !== expected.size) throw new Error('Existing object changed before replacement.');
    output = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await output.chmod(0o600);
    let position = 0;
    while (position < stat.size) {
      const buffer = new Uint8Array(Math.min(64 * 1024, stat.size - position));
      const { bytesRead } = await input.read(buffer, 0, buffer.byteLength, position);
      if (!bytesRead) throw new Error('Existing object was truncated before replacement.');
      let offset = 0;
      while (offset < bytesRead) {
        const { bytesWritten } = await output.write(buffer, offset, bytesRead - offset);
        if (!bytesWritten) throw new Error('Rollback copy did not complete.');
        offset += bytesWritten;
      }
      position += bytesRead;
    }
    if ((await input.stat()).size !== stat.size) throw new Error('Existing object changed before replacement.');
    await output.sync();
  } finally {
    try { if (input) await input.close(); }
    finally { if (output) await output.close(); }
  }
}

export class PrivateFileStore {
  #root;
  #prefix;
  #maximumBytes;
  #readyPromise;
  #rootIdentity;
  #prefixIdentity;

  constructor(options) {
    if (!options || typeof options !== 'object') throw new TypeError('Object storage options are required.');
    this.#root = privateRootPath(options.objectRoot, options);
    this.#prefix = join(this.#root, 'intake-photos');
    this.#maximumBytes = options.maxBytes ?? maximumObjectBytes;
    if (!Number.isInteger(this.#maximumBytes) || this.#maximumBytes < 1 || this.#maximumBytes > maximumObjectBytes) throw new Error('Object byte limit must not exceed 2MiB.');
  }

  ready() {
    if (!this.#readyPromise) this.#readyPromise = this.#initialize();
    return this.#readyPromise;
  }

  async checkReady() {
    await this.ready();
    await this.#directories();
  }

  async #initialize() {
    await directoryTree(this.#root, true);
    if (!ownerMatches(await lstat(this.#root))) throw new Error('The object root must belong to the service user.');
    await chmod(this.#root, 0o700);
    await directoryTree(this.#prefix, true);
    if (!ownerMatches(await lstat(this.#prefix))) throw new Error('The object prefix must belong to the service user.');
    await chmod(this.#prefix, 0o700);
    this.#rootIdentity = await lstat(this.#root);
    this.#prefixIdentity = await lstat(this.#prefix);
    await this.#directories();
  }

  async #directories() {
    await directoryTree(this.#prefix);
    for (const [path, expected] of [[this.#root, this.#rootIdentity], [this.#prefix, this.#prefixIdentity]]) {
      const stat = await lstat(path);
      privateDirectory(stat);
      if (stat.dev !== expected.dev || stat.ino !== expected.ino) throw new Error('Private object directory changed.');
    }
  }

  #path(key) {
    if (typeof key !== 'string' || !objectKeyPattern.test(key)) throw new Error('An intake photo object key is required.');
    return join(this.#root, key);
  }

  async put(key, input, options = {}) {
    const path = this.#path(key);
    return withPathLock(path, () => this.#put(path, input, options));
  }

  async #put(path, input, options) {
    const contentType = options?.httpMetadata?.contentType;
    if (contentType !== undefined && !['image/jpeg', 'image/png'].includes(contentType)) throw new Error('Only JPEG and PNG content metadata is supported.');
    // The authoritative content type already lives in intake_photos.content_type.
    // Store raw bytes only, avoiding a separately committed metadata sidecar.
    let bytes = null, reader = null, stream = null;
    if (input instanceof ArrayBuffer) {
      if (input.byteLength > this.#maximumBytes) throw new Error('Object exceeds the permitted byte limit.');
      bytes = new Uint8Array(input.slice(0));
    } else if (ArrayBuffer.isView(input)) {
      if (input.byteLength > this.#maximumBytes) throw new Error('Object exceeds the permitted byte limit.');
      bytes = new Uint8Array(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
    } else if (input && typeof input.getReader === 'function') stream = input;
    else throw new TypeError('Object body must be bytes or a Web ReadableStream.');
    await this.ready();
    await this.#directories();
    const previous = await missingFile(path);
    if (previous) privateObject(previous, this.#maximumBytes);
    const temporary = join(this.#prefix, `.${randomUUID()}.upload`);
    const backup = join(this.#prefix, `.${randomUUID()}.rollback`);
    let handle, published = false, writtenIdentity, retainBackup = false;
    try {
      handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      await handle.chmod(0o600);
      if (stream) reader = stream.getReader();
      let total = 0;
      const write = async chunk => {
        if (!(chunk instanceof Uint8Array)) throw new TypeError('Object stream must contain byte chunks.');
        total += chunk.byteLength;
        if (total > this.#maximumBytes) throw new Error('Object exceeds the permitted byte limit.');
        const copy = new Uint8Array(chunk);
        let offset = 0;
        while (offset < copy.byteLength) {
          const { bytesWritten } = await handle.write(copy, offset, copy.byteLength - offset);
          if (!bytesWritten) throw new Error('Object write did not complete.');
          offset += bytesWritten;
        }
      };
      if (bytes) await write(bytes);
      else while (true) {
        const next = await reader.read();
        if (next.done) break;
        await write(next.value);
      }
      await handle.sync();
      writtenIdentity = await handle.stat();
      await handle.close(); handle = null;
      await this.#directories();
      const current = await missingFile(path);
      if (current) { privateObject(current, this.#maximumBytes); await copyForRollback(path, backup, current, this.#maximumBytes); }
      await rename(temporary, path);
      published = true;
      await syncDirectory(this.#prefix);
    } catch (error) {
      if (reader) { try { await reader.cancel(); } catch { /* Keep the original failure. */ } }
      if (published) {
        try {
          await this.#directories();
          const current = await missingFile(path);
          // Do not delete or overwrite another writer's committed inode. Runtime
          // uses one service process; the in-process path lock also spans stores.
          if (current && current.dev === writtenIdentity.dev && current.ino === writtenIdentity.ino) {
            if (await missingFile(backup)) await rename(backup, path);
            else await unlink(path);
            await syncDirectory(this.#prefix);
          }
        } catch (rollbackError) {
          retainBackup = true; // Preserve the private old bytes for explicit recovery.
          throw new AggregateError([error, rollbackError], 'Object commit and rollback failed; private storage requires recovery.');
        }
      }
      throw error;
    } finally {
      try { if (reader) reader.releaseLock(); }
      finally {
        try { if (handle) await handle.close(); }
        finally {
          for (const path of [temporary, ...(retainBackup ? [] : [backup])]) {
            try { await unlink(path); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
          }
        }
      }
    }
  }

  async #snapshot(path) {
    await this.#directories();
    const candidate = await missingFile(path);
    if (!candidate) return null;
    privateObject(candidate, this.#maximumBytes);
    let handle;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      privateObject(stat, this.#maximumBytes);
      if (stat.dev !== candidate.dev || stat.ino !== candidate.ino) throw new Error('Object changed while opening.');
      return stat;
    } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
    finally { if (handle) await handle.close(); }
  }

  async get(key) {
    const path = this.#path(key);
    await this.ready();
    const snapshot = await this.#snapshot(path);
    if (!snapshot) return null;
    let handle = null, opening = null, position = 0, cancelled = false;
    const close = async () => { const file = handle; handle = null; if (file) await file.close(); };
    const body = new ReadableStream({
      pull: async controller => {
        try {
          if (cancelled) return;
          if (!handle) {
            opening = (async () => {
              await this.#directories();
              const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
              try {
                const stat = await file.stat();
                privateObject(stat, this.#maximumBytes);
                if (stat.dev !== snapshot.dev || stat.ino !== snapshot.ino || stat.size !== snapshot.size) throw new Error('Object changed before reading.');
                return file;
              } catch (error) { await file.close(); throw error; }
            })();
            handle = await opening; opening = null;
            if (cancelled) { await close(); return; }
          }
          const remaining = snapshot.size - position;
          if (!remaining) { await close(); controller.close(); return; }
          const buffer = new Uint8Array(Math.min(64 * 1024, remaining));
          const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position);
          if (cancelled) { await close(); return; }
          if (!bytesRead) throw new Error('Object was truncated while reading.');
          position += bytesRead;
          controller.enqueue(buffer.subarray(0, bytesRead));
          if (position === snapshot.size) { await close(); controller.close(); }
        } catch (error) {
          await close();
          if (!cancelled) controller.error(error);
        }
      },
      cancel: async () => {
        cancelled = true;
        if (opening) { try { handle = await opening; } catch { /* Opening already failed. */ } }
        await close();
      },
    }, { highWaterMark: 0 }); // No file descriptor is retained until a consumer reads.
    return { size: snapshot.size, body, arrayBuffer: () => new Response(body).arrayBuffer() };
  }

  async delete(key) {
    const path = this.#path(key);
    return withPathLock(path, () => this.#delete(path));
  }

  async #delete(path) {
    await this.ready();
    await this.#directories();
    const stat = await missingFile(path);
    if (!stat) return;
    privateObject(stat, this.#maximumBytes);
    try { await unlink(path); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    await syncDirectory(this.#prefix);
  }
}
