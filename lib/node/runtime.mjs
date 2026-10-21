import path from 'node:path';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { openSqliteDatabase } from './sqlite.mjs';
import { PrivateFileStore } from './private-file-store.mjs';
import { getRequestContext, managementSession, expectedRequestOrigin } from './request-context.mjs';

const stateKey = Symbol.for('hirehire.node.runtime.v1');
const fontRelativePath = 'public/fonts/jiahe-cjk-regular.ttf';
function state() {
  if (!globalThis[stateKey]) {
    const projectRoot = path.resolve(process.cwd());
    const dataRoot = process.env.HIREHIRE_DATA_ROOT;
    if (!dataRoot || !path.isAbsolute(dataRoot)) throw new Error('HIREHIRE_DATA_ROOT must be an absolute private persistent path.');
    const testing = process.env.HIREHIRE_ALLOW_TEMPORARY_DATA_FOR_TESTS === 'true';
    const forbiddenRoots = testing ? ['public', '.next', 'dist'].map(part => path.join(projectRoot, part)) : [projectRoot];
    const RATE_LIMIT_SALT = process.env.HIREHIRE_RATE_LIMIT_SALT;
    if (!RATE_LIMIT_SALT || RATE_LIMIT_SALT.length < 24) throw new Error('HIREHIRE_RATE_LIMIT_SALT must be a server-only value of at least 24 characters.');
    const DB = openSqliteDatabase({ dataRoot, migrationDirectory: path.join(projectRoot, 'drizzle'), allowTemporaryRootForTests: testing, forbiddenRoots });
    try {
      const BUCKET = new PrivateFileStore({ objectRoot: path.join(dataRoot, 'private-objects'), allowTemporaryRootForTests: testing, forbiddenRoots });
      globalThis[stateKey] = { DB, BUCKET, RATE_LIMIT_SALT, projectRoot };
    } catch (error) { DB.close(); throw error; }
  }
  return globalThis[stateKey];
}

// Module imports during Next build do not open storage or load runtime secrets.
export const env = new Proxy({}, { get(_target, property) {
  if (property === 'DB' || property === 'BUCKET' || property === 'RATE_LIMIT_SALT') return state()[property];
  return undefined;
} });

export function releaseChannel() {
  const channel = process.env.HIREHIRE_RELEASE_CHANNEL || 'preview';
  if (!['preview', 'candidate', 'production'].includes(channel)) throw new Error('HIREHIRE_RELEASE_CHANNEL is invalid.');
  return channel;
}
export function writesEnabled() {
  const value = process.env.HIREHIRE_WRITES_ENABLED || 'false';
  if (!['true', 'false'].includes(value)) throw new Error('HIREHIRE_WRITES_ENABLED must be true or false.');
  return value === 'true';
}
export async function initializeNodeRuntime() { releaseChannel(); writesEnabled(); await state().BUCKET.ready(); }
export async function checkRuntimeReadiness() {
  const current = state();
  for (const table of ['intake_records', 'intake_photos', 'candidate_publications', 'record_matches', 'site_settings', 'intake_rate_limits']) {
    await current.DB.prepare(`SELECT * FROM ${table} LIMIT 0`).all();
  }
  await current.BUCKET.checkReady();
  await access(path.join(current.projectRoot, fontRelativePath), constants.R_OK);
}
export async function loadPdfFont() {
  // Fixed licensed asset; no request URL, public network or arbitrary path.
  return new Uint8Array(await readFile(path.join(state().projectRoot, fontRelativePath)));
}
export function runtimeSession() { const session = managementSession(); return { ...session, name: session.operatorName }; }
export function expectedOrigin() { return expectedRequestOrigin() ?? null; }
export function clientIp() {
  const context = getRequestContext();
  if (!context) throw new Error('Node request transport context is absent.');
  return context.clientIp;
}
export function closeNodeRuntime() {
  globalThis[stateKey]?.DB.close();
  delete globalThis[stateKey];
}
