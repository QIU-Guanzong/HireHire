import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';

if (process.argv.includes('--unit')) {
  await import('./platform-check.mjs');
  process.exit(0);
}

// This check is intentionally restricted to the local Sites development server.
const base = process.argv[2] || 'http://127.0.0.1:5173';
const origin = new URL(base).origin;
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Backend checks may only run on loopback.');
const run = promisify(execFile);
const retain = process.argv.includes('--retain');
const marker = `驗證-${randomUUID().slice(0, 8)}`;
const fixtureIp = '203.0.113.222';
const startedHour = Math.floor(Date.now() / 3600000);
const createdIds = [];
let passed = 0;
let rateLimitReached = false;

async function request(path, init = {}, authorized = false) {
  return fetch(`${origin}${path}`, { ...init, headers: { ...(authorized ? { Cookie: '__sites_local_auth=1' } : {}), ...(init.headers || {}) } });
}
const send = (body, extra = {}) => request('/api/intake', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'cf-connecting-ip': fixtureIp, ...extra }, body: JSON.stringify(body) });
function check(condition, message) { assert(condition, message); passed++; }
const data = {
  jobseeker: { fullName: `${marker}陳美玲`, phone: '+852 6123 4567', email: 'applicant@example.test', nationality: '香港', currentLocation: '香港', services: ['家傭', '長者照顧'], languages: ['廣東話', '英語'], yearsExperience: '6–10年', skills: ['煮食', '長者照顧'], workHistory: '曾於香港家庭工作六年，負責煮食、家居整理及照顧長者。\n熟悉陪診與日常起居協助。', employmentType: '全職非住家', workLocations: ['全香港'], availableFrom: '2026-11-01', expectedSalary: '18000', salaryUnit: '每月', consent: true },
  employer: { fullName: `${marker}黃先生`, phone: '+852 6789 1234', email: 'employer@example.test', district: '沙田', householdAdults: '2', children: '一位，五歲', elderly: '一位長者，需要陪診', pets: '一隻貓', homeSize: '650', services: ['家傭', '家居清潔'], employmentType: '全職非住家', duties: ['煮食', '清潔及熨衣', '長者照顧'], preferredLanguages: ['廣東話'], startDate: '2026-11-02', schedule: '星期一至六，上午八時至下午六時。', budget: '19000', budgetUnit: '每月', consent: true },
};

try {
  const session = await request('/api/admin/session');
  const sessionData = await session.json();
  check(session.status === 200 && sessionData.authorized === false, 'Anonymous session cannot authorize.');
  const spoofed = await request('/api/admin/records', { headers: { 'oai-authenticated-user-email': 'seedy@sites.test' } });
  check(spoofed.status === 401, 'Development dispatcher removes forged identity headers.');
  const auth = await (await request('/api/admin/session', {}, true)).json();
  assert(auth.authorized, 'Set ADMIN_EMAILS=seedy@sites.test in ignored local .dev.vars, then restart local development server.');
  check((await request('/api/admin/export?scope=all')).status === 401, 'Anonymous export denied.');
  let response = await send({ kind: 'jobseeker', data: data.jobseeker, idempotencyKey: randomUUID(), website: '' }, { Origin: 'https://example.test' });
  check(response.status === 403, 'Cross-origin form submission denied.');
  response = await send({ kind: 'jobseeker', data: { ...data.jobseeker, consent: false }, idempotencyKey: randomUUID(), website: '' });
  const missingConsent = await response.json();
  check(response.status === 400 && Boolean(missingConsent.fields.consent), 'Consent validated server-side.');
  response = await send({ kind: 'employer', data: { ...data.employer, district: '未知地區', householdAdults: '-1' }, idempotencyKey: randomUUID(), website: '' });
  const invalid = await response.json();
  check(response.status === 400 && Boolean(invalid.fields.district) && Boolean(invalid.fields.householdAdults), 'Enums and number ranges validated.');
  check((await send({ kind: 'employer', data: { ...data.employer, unrecognized: true }, idempotencyKey: randomUUID() })).status === 400, 'Unknown form fields rejected.');
  check((await send({ kind: 'jobseeker', data: data.jobseeker, idempotencyKey: randomUUID(), website: 'spam.example' })).status === 400, 'Honeypot rejected.');
  check((await send({ kind: 'jobseeker', data: { ...data.jobseeker, workHistory: '超'.repeat(4001) }, idempotencyKey: randomUUID() })).status === 400, 'Individual text length bounded.');
  check((await send({ oversized: 'x'.repeat(132000) })).status === 413, 'Request byte limit enforced.');

  const key = randomUUID(); const firstBody = { kind: 'jobseeker', data: data.jobseeker, idempotencyKey: key, website: '' };
  const concurrent = await Promise.all([send(firstBody), send(firstBody)]);
  const saved = await Promise.all(concurrent.map(item => item.json()));
  check(concurrent.every(item => item.status === 200 || item.status === 201) && saved[0].reference === saved[1].reference, 'Concurrent retries return one reference.');
  check((await send({ ...firstBody, data: { ...data.jobseeker, fullName: '不同內容' } })).status === 409, 'Idempotency key cannot change payload.');
  const employerResponse = await send({ kind: 'employer', data: data.employer, idempotencyKey: randomUUID(), website: '' });
  check(employerResponse.status === 201, 'Employer intake saved.');
  const listing = await request(`/api/admin/records?q=${encodeURIComponent(marker)}`, {}, true);
  const listingData = await listing.json();
  createdIds.push(...listingData.records.map(record => record.id));
  check(listingData.total === 2 && listingData.records.length === 2, 'Both kinds persisted and searchable.');
  check(listingData.counts.jobseeker >= 1 && listingData.counts.employer >= 1 && listingData.counts.statuses['新登記'] >= 2, 'Dashboard counts returned.');
  const applicant = listingData.records.find(record => record.kind === 'jobseeker');
  const detail = await (await request(`/api/admin/records/${applicant.id}`, {}, true)).json();
  check(detail.data.workHistory === data.jobseeker.workHistory && detail.data.consent === true, 'Saved values read back without loss.');
  let update = await request(`/api/admin/records/${applicant.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ expectedUpdatedAt: detail.updatedAt, status: '配對中', notes: '內部測試備註，客戶版不得出現。' }) }, true);
  const updated = await update.json();
  check(update.status === 200 && updated.status === '配對中' && updated.notes.includes('內部測試'), 'Admin status and notes persisted.');
  const staleUpdate = await request(`/api/admin/records/${applicant.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ expectedUpdatedAt: detail.updatedAt, status: '已完成', notes: '過時備註' }) }, true);
  check(staleUpdate.status === 409 && new Date(updated.updatedAt).getTime() > new Date(detail.updatedAt).getTime(), 'Stale administrator edit rejected with increasing version.');
  update = await request(`/api/admin/records/${applicant.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ data: { fullName: 'attempted-edit' } }) }, true);
  check(update.status === 400, 'Admin cannot overwrite intake data.');
  const selected = createdIds.join(','); await mkdir('work/backend', { recursive: true });
  for (const mode of ['full', 'client']) {
    const exported = await request(`/api/admin/export?ids=${selected}&mode=${mode}`, {}, true);
    const bytes = new Uint8Array(await exported.arrayBuffer());
    check(exported.status === 200 && exported.headers.get('content-type') === 'application/pdf' && Buffer.from(bytes.subarray(0, 5)).toString() === '%PDF-', `${mode} PDF generated.`);
    check(exported.headers.get('x-export-records') === '2', `${mode} PDF records count explicit.`);
    await writeFile(`work/backend/qa-${mode}.pdf`, bytes);
  }
  check((await request(`/api/admin/export?ids=${selected}&mode=bad`, {}, true)).status === 400, 'Invalid export mode denied.');
  check((await request('/api/admin/records?page=0', {}, true)).status === 400, 'Invalid paging rejected.');
  const smallBatch = await request(`/api/admin/export?scope=all&q=${encodeURIComponent(marker)}&batch=1&asOf=${encodeURIComponent(listingData.asOf)}&mode=client`, {}, true);
  check(smallBatch.status === 200 && smallBatch.headers.get('x-export-total') === '2' && smallBatch.headers.get('x-export-batches') === '1', 'Explicit batch export returns complete counts.');
  check((await request(`/api/admin/export?scope=all&q=${encodeURIComponent(marker)}&batch=2`, {}, true)).status === 400, 'Out-of-range batch rejected.');
  check((await request('/api/admin/export?scope=all&asOf=invalid', {}, true)).status === 400, 'Invalid export snapshot rejected.');

  if (process.argv.includes('--batch-test')) {
    const batchMarker = `${marker}-批次`;
    const quote = value => `'${String(value).replaceAll("'", "''")}'`;
    const seedTime = new Date(Date.now() - 1000).toISOString();
    const rows = [];
    for (let index = 0; index < 101; index++) {
      const id = randomUUID(); createdIds.push(id);
      const reference = `JH-QA-${id.slice(0, 8).toUpperCase()}`;
      const fixtureData = { ...data.employer, fullName: `${batchMarker}${index}` };
      const fixtureHash = createHash('sha256').update(id).digest('hex');
      rows.push(`(${[id, reference, 'employer', JSON.stringify(fixtureData), `${batchMarker}${index}`, '新登記', '', seedTime, seedTime, fixtureHash, fixtureHash].map(quote).join(',')})`);
    }
    await writeFile('work/backend/qa-batch-seed.sql', `INSERT INTO intake_records (id,reference,kind,data_json,search_text,status,notes,created_at,updated_at,idempotency_hash,request_hash) VALUES ${rows.join(',')};`);
    await run(process.execPath, ['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'DB', '--local', '--config', 'dist/server/wrangler.json', '--persist-to', '.wrangler/state', '--file', 'work/backend/qa-batch-seed.sql']);
    const snapshot = await (await request(`/api/admin/records?q=${encodeURIComponent(batchMarker)}`, {}, true)).json();
    check(snapshot.total === 101 && Boolean(snapshot.asOf), 'Batch fixture exposes snapshot timestamp.');
    const query = `scope=all&q=${encodeURIComponent(batchMarker)}&asOf=${encodeURIComponent(snapshot.asOf)}`;
    check((await request(`/api/admin/export?${query}`, {}, true)).status === 413, 'Large all-record export requires explicit batch.');
    for (const [batch, count] of [[1, 100], [2, 1]]) {
      const exportBatch = await request(`/api/admin/export?${query}&batch=${batch}&mode=client`, {}, true);
      const bytes = new Uint8Array(await exportBatch.arrayBuffer());
      check(exportBatch.status === 200 && exportBatch.headers.get('x-export-records') === String(count) && exportBatch.headers.get('x-export-total') === '101' && exportBatch.headers.get('x-export-batches') === '2' && exportBatch.headers.get('x-export-batch') === String(batch), `Batch ${batch} contains correct record range.`);
      await writeFile(`work/backend/qa-batch-${batch}.pdf`, bytes);
    }
    const newAfterSnapshot = await send({ kind: 'employer', data: { ...data.employer, fullName: `${batchMarker}新增` }, idempotencyKey: randomUUID(), website: '' });
    check(newAfterSnapshot.status === 201, 'Post-snapshot intake saved.');
    const newRecord = await (await request(`/api/admin/records?q=${encodeURIComponent(`${batchMarker}新增`)}`, {}, true)).json();
    createdIds.push(...newRecord.records.map(record => record.id));
    const frozen = await (await request(`/api/admin/records?q=${encodeURIComponent(batchMarker)}&asOf=${encodeURIComponent(snapshot.asOf)}`, {}, true)).json();
    check(frozen.total === 101, 'Snapshot batches exclude later intake.');
  }

  for (let index = 0; index < 10; index++) {
    const attempt = await send({ kind: 'employer', data: { ...data.employer, fullName: `${marker}限流${index}` }, idempotencyKey: randomUUID(), website: '' });
    if (attempt.status === 429) { rateLimitReached = true; break; }
    check(attempt.status === 201, 'Rate-limit fixture submitted.');
  }
  check(rateLimitReached, 'Submission rate limit enforced.');
  console.log(JSON.stringify({ passed, pdfs: ['work/backend/qa-full.pdf', 'work/backend/qa-client.pdf'], marker, retained: retain }, null, 2));
} finally {
  const remaining = await request(`/api/admin/records?q=${encodeURIComponent(marker)}`, {}, true).catch(() => null);
  if (remaining?.ok) createdIds.push(...(await remaining.json()).records.map(record => record.id));
  const ids = [...new Set(createdIds)];
  if (!retain && ids.length) {
    assert(ids.every(id => /^[a-f\d-]{36}$/.test(id)));
    // Remove only this local fixture's hash keys; browser preview submissions
    // and unrelated records are never cleared. A custom local rate salt can be
    // passed as RATE_LIMIT_SALT when running this check.
    const hours = [...new Set([startedHour, Math.floor(Date.now() / 3600000)])];
    const rateKeys = hours.map(hour => createHash('sha256').update(`${process.env.RATE_LIMIT_SALT || new URL(base).hostname}:${hour}:${fixtureIp}`).digest('hex'));
    const sql = `DELETE FROM intake_records WHERE id IN (${ids.map(id => `'${id}'`).join(',')});\nDELETE FROM intake_rate_limits WHERE key IN (${rateKeys.map(key => `'${key}'`).join(',')});`;
    await writeFile('work/backend/qa-cleanup.sql', sql);
    await run(process.execPath, ['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'DB', '--local', '--config', 'dist/server/wrangler.json', '--persist-to', '.wrangler/state', '--file', 'work/backend/qa-cleanup.sql']);
    const verification = await (await request(`/api/admin/records?q=${encodeURIComponent(marker)}`, {}, true)).json();
    assert.equal(verification.total, 0, 'Fixture cleanup verified.');
  }
}
