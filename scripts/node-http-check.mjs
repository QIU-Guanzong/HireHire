import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, lstat, realpath, readdir } from 'node:fs/promises';
import { resolve, relative, dirname, isAbsolute, sep } from 'node:path';
import { deflateSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// A real local Node server, a fresh synthetic database, and a private Unix
// listener are mandatory. This script never targets a production hostname,
// imports a production credential, writes SQL, or removes stored fixtures.
const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index], value = process.argv[index + 1];
  assert(/^--[a-z-]+$/.test(name) && value && !value.startsWith('--'), 'Use explicit --option value arguments.');
  assert(!options.has(name), `Duplicate option: ${name}`);
  options.set(name, value);
}
const allowedOptions = ['--origin', '--admin-origin', '--admin-socket', '--data-root', '--object-root', '--phase'];
assert([...options.keys()].every(name => allowedOptions.includes(name)), 'Unknown test option.');
const phase = options.get('--phase') || 'exercise';
assert(['exercise', 'restart', 'closed', 'write-closed', 'proxy'].includes(phase), 'Supported phases: exercise, restart, closed, write-closed, proxy.');
function loopbackOrigin(input) {
  assert(input, 'An explicit loopback origin is required.');
  const url = new URL(input);
  assert(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Only HTTP loopback is permitted.');
  assert(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'Specify an origin without credentials or a path.');
  return url;
}
const publicUrl = loopbackOrigin(options.get('--origin'));
const managementUrl = loopbackOrigin(options.get('--admin-origin'));
assert(publicUrl.origin !== managementUrl.origin, 'Public and management origins must be distinct.');
const taskRoot = resolve('work/gcp-migration');
const dataRoot = resolve(options.get('--data-root') || '');
assert(options.has('--data-root') && isAbsolute(options.get('--data-root')), 'An absolute isolated data path is mandatory.');
function within(parent, child) {
  const path = relative(parent, child);
  return path === '' || !path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path);
}
assert(within(taskRoot, dataRoot) && dataRoot !== taskRoot || /^\/tmp\/hirehire-node-test-[a-zA-Z0-9_-]+(?:\/|$)/.test(dataRoot), 'Data must be in this task work directory or an explicitly named test directory.');
assert((await realpath(dataRoot)) === dataRoot && (await lstat(dataRoot)).isDirectory(), 'The data directory must exist and must not use symlinks.');
const runRoot = dirname(dataRoot);
const socketPath = resolve(options.get('--admin-socket') || '');
assert(options.has('--admin-socket') && isAbsolute(options.get('--admin-socket')) && within(runRoot, socketPath), 'The private socket must be in the same isolated run directory.');
assert(!within(dataRoot, socketPath), 'Keep the management socket outside the persistent data directory.');
const objectRoot = resolve(options.get('--object-root') || resolve(dataRoot, 'private-objects'));
assert(within(dataRoot, objectRoot) && objectRoot !== dataRoot, 'The private object root must be inside this isolated data directory.');
const evidenceRoot = resolve(runRoot, 'http-evidence');
const databasePath = resolve(dataRoot, 'hirehire.sqlite');
assert((await realpath(databasePath)) === databasePath && (await lstat(databasePath)).isFile(), 'The isolated SQLite file must exist and must not be a symlink.');
const database = new DatabaseSync(databasePath, { readOnly: true });
const tables = ['candidate_publications', 'intake_photos', 'intake_rate_limits', 'intake_records', 'record_matches', 'site_settings'];
const counts = () => Object.fromEntries(tables.map(table => [table, Number(database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get().total)]));
const logicalSnapshot = () => Object.fromEntries(tables.filter(table => table !== 'intake_rate_limits').map(table => [table, sha(JSON.stringify(database.prepare(`SELECT * FROM ${table} ORDER BY id`).all()))]));
const completeSnapshot = () => Object.fromEntries(tables.map(table => [table, sha(JSON.stringify(database.prepare(`SELECT * FROM ${table} ORDER BY ${table === 'intake_rate_limits' ? 'key' : 'id'}`).all()))]));
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
const checks = [], fixtureIds = { records: [], photos: [], publications: [], matches: [] };
const started = new Date().toISOString();
let marker, savedManifest;
const check = (condition, message) => { assert(condition, message); checks.push(message); };
const run = promisify(execFile);

async function request(path, { admin = false, method = 'GET', body, bytes, contentType, headers = {} } = {}) {
  assert(path.startsWith('/') && !path.startsWith('//') && !path.includes('://'), 'Only relative API paths are permitted.');
  const endpoint = admin ? managementUrl : publicUrl;
  const encoded = body === undefined ? bytes : Buffer.from(JSON.stringify(body));
  assert(!(body !== undefined && bytes !== undefined), 'Specify JSON or bytes, not both.');
  return new Promise((resolveResponse, reject) => {
    const req = httpRequest({
      ...(admin ? { socketPath } : { hostname: publicUrl.hostname === '[::1]' ? '::1' : '127.0.0.1', port: publicUrl.port }),
      path, method,
      headers: { Host: endpoint.host, ...(encoded !== undefined ? { Origin: endpoint.origin, 'Content-Type': contentType || (body !== undefined ? 'application/json' : 'image/png'), 'Content-Length': String(encoded.byteLength) } : {}), ...headers },
      timeout: 60000,
    }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 96 * 1024 * 1024) { response.destroy(new Error('Local test response exceeds the evidence limit.')); return; } chunks.push(chunk); });
      response.on('end', () => resolveResponse({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Local HTTP test timed out.')));
    req.on('error', reject);
    if (encoded !== undefined) req.write(encoded);
    req.end();
  });
}
function status(response, expected, message) {
  check(response.status === expected, `${message}: expected ${expected}, got ${response.status}`);
  return response;
}
function json(response, expected, message) {
  status(response, expected, message);
  check((response.headers['content-type'] || '').includes('application/json'), `${message}: JSON response`);
  check(response.headers['cache-control'] === 'no-store', `${message}: not cached`);
  return JSON.parse(response.bytes.toString('utf8'));
}
const spoofedIdentity = {
  'oai-authenticated-user-id': 'synthetic-local-operator',
  'oai-authenticated-user-email': 'synthetic-admin@example.test',
  'oai-authenticated-user-name': 'Synthetic management fixture',
  'x-forwarded-user': 'synthetic-local-operator', 'x-forwarded-email': 'synthetic-admin@example.test',
  'x-goog-authenticated-user-id': 'accounts.google.com:synthetic-local-operator',
  'x-goog-authenticated-user-email': 'accounts.google.com:synthetic-admin@example.test',
  'x-goog-iap-jwt-assertion': 'synthetic.invalid.signature',
  'x-hirehire-channel': 'admin', 'x-hirehire-admin': 'true',
  Authorization: 'Bearer synthetic-invalid-test-value', Cookie: '__sites_local_auth=1',
  'x-forwarded-for': '198.51.100.201', 'cf-connecting-ip': '198.51.100.202',
  'x-forwarded-host': managementUrl.host, 'x-forwarded-proto': 'https',
  Forwarded: 'for=198.51.100.203;proto=https;host=synthetic.invalid',
};

function portraitFixture() {
  // Generated colored rectangles, not a real portrait or copied image.
  const width = 64, height = 80, raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const color = x >= 16 && x < 48 && y >= 15 && y < 65 ? [96, 64, 107] : [239, 227, 156];
    const offset = y * (width * 3 + 1) + 1 + x * 3;
    color.forEach((value, index) => { raw[offset + index] = value; });
  }
  const crc = input => { let value = 0xffffffff; for (const byte of input) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; };
  const chunk = (type, payload) => { const name = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(payload.length); checksum.writeUInt32BE(crc(Buffer.concat([name, payload]))); return Buffer.concat([length, name, payload, checksum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function minimalEmployer(suffix) {
  return { fullName: `${marker}${suffix}`, phone: '+852 00000005', district: '沙田', householdAdults: '2', services: ['家傭'], employmentType: '全職非住家', duties: ['煮食'], startDate: '2026-11-02', schedule: '合成測試星期一至五', budgetNegotiable: true, consent: true };
}
function minimalSeeker(suffix) {
  return { fullName: `${marker}${suffix}`, phone: '+852 00000004', nationality: '香港', currentLocation: '香港', services: ['家傭'], languages: ['廣東話'], yearsExperience: '3–5年', workHistory: '合成私密履歷', employmentType: '全職非住家', workLocations: ['全香港'], availableFrom: '2026-11-01', salaryNegotiable: true, publicProfileConsent: false, consent: true };
}
async function objectSnapshot() {
  assert(await realpath(objectRoot) === objectRoot, 'Private object root must not use symlinks.');
  const entries = [];
  async function visit(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const file = resolve(directory, name), info = await lstat(file);
      assert(!info.isSymbolicLink(), 'The private object fixture tree must contain no symlinks.');
      if (info.isDirectory()) await visit(file);
      else {
        assert(info.isFile(), 'Private object evidence only reads regular files.');
        entries.push({ path: relative(objectRoot, file), bytes: info.size, mode: info.mode & 0o777, sha256: sha(await readFile(file)) });
      }
    }
  }
  await visit(objectRoot);
  return entries;
}
async function writeClosedCheck() {
  const before = completeSnapshot(), objectsBefore = await objectSnapshot();
  check(objectsBefore.length === 0, 'Write-closed phase starts with no private object files');
  for (const kind of ['employer', 'jobseeker']) {
    const data = kind === 'employer' ? minimalEmployer('寫入關閉僱主') : minimalSeeker('寫入關閉求職');
    json(await request('/api/intake', { method: 'POST', body: { kind, data, idempotencyKey: randomUUID() } }), 503, `Correct-origin valid ${kind} intake is refused while writes are disabled`);
  }
  json(await request('/api/intake-photo', { method: 'POST', bytes: portraitFixture() }), 503, 'Correct-origin valid photo upload is refused while writes are disabled');
  for (const [path, method, body] of [
    ['/api/admin/candidates', 'POST', { intakeId: randomUUID() }],
    [`/api/admin/records/${randomUUID()}`, 'PATCH', { notes: 'SYNTHETIC_DENIED_NOTE', expectedUpdatedAt: new Date().toISOString() }],
    ['/api/admin/settings', 'PATCH', { expectedUpdatedAt: '' }],
    ['/api/admin/matches', 'POST', { employerId: randomUUID(), jobseekerId: randomUUID() }],
  ]) status(await request(path, { method, body, headers: spoofedIdentity }), 401, 'Anonymous/forged admin mutation is denied before the write switch');
  const after = completeSnapshot(), objectsAfter = await objectSnapshot();
  check(JSON.stringify(after) === JSON.stringify(before), 'Disabled writes leave all six tables byte-equivalent, including intake quotas');
  check(JSON.stringify(objectsAfter) === JSON.stringify(objectsBefore), 'Disabled photo writes create no private object files');
  await writeFile(resolve(evidenceRoot, 'write-closed-proof.json'), JSON.stringify({ syntheticOnly: true, before, after, objectsBefore, objectsAfter, tableCounts: counts(), productionWrites: 0 }, null, 2) + '\n', { mode: 0o600 });
}
async function proxyCheck() {
  // This phase simulates the explicitly approved loopback Nginx boundary.
  // A real reverse proxy must overwrite this dedicated header for web clients.
  // Direct loopback clients are inside that trust boundary; this test does not
  // claim an Internet client can safely supply X-HireHire-Client-IP unchanged.
  const addresses = ['198.51.100.71', '203.0.113.72'];
  let counter = 0;
  async function submit(headers, expected, message) {
    const response = await request('/api/intake', { method: 'POST', body: { kind: 'employer', data: minimalEmployer(`代理配額${++counter}`), idempotencyKey: randomUUID() }, headers });
    const receipt = json(response, expected, message);
    if (expected === 201) {
      const row = database.prepare('SELECT id FROM intake_records WHERE reference = ?').get(receipt.reference);
      check(Boolean(row), 'Proxy quota success has an exact persistent synthetic record');
      fixtureIds.records.push(row.id);
    }
  }
  function dedicated(address, index) {
    return { ...spoofedIdentity, 'X-HireHire-Client-IP': address, 'cf-connecting-ip': `192.0.2.${30 + index}`, 'x-forwarded-for': `192.0.2.${60 + index}`, Forwarded: `for=192.0.2.${90 + index}` };
  }
  await submit(dedicated(addresses[0], 0), 201, 'Reviewed local proxy first client starts its own quota');
  await submit(dedicated(addresses[1], 0), 201, 'Reviewed local proxy second client starts a distinct quota');
  check(database.prepare('SELECT COUNT(*) AS total FROM intake_rate_limits').get().total === 2, 'Two valid dedicated proxy IPs create two independent rate-limit keys');
  for (let index = 1; index < 8; index++) await submit(dedicated(addresses[0], index), 201, 'Changing CF/XFF/identity headers does not split the first proxy client quota');
  await submit(dedicated(addresses[0], 8), 429, 'First proxy client stops at eight attempts');
  for (let index = 1; index < 8; index++) await submit(dedicated(addresses[1], index), 201, 'The second proxy client retains its independent remaining quota');
  await submit(dedicated(addresses[1], 8), 429, 'Second proxy client also stops at eight attempts');
  check(database.prepare('SELECT COUNT(*) AS total FROM intake_rate_limits').get().total === 2, 'Spoofed legacy IP headers and identity never create extra proxy quota keys');
  const invalidHeaders = [
    {},
    { 'X-HireHire-Client-IP': 'invalid-ip' },
    { 'X-HireHire-Client-IP': '198.51.100.73, 203.0.113.74' },
    { 'X-HireHire-Client-IP': ['198.51.100.75', '203.0.113.76'] },
    { 'X-HireHire-Client-IP': '[::1]' },
    { 'X-HireHire-Client-IP': '198.51.100.77:1234' },
    { 'X-HireHire-Client-IP': 'localhost' },
    { 'X-HireHire-Client-IP': '999.999.999.999' },
  ];
  for (const headers of invalidHeaders) await submit({ ...spoofedIdentity, ...headers }, 201, 'Missing, invalid, listed or duplicated dedicated IP falls back to the actual peer');
  await submit({ ...spoofedIdentity, 'X-HireHire-Client-IP': ['192.0.2.181', '192.0.2.182'] }, 429, 'Another duplicated dedicated header cannot bypass the exhausted peer quota');
  check(database.prepare('SELECT COUNT(*) AS total FROM intake_rate_limits').get().total === 3 && database.prepare('SELECT attempts FROM intake_rate_limits').all().every(row => row.attempts === 8), 'Only two reviewed client keys and one peer fallback key exist, each capped at eight');
  const rows = database.prepare('SELECT id, data_json FROM intake_records').all();
  check(rows.length === 24 && rows.every(row => JSON.parse(row.data_json).fullName.startsWith(marker) && fixtureIds.records.includes(row.id)), 'Proxy quota phase retains exactly 24 owned synthetic registrations');
  check((await objectSnapshot()).length === 0, 'Proxy-only intake checks write no private photos');
  await privateDenials();
  await writeFile(resolve(evidenceRoot, 'proxy-proof.json'), JSON.stringify({ syntheticOnly: true, trustedLoopbackProxyBoundary: true, internetClientHeaderOverwriteVerified: false, syntheticClientAddresses: addresses, limits: database.prepare('SELECT key, attempts FROM intake_rate_limits ORDER BY key').all(), fixtureIds, tableCounts: counts(), productionWrites: 0 }, null, 2) + '\n', { mode: 0o600 });
}
async function privateDenials(id = randomUUID(), employerId = randomUUID()) {
  for (const mode of ['client', 'full']) for (const route of [`/api/admin/export?ids=${id}&mode=${mode}`, `/api/admin/matches/export?employerId=${employerId}&mode=${mode}`]) {
    for (const headers of [{}, spoofedIdentity]) {
      const denied = await request(route, { headers });
      status(denied, 401, `Public ${route} ${Object.keys(headers).length ? 'forged identity' : 'anonymous'} denied`);
      check(denied.headers['cache-control'] === 'no-store', 'Private PDF denial cannot be cached');
      check((denied.headers['content-type'] || '').includes('application/json') && !denied.bytes.subarray(0, 5).equals(Buffer.from('%PDF-')), 'Private denial returns no PDF bytes');
    }
  }
  for (const path of ['/api/admin/records', '/api/admin/candidates', '/api/admin/matches', '/api/admin/settings', `/api/admin/photos/${id}`]) status(await request(path, { headers: spoofedIdentity }), 401, `Public forged identity cannot access ${path}`);
  const session = json(await request('/api/admin/session', { headers: spoofedIdentity }), 200, 'Public forged session');
  check(!session.authenticated && !session.authorized, 'Public request headers cannot create a management identity');
}
async function pdfCheck(response, filename, { mode, included = [], excluded = [], ids = [] }) {
  status(response, 200, `${filename} generated`);
  check(response.headers['content-type'] === 'application/pdf' && response.headers['cache-control'] === 'no-store', `${filename} private/public PDF response is uncached`);
  check(response.bytes.subarray(0, 5).equals(Buffer.from('%PDF-')), `${filename} has a real PDF signature`);
  if (mode) check(response.headers['content-disposition'].includes(`-${mode}-`), `${filename} identifies its actual PDF mode`);
  const file = resolve(evidenceRoot, `${filename}.pdf`);
  await writeFile(file, response.bytes, { mode: 0o600 });
  const text = (await run('pdftotext', [file, '-'], { maxBuffer: 8 * 1024 * 1024 })).stdout;
  const compact = text.replace(/\s/g, '');
  for (const value of included) check(compact.includes(value.replace(/\s/g, '')), `${filename} retains synthetic allowed field ${value}`);
  for (const value of excluded) check(!compact.includes(value.replace(/\s/g, '')), `${filename} excludes synthetic private field ${value}`);
  if (ids.length > 1) check(ids.every((id, index) => index === 0 || compact.indexOf(ids[index - 1]) < compact.indexOf(id)), `${filename} keeps explicit selected-record order`);
  return { file, bytes: response.bytes.length, sha256: sha(response.bytes) };
}
async function recordByReference(reference) {
  const row = database.prepare('SELECT id FROM intake_records WHERE reference = ?').get(reference);
  check(Boolean(row), 'Submitted receipt maps to exactly one persistent SQLite record');
  if (!fixtureIds.records.includes(row.id)) fixtureIds.records.push(row.id);
  return json(await request(`/api/admin/records/${row.id}`, { admin: true }), 200, 'Private saved record readback');
}
async function upload(bytes) {
  const photo = json(await request('/api/intake-photo', { method: 'POST', bytes }), 201, 'Synthetic photo stored privately');
  fixtureIds.photos.push(photo.id);
  const metadata = database.prepare('SELECT * FROM intake_photos WHERE id = ?').get(photo.id);
  check(metadata.token_hash === sha(photo.token) && metadata.token_hash !== photo.token && metadata.attached_record_id === null, 'Private photo token is hashed and initially unattached');
  return photo;
}
async function publication(record) {
  const draft = json(await request('/api/admin/candidates', { admin: true, method: 'POST', body: { intakeId: record.id } }), 201, 'Management creates draft candidate');
  fixtureIds.publications.push(draft.id);
  check(draft.state === 'draft' && draft.workExperiences.length === 0 && draft.qualifications === '', 'Draft excludes private work history and certificates');
  status(await request(`/api/candidates/${draft.id}`), 404, 'Draft cannot be accessed publicly');
  return draft;
}
async function publish(draft) {
  return json(await request(`/api/admin/candidates/${draft.id}`, { admin: true, method: 'PATCH', body: { state: 'published', expectedUpdatedAt: draft.updatedAt } }), 200, 'Consented draft published through private management transport');
}
async function photoChecks(record, candidate, bytes) {
  status(await request(`/api/admin/photos/${record.photoId}`), 401, 'Private photo denied on public listener');
  const privatePhoto = status(await request(`/api/admin/photos/${record.photoId}`, { admin: true }), 200, 'Private management photo read');
  check(privatePhoto.headers['cache-control'] === 'no-store' && sha(privatePhoto.bytes) === sha(bytes), 'Private photo stream matches uploaded synthetic bytes');
  const publicPhoto = status(await request(`/api/candidates/${candidate.id}/photo`), 200, 'Published consented photo read');
  check(publicPhoto.headers['cache-control'] === 'no-store' && sha(publicPhoto.bytes) === sha(bytes), 'Published photo projection streams the same private object without shared caching');
  for (const path of [`/intake-photos/${record.photoId}`, `/private-objects/intake-photos/${record.photoId}`, `/data/private-objects/intake-photos/${record.photoId}`]) status(await request(path), 404, 'Private photo object is not a static public file');
  const objectFile = resolve(objectRoot, `intake-photos/${record.photoId}`);
  check(await realpath(objectFile) === objectFile, 'Private object path contains no symlink indirection');
  const fileInfo = await lstat(objectFile);
  check(fileInfo.isFile() && !fileInfo.isSymbolicLink() && (fileInfo.mode & 0o777) === 0o600, 'Photo is a regular private 0600 file');
  check(sha(await readFile(objectFile)) === sha(bytes), 'Photo persists in the isolated filesystem with its exact content');
}

try {
  const initialCounts = counts();
  if (phase === 'restart') {
    savedManifest = JSON.parse(await readFile(resolve(evidenceRoot, 'fixture-manifest.json'), 'utf8'));
    assert(savedManifest.syntheticOnly === true && savedManifest.dataRoot === dataRoot && /^NODE驗證-[a-f\d-]+$/.test(savedManifest.marker), 'Restart requires the exact owned synthetic manifest.');
    marker = savedManifest.marker;
    Object.assign(fixtureIds, savedManifest.fixtureIds);
    check(JSON.stringify(logicalSnapshot()) === JSON.stringify(savedManifest.logicalSnapshot), 'Process restart preserves the five persistent business-table snapshots exactly');
  } else {
    assert(Object.values(initialCounts).every(value => value === 0), 'Every fresh phase requires all six tables to be empty.');
    marker = `NODE驗證-${randomUUID()}`;
  }
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  const health = json(await request('/api/health'), 200, 'Actual local Node readiness');
  const packageInfo = JSON.parse(await readFile('package.json', 'utf8'));
  check(health.version === packageInfo.version && health.runtime === 'node-sqlite', 'Readiness identifies the Node SQLite runtime and the single package version');
  await privateDenials(savedManifest?.primaryRecordId, savedManifest?.employerRecordId);
  status(await request('/api/candidates?sort=SQL'), 400, 'Invalid public catalog sort denied');
  status(await request('/api/site-info', { headers: { Host: 'forged.example.test' } }), 400, 'Public request with a forged Host is rejected by the Node entry');

  if (phase === 'closed' || phase === 'write-closed' || phase === 'proxy') {
    const publicSession = json(await request('/api/admin/session'), 200, 'Default closed management session');
    check(!publicSession.authenticated && !publicSession.authorized && !publicSession.configured, 'Default Node management configuration remains closed');
    let socketExists = true;
    try { await lstat(socketPath); } catch (error) { if (error.code === 'ENOENT') socketExists = false; else throw error; }
    check(!socketExists, 'Disabled management creates no listening Unix socket');
    if (phase === 'write-closed') await writeClosedCheck();
    if (phase === 'proxy') await proxyCheck();
  } else {
    check(await realpath(dirname(socketPath)) === dirname(socketPath), 'The private socket directory contains no symlink indirection');
    const socketInfo = await lstat(socketPath);
    check(socketInfo.isSocket() && (socketInfo.mode & 0o777) === 0o600, 'Management uses a private 0600 Unix socket');
    const session = json(await request('/api/admin/session', { admin: true }), 200, 'Explicit synthetic management session');
    check(session.authenticated && session.authorized && session.configured, 'Only the explicitly configured private Unix transport enters management context');
    const png = portraitFixture();

    if (phase === 'restart') {
      const primary = json(await request(`/api/admin/records/${savedManifest.primaryRecordId}`, { admin: true }), 200, 'Withdrawn record after restart');
      check(primary.data.publicProfileConsent === false && primary.nextFollowUp === '2026-11-03', 'Consent withdrawal and correction survive process restart');
      const persistent = json(await request(`/api/candidates/${savedManifest.persistentCandidateId}`), 200, 'Published candidate after restart');
      const raceRecord = json(await request(`/api/admin/records/${savedManifest.persistentRecordId}`, { admin: true }), 200, 'Photo owner after restart');
      await photoChecks(raceRecord, persistent, png);
      for (const suffix of ['', '/photo', '/pdf']) status(await request(`/api/candidates/${savedManifest.withdrawnCandidateId}${suffix}`), 404, 'Withdrawal remains effective after restart');
      const info = json(await request('/api/site-info'), 200, 'Settings after restart');
      check(info.hours === '合成測試開放時間', 'Company setting survives restart');
      const pair = json(await request(`/api/admin/matches?employerId=${savedManifest.employerRecordId}`, { admin: true }), 200, 'Matching workflow after restart');
      check(pair.total === 1 && pair.matches[0].stage === '安排面試', 'Match stage survives restart');
    } else {
      const seeker = { fullName: `${marker}私密求職甲`, phone: '+852 00000004', email: 'synthetic-seeker-private@example.test', nationality: '香港', currentLocation: '香港', education: '中學', candidateType: '本地求職', age: '38', services: ['家傭', '長者照顧'], languages: ['廣東話', '英語'], yearsExperience: '6–10年', skills: ['煮食', '長者照顧'], workHistory: '合成私密履歷 電話00000004 電郵history-private@example.test', certificates: '合成私密資格', employmentType: '全職非住家', workLocations: ['全香港'], availableFrom: '2026-11-01', expectedSalary: '18000', salaryUnit: '每月', consent: true, publicProfileConsent: true, publicName: '合成公開阿May', publicIntroduction: '合成驗證：熟悉煮食及日常家務。' };
      const employer = { fullName: `${marker}僱主乙`, phone: '+852 00000005', email: 'synthetic-employer-private@example.test', district: '沙田', householdAdults: '2', services: ['家傭'], employmentType: '全職非住家', duties: ['煮食'], startDate: '2026-11-02', schedule: '合成測試星期一至五', budgetNegotiable: true, consent: true };
      const invalidBody = { kind: 'jobseeker', data: seeker, idempotencyKey: randomUUID() };
      status(await request('/api/intake', { method: 'POST', body: invalidBody, headers: { Origin: 'http://wrong.example.test' } }), 403, 'Incorrect public Origin denied');
      status(await request('/api/intake', { method: 'POST', body: invalidBody, headers: { Origin: '' } }), 403, 'Absent public Origin denied');
      status(await request('/api/intake', { method: 'POST', body: invalidBody, headers: { 'sec-fetch-site': 'cross-site' } }), 403, 'Cross-site public submission denied');
      status(await request('/api/intake', { method: 'POST', body: invalidBody, headers: { Host: 'forged.example.test', Origin: 'http://forged.example.test' } }), 400, 'Matching forged Host/Origin cannot redefine the trusted application origin');
      const photo = await upload(png);
      const submission = { ...invalidBody, idempotencyKey: randomUUID(), photo };
      const concurrent = await Promise.all([request('/api/intake', { method: 'POST', body: submission }), request('/api/intake', { method: 'POST', body: submission })]);
      check(concurrent.every(response => [200, 201].includes(response.status)), 'Concurrent identical-key submissions both receive a successful receipt');
      const receipts = concurrent.map(response => JSON.parse(response.bytes.toString('utf8')));
      check(receipts[0].reference === receipts[1].reference && database.prepare('SELECT COUNT(*) AS total FROM intake_records').get().total === 1, 'Concurrent identical keys create exactly one persistent registration');
      let primary = await recordByReference(receipts[0].reference);
      check(primary.photoId === photo.id && database.prepare('SELECT attached_record_id FROM intake_photos WHERE id = ?').get(photo.id).attached_record_id === primary.id, 'Private photo metadata attaches to its only saved registration');
      json(await request('/api/intake', { method: 'POST', body: submission }), 200, 'Identical pending submission retry');
      status(await request('/api/intake', { method: 'POST', body: { ...submission, data: { ...seeker, fullName: `${marker}different` } } }), 409, 'An existing key rejects changed registration data');
      const retryAttempts = database.prepare('SELECT SUM(attempts) AS total FROM intake_rate_limits').get().total;
      let candidate = await publication(primary);
      candidate = await publish(candidate);
      const projection = json(await request(`/api/candidates/${candidate.id}`), 200, 'Published profile projection');
      const encoded = JSON.stringify(projection);
      for (const value of [marker, '00000004', seeker.email, '合成私密履歷', '合成私密資格', 'intakeId', 'token', 'notes', 'source_data_json']) check(!encoded.includes(value), `Public profile excludes private source ${value}`);
      await photoChecks(primary, candidate, png);
      const filtered = json(await request(`/api/candidates?ids=${candidate.id}&district=${encodeURIComponent('沙田')}`), 200, 'Public district filter');
      check(filtered.total === 1 && filtered.candidates[0].id === candidate.id, 'Whole-Hong-Kong work availability matches the selected district');
      const employerReceipt = json(await request('/api/intake', { method: 'POST', body: { kind: 'employer', data: employer, candidateIds: [candidate.id], idempotencyKey: randomUUID() } }), 201, 'Independent employer registration');
      const employerRecord = await recordByReference(employerReceipt.reference);
      check(employerRecord.requestedCandidateIds[0] === candidate.id, 'Employer inquiry retains selected public candidate');
      const list = json(await request(`/api/admin/matches?employerId=${employerRecord.id}`, { admin: true }), 200, 'Automatic match workflow');
      check(list.total === 1 && list.matches[0].jobseekerId === primary.id, 'Employer selection creates exactly one matching pair');
      let match = list.matches[0]; fixtureIds.matches.push(match.id);
      const matchBody = { stage: '安排面試', interviewAt: '2026-11-05T10:00', notes: 'SYNTHETIC_PRIVATE_MATCH_NOTE', expectedUpdatedAt: match.updatedAt };
      const changedMatch = json(await request(`/api/admin/matches/${match.id}`, { admin: true, method: 'PATCH', body: matchBody }), 200, 'Private match stage edit');
      status(await request(`/api/admin/matches/${match.id}`, { admin: true, method: 'PATCH', body: { stage: '已完成', expectedUpdatedAt: match.updatedAt } }), 409, 'Stale match version denied');
      match = changedMatch;
      const duplicate = json(await request('/api/admin/matches', { admin: true, method: 'POST', body: { employerId: employerRecord.id, jobseekerId: primary.id, stage: '已完成' } }), 200, 'Duplicate matching pair');
      check(duplicate.id === match.id && duplicate.stage === '安排面試', 'Duplicate matching does not overwrite the existing stage');

      const source = database.prepare('SELECT data_json, request_hash FROM intake_records WHERE id = ?').get(primary.id);
      const oldVersion = primary.updatedAt;
      status(await request(`/api/admin/records/${primary.id}`, { admin: true, method: 'PATCH', body: { notes: 'must not save', expectedUpdatedAt: oldVersion }, headers: { Origin: publicUrl.origin } }), 403, 'Public Origin cannot write through the management listener');
      primary = json(await request(`/api/admin/records/${primary.id}`, { admin: true, method: 'PATCH', body: { data: { ...primary.data, fullName: `${marker}更正後求職甲` }, notes: 'SYNTHETIC_PRIVATE_RECORD_NOTE', nextFollowUp: '2026-11-03', expectedUpdatedAt: oldVersion } }), 200, 'Private registration correction');
      status(await request(`/api/admin/records/${primary.id}`, { admin: true, method: 'PATCH', body: { notes: 'stale', expectedUpdatedAt: oldVersion } }), 409, 'Stale corrected-record version denied');
      const corrected = database.prepare('SELECT original_data_json, request_hash FROM intake_records WHERE id = ?').get(primary.id);
      check(corrected.original_data_json === source.data_json && corrected.request_hash === source.request_hash, 'Correction preserves the immutable original submission JSON and request hash');
      check(primary.nextFollowUp === '2026-11-03' && primary.data.fullName.endsWith('更正後求職甲'), 'Corrected registration and follow-up persist');
      json(await request('/api/intake', { method: 'POST', body: submission }), 200, 'Original pending receipt survives staff correction');
      check(database.prepare('SELECT SUM(attempts) AS total FROM intake_rate_limits').get().total === retryAttempts + 1, 'Same-key retries never spend a new intake quota attempt');

      const hiddenReceipt = json(await request('/api/intake', { method: 'POST', body: { kind: 'jobseeker', data: { ...seeker, fullName: `${marker}未同意丙`, publicProfileConsent: false }, idempotencyKey: randomUUID() } }), 201, 'Independent non-public jobseeker registration');
      const hidden = await recordByReference(hiddenReceipt.reference);
      const hiddenDraft = await publication(hidden);
      status(await request(`/api/admin/candidates/${hiddenDraft.id}`, { admin: true, method: 'PATCH', body: { state: 'published', expectedUpdatedAt: hiddenDraft.updatedAt } }), 400, 'A registration without consent cannot be published');
      status(await request(`/api/admin/records/${hidden.id}`, { admin: true, method: 'PATCH', body: { data: { ...hidden.data, publicProfileConsent: true }, expectedUpdatedAt: hidden.updatedAt } }), 400, 'Management cannot manufacture applicant public consent');

      const racePhoto = await upload(png);
      const raceBodies = ['甲', '乙'].map(suffix => ({ kind: 'jobseeker', data: { ...seeker, fullName: `${marker}照片競爭${suffix}` }, idempotencyKey: randomUUID(), photo: racePhoto }));
      const beforeRaceCount = database.prepare('SELECT COUNT(*) AS total FROM intake_records').get().total;
      const claims = await Promise.all(raceBodies.map(body => request('/api/intake', { method: 'POST', body })));
      check(claims.filter(response => response.status === 201).length === 1 && claims.filter(response => response.status === 400).length === 1, 'Concurrent different-key claims on one photo have exactly one success and one rejection');
      check(database.prepare('SELECT COUNT(*) AS total FROM intake_records').get().total === beforeRaceCount + 1, 'Rejected photo claimant leaves no registration behind');
      const raceReceipt = JSON.parse(claims.find(response => response.status === 201).bytes.toString('utf8'));
      const raceRecord = await recordByReference(raceReceipt.reference);
      check(database.prepare('SELECT attached_record_id FROM intake_photos WHERE id = ?').get(racePhoto.id).attached_record_id === raceRecord.id && database.prepare('SELECT COUNT(*) AS total FROM intake_records WHERE photo_id = ?').get(racePhoto.id).total === 1, 'One private photo has exactly one owning registration after the concurrent claims');
      const persistentCandidate = await publish(await publication(raceRecord));
      await photoChecks(raceRecord, persistentCandidate, png);

      const privateFields = ['00000004', '00000005', seeker.email, employer.email, 'history-private@example.test', 'SYNTHETIC_PRIVATE_RECORD_NOTE', 'SYNTHETIC_PRIVATE_MATCH_NOTE'];
      const pdfEvidence = [];
      pdfEvidence.push(await pdfCheck(await request(`/api/candidates/${candidate.id}/pdf`), 'public-candidate', { included: [seeker.publicName, seeker.publicIntroduction], excluded: [...privateFields, marker, '合成私密履歷', '合成私密資格'] }));
      pdfEvidence.push(await pdfCheck(await request(`/api/candidates/export?ids=${candidate.id},${persistentCandidate.id}`), 'public-selected-candidates', { included: [seeker.publicName], excluded: [...privateFields, marker] }));
      for (const mode of ['client', 'full']) {
        const excluded = mode === 'client' ? privateFields : [];
        const included = mode === 'full' ? ['00000004', seeker.email, 'SYNTHETIC_PRIVATE_RECORD_NOTE'] : ['[電話已隱去]', '[電郵已隱去]'];
        pdfEvidence.push(await pdfCheck(await request(`/api/admin/export?ids=${employerRecord.id},${primary.id}&mode=${mode}`, { admin: true }), `records-${mode}`, { mode, included, excluded, ids: [employerRecord.reference, primary.reference] }));
        pdfEvidence.push(await pdfCheck(await request(`/api/admin/matches/export?employerId=${employerRecord.id}&mode=${mode}`, { admin: true }), `matches-${mode}`, { mode, included: [...included, '安排面試', ...(mode === 'full' ? ['SYNTHETIC_PRIVATE_MATCH_NOTE'] : [])], excluded }));
      }
      await privateDenials(primary.id, employerRecord.id);
      status(await request(`/api/candidates/export?ids=${Array.from({ length: 4 }, randomUUID).join(',')}`), 400, 'Public selected PDF cannot exceed three profiles');
      const oldSetting = json(await request('/api/admin/settings', { admin: true }), 200, 'Private company settings read');
      const settingBody = { ...oldSetting, hours: '合成測試開放時間', expectedUpdatedAt: oldSetting.updatedAt };
      const setting = json(await request('/api/admin/settings', { admin: true, method: 'PATCH', body: settingBody }), 200, 'Private company settings update');
      check(setting.hours === '合成測試開放時間', 'Company settings persist');
      status(await request('/api/admin/settings', { admin: true, method: 'PATCH', body: settingBody }), 409, 'Stale company settings version denied');
      const publicSetting = json(await request('/api/site-info'), 200, 'Public projection of approved company settings');
      check(publicSetting.hours === setting.hours, 'Approved company settings appear in the public projection');

      primary = json(await request(`/api/admin/records/${primary.id}`, { admin: true, method: 'PATCH', body: { data: { ...primary.data, publicProfileConsent: false }, expectedUpdatedAt: primary.updatedAt } }), 200, 'Withdraw applicant public consent');
      for (const suffix of ['', '/photo', '/pdf']) status(await request(`/api/candidates/${candidate.id}${suffix}`), 404, 'Consent withdrawal immediately removes profile, photo and PDF');
      const after = json(await request(`/api/candidates?ids=${candidate.id}`), 200, 'Withdrawn catalog query');
      check(after.total === 0, 'Consent withdrawal removes the public catalog projection');
      status(await request(`/api/candidates/export?ids=${candidate.id}`), 404, 'Withdrawn candidate cannot be exported through a selected public PDF');
      status(await request(`/api/admin/photos/${primary.photoId}`, { admin: true }), 200, 'Consent withdrawal retains privately owned photo for authorized staff');

      // Consume only the remaining quota in this new isolated test database.
      // Changing all untrusted IP/identity headers must never create a new key.
      const actualRateKeys = database.prepare('SELECT key FROM intake_rate_limits').all().map(row => row.key);
      check(actualRateKeys.length === 1, 'All public submissions share the same actual loopback peer quota key');
      for (let attempt = 0; attempt < 9; attempt++) {
        const ipSpoof = { 'cf-connecting-ip': `198.51.100.${10 + attempt}`, 'x-forwarded-for': `203.0.113.${10 + attempt}`, Forwarded: `for=192.0.2.${10 + attempt}`, ...Object.fromEntries(Object.entries(spoofedIdentity).filter(([name]) => /authenticated|channel|admin/i.test(name))) };
        const response = await request('/api/intake', { method: 'POST', body: { kind: 'employer', data: { ...employer, fullName: `${marker}配額${attempt}` }, idempotencyKey: randomUUID() }, headers: ipSpoof });
        if (response.status === 429) { check(true, 'Untrusted IP and identity spoofing cannot bypass the eight-attempt limit'); break; }
        status(response, 201, 'Only an actually remaining synthetic quota attempt can succeed');
        await recordByReference(JSON.parse(response.bytes.toString('utf8')).reference);
        assert(attempt < 8, 'The server did not enforce its public intake quota.');
      }
      status(await request('/api/intake', { method: 'POST', body: { kind: 'employer', data: employer, idempotencyKey: randomUUID() }, headers: { 'cf-connecting-ip': '192.0.2.222', 'x-forwarded-for': '198.51.100.222' } }), 429, 'Another forged IP still hits the exhausted peer quota');
      json(await request('/api/intake', { method: 'POST', body: submission }), 200, 'An existing uncertain-submission retry still succeeds after quota exhaustion');
      check(database.prepare('SELECT COUNT(*) AS total FROM intake_rate_limits').get().total === 1 && database.prepare('SELECT attempts FROM intake_rate_limits').get().attempts === 8, 'Forged headers create neither another quota row nor attempts beyond eight');
      const finalRows = database.prepare('SELECT id, data_json FROM intake_records').all();
      check(finalRows.every(row => JSON.parse(row.data_json).fullName.startsWith(marker)) && finalRows.every(row => fixtureIds.records.includes(row.id)), 'Every retained registration belongs to the exact synthetic fixture set');
      savedManifest = { syntheticOnly: true, marker, dataRoot, databasePath, objectRoot, fixtureIds, primaryRecordId: primary.id, employerRecordId: employerRecord.id, withdrawnCandidateId: candidate.id, persistentCandidateId: persistentCandidate.id, persistentRecordId: raceRecord.id, portraitSha256: sha(png), logicalSnapshot: logicalSnapshot(), tableCounts: counts(), pdfEvidence };
      await writeFile(resolve(evidenceRoot, 'fixture-manifest.json'), JSON.stringify(savedManifest, null, 2) + '\n', { mode: 0o600 });
    }
  }
  console.log(JSON.stringify({ passed: true, phase, checks: checks.length, syntheticOnly: true, loopbackOnly: true, evidenceRoot }));
} catch (error) {
  console.error(JSON.stringify({ passed: false, phase, checks: checks.length, error: error.message, syntheticOnly: true, loopbackOnly: true }));
  process.exitCode = 1;
} finally {
  // Retain the new synthetic database and its exact objects as restart evidence.
  // There is deliberately no broad cleanup SQL, directory removal or real-data read.
  try {
    await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
    await writeFile(resolve(evidenceRoot, `report-${phase}.json`), JSON.stringify({ passed: process.exitCode !== 1, phase, started, finished: new Date().toISOString(), checks: checks.length, assertions: checks, marker, syntheticOnly: true, loopbackOnly: true, fixtureIds, tableCounts: counts(), persistentFixturesRetained: true, productionWrites: 0 }, null, 2) + '\n', { mode: 0o600 });
  } finally { database.close(); }
}
