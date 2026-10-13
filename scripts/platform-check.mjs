import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { stripTypeScriptTypes, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';

// All fixtures live in an in-memory SQLite database and memory-only object store.
// No production endpoint, database, account or uploaded file can be touched.
assert(process.argv.includes('--unit'), 'Use --unit. This test only supports an isolated in-memory database.');
const run = promisify(execFile), require = createRequire(import.meta.url);
const sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys = ON;');
for (const file of ['drizzle/0000_parched_betty_ross.sql', 'drizzle/0001_handy_robbie_robertson.sql']) sqlite.exec((await readFile(file, 'utf8')).replaceAll('--> statement-breakpoint', ''));
class Statement {
  constructor(sql, bindings = []) { this.sql = sql; this.bindings = bindings; }
  bind(...bindings) { return new Statement(this.sql, bindings); }
  first() { return Promise.resolve(sqlite.prepare(this.sql).get(...this.bindings) ?? null); }
  all() { return Promise.resolve({ results: sqlite.prepare(this.sql).all(...this.bindings), success: true }); }
  execute() { const result = sqlite.prepare(this.sql).run(...this.bindings); return { success: true, meta: { changes: Number(result.changes) } }; }
  run() { return Promise.resolve(this.execute()); }
}
const objects = new Map();
globalThis.__jiahePlatformEnv = {
  ADMIN_EMAILS: 'admin@example.test', RATE_LIMIT_SALT: 'isolated-platform-test',
  DB: { prepare: sql => new Statement(sql), batch: statements => {
    sqlite.exec('BEGIN'); try { const values = statements.map(statement => statement.execute()); sqlite.exec('COMMIT'); return Promise.resolve(values); } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } },
  BUCKET: { put: async (key, input) => { const bytes = new Uint8Array(input); objects.set(key, bytes); }, delete: async key => { objects.delete(key); }, get: async key => {
    const bytes = objects.get(key); return bytes ? { size: bytes.length, body: new Blob([bytes]).stream(), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } : null;
  } },
  ASSETS: { fetch: async () => new Response(await readFile('public/fonts/jiahe-cjk-regular.ttf')) },
};
const urls = {};
async function moduleUrl(file) {
  let source = stripTypeScriptTypes(await readFile(file, 'utf8'));
  source = source.replace(/import \{ env \} from ['"]cloudflare:workers['"];?/g, 'const env = globalThis.__jiahePlatformEnv;');
  for (const [name, url] of Object.entries(urls)) source = source.replaceAll(`from './${name}'`, `from '${url}'`).replaceAll(`from '@/lib/${name}'`, `from '${url}'`);
  for (const name of ['pdf-lib', '@pdf-lib/fontkit']) source = source.replaceAll(`from '${name}'`, `from '${pathToFileURL(require.resolve(name)).href}'`);
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}
for (const name of ['platform-types', 'fields', 'server', 'platform-server', 'pdf']) urls[name] = await moduleUrl(`lib/${name}.ts`);
const fields = await import(urls.fields), server = await import(urls.server), platform = await import(urls['platform-server']), pdfUtils = await import(urls.pdf);
const routes = {};
for (const [name, path] of Object.entries({
  intake: 'intake', photo: 'intake-photo', records: 'admin/records', record: 'admin/records/[id]', adminCandidates: 'admin/candidates', adminCandidate: 'admin/candidates/[id]', candidates: 'candidates', candidate: 'candidates/[id]', candidatePhoto: 'candidates/[id]/photo', privatePhoto: 'admin/photos/[id]', candidatePdf: 'candidates/[id]/pdf', candidateExport: 'candidates/export', matches: 'admin/matches', match: 'admin/matches/[id]', matchExport: 'admin/matches/export', settings: 'admin/settings', siteInfo: 'site-info', export: 'admin/export', health: 'health',
})) routes[name] = await import(await moduleUrl(`app/api/${path}/route.ts`));
const origin = 'https://unit.example.test'; let checks = 0, ipCount = 0;
const expect = (value, message) => { assert(value, message); checks++; };
function request(path, { body, method = 'GET', auth = false, headers = {} } = {}) {
  return new Request(`${origin}${path}`, { method, headers: { ...(auth ? { 'oai-authenticated-user-id': 'unit-admin', 'oai-authenticated-user-email': 'admin@example.test' } : {}), ...(body !== undefined ? { Origin: origin, 'Content-Type': 'application/json' } : {}), 'cf-connecting-ip': `198.51.100.${++ipCount % 254}`, ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
async function call(name, method = 'GET', body, id, auth = false, path) {
  return routes[name][method](request(path || `/api/${name}`, { method, body, auth }), { params: Promise.resolve({ id }) });
}
async function expectStatus(response, status, message) { expect(response.status === status, `${message}: expected ${status}, got ${response.status} ${response.status !== status ? await response.text() : ''}`); return response; }
const seeker = { fullName: '私密姓名測試', phone: '+852 61234567', email: 'private@example.test', nationality: '香港', currentLocation: '香港', education: '中學', candidateType: '本地求職', age: '38', services: ['家傭','長者照顧'], languages: ['廣東話','英語'], yearsExperience: '6–10年', skills: ['煮食','長者照顧'], workHistory: '私密履歷測試內容，不可自動公開。', certificates: '私密資格內容，不可自動公開。', employmentType: '全職非住家', workLocations: ['全香港'], availableFrom: '2026-11-01', expectedSalary: '18000', salaryUnit: '每月', consent: true, publicProfileConsent: true, publicName: '阿May', publicIntroduction: '熟悉家務及長者日常照顧。' };
const employer = { fullName: '需求測試先生', phone: '+852 67891234', district: '沙田', householdAdults: '2', services: ['家傭'], employmentType: '全職非住家', duties: ['煮食'], startDate: '2026-11-02', schedule: '星期一至六，上午九時至下午六時。', budget: '19000', budgetUnit: '每月', consent: true };
const profileOf = candidate => Object.fromEntries(platform.publicProfileKeys.map(key => [key, candidate[key]]));
const invalid = (operation, field) => { assert.throws(operation, error => error instanceof server.ApiError && error.status === 400 && (!field || Boolean(error.fields?.[field]))); checks++; };
function portraitFixture() {
  // Original geometric portrait for layout QA; no real person's photo.
  const width = 320, height = 400, raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const head = (x - 160) ** 2 / 63 ** 2 + (y - 126) ** 2 / 78 ** 2 < 1;
    const shoulders = (x - 160) ** 2 / 138 ** 2 + (y - 363) ** 2 / 132 ** 2 < 1;
    const color = head ? [196, 162, 133] : shoulders ? [69, 109, 90] : [233, 237, 228];
    const offset = y * (width * 3 + 1) + 1 + x * 3; color.forEach((value, index) => { raw[offset + index] = value; });
  }
  const crc = input => { let value = 0xffffffff; for (const byte of input) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; };
  const chunk = (type, payload) => { const name = Buffer.from(type), size = Buffer.alloc(4), checksum = Buffer.alloc(4); size.writeUInt32BE(payload.length); checksum.writeUInt32BE(crc(Buffer.concat([name, payload]))); return Buffer.concat([size, name, payload, checksum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
try {
  expect((await (await call('health')).json()).version === '1.1.0', 'Health verifies migrated schema and release version.');
  invalid(()=>platform.optionalDate('2026-11-01T15:00:99Z','面試',true));
  expect(server.validateData('jobseeker', { ...seeker, publicProfileConsent: undefined }).publicProfileConsent === false, 'Public consent defaults false.');
  expect(server.validateData('jobseeker', { ...seeker, salaryNegotiable: true, expectedSalary: undefined, salaryUnit: undefined }).expectedSalary === '', 'Negotiable salary allows omitted amount.');
  expect(server.validateData('employer', { ...employer, budgetNegotiable: true, budget: undefined, budgetUnit: undefined }).budget === '', 'Undecided budget permits submission.');
  invalid(() => server.validateData('jobseeker', { ...seeker, age: '17' }), 'age');
  invalid(() => server.validateData('jobseeker', { ...seeker, workHistory: '', workExperienceJson: '[]' }), 'workHistory');
  const experience = [{ country: '香港', from: '2020-01', to: '2025-12', household: '兩位成人', duties: '煮食、清潔', leavingReason: '完約' }];
  expect(server.validateData('jobseeker', { ...seeker, workHistory: '', workExperienceJson: JSON.stringify(experience) }).workExperienceJson.includes('2020-01'), 'Structured history validated.');
  const longExperience = Array.from({ length: 8 }, () => ({ country: '香港', from: '2020-01', to: '2025-12', household: '人'.repeat(300), duties: '務'.repeat(1500), leavingReason: '約'.repeat(300) }));
  const longData = { ...seeker, workExperienceJson: JSON.stringify(longExperience), workHistory: '工'.repeat(4000), introduction: '介'.repeat(3000), publicIntroduction: '公'.repeat(2000), certificates: '證'.repeat(1000) };
  const longBody = { kind: 'jobseeker', data: longData, idempotencyKey: randomUUID() };
  expect(Buffer.byteLength(JSON.stringify(longBody)) > 65536 && longData.workExperienceJson.length <= 18000, 'Valid combined Chinese content exceeds former byte cap within field limits.');
  const longReceiptResponse = await call('intake','POST',longBody);await expectStatus(longReceiptResponse,201,'Valid long Chinese intake accepted');const longReceipt=await longReceiptResponse.json();
  const longRecord=await server.getRecord(sqlite.prepare('SELECT id FROM intake_records WHERE reference = ?').get(longReceipt.reference).id);
  const longEdit=await call('record','PATCH',{data:longRecord.data,notes:'經歷修訂',expectedUpdatedAt:longRecord.updatedAt},longRecord.id,true);await expectStatus(longEdit,200,'Valid long Chinese admin correction accepted');
  const longDraft=await(await call('adminCandidates','POST',{intakeId:longRecord.id},undefined,true)).json();
  const longPublicProfile={...profileOf(longDraft),qualifications:'課'.repeat(1000),workExperiences:longExperience.map(value=>({...value,household:'人'.repeat(600),leavingReason:'約'.repeat(600)}))};
  const longPublicationBody={profile:longPublicProfile,expectedUpdatedAt:longDraft.updatedAt};
  expect(Buffer.byteLength(JSON.stringify(longPublicationBody))>65536,'Valid maximum public experience content exceeds former byte cap.');
  await expectStatus(await call('adminCandidate','PATCH',longPublicationBody,longDraft.id,true),200,'Valid long Chinese public draft correction accepted');
  const oversizedText='資料'.repeat(22000);
  for(const [name,id,body,auth] of [
    ['intake',undefined,{...longBody,data:{...longData,introduction:oversizedText}},false],
    ['record',longRecord.id,{data:{...longData,introduction:oversizedText},expectedUpdatedAt:longRecord.updatedAt},true],
    ['adminCandidate',longDraft.id,{profile:{...longPublicProfile,summary:oversizedText},expectedUpdatedAt:longDraft.updatedAt},true],
    ['settings',undefined,{hours:oversizedText,expectedUpdatedAt:''},true],
  ])await expectStatus(await call(name,name==='intake'?'POST':'PATCH',body,id,auth),413,`${name} rejects body beyond 128 KiB`);
  await assert.rejects(()=>server.readJson(request('/api/small-envelope',{method:'POST',body:{text:'x'.repeat(33000)}})),error=>error.status===413);checks++;
  sqlite.prepare('DELETE FROM intake_records WHERE id = ?').run(longRecord.id);
  invalid(() => server.validateData('jobseeker', { ...seeker, workExperienceJson: JSON.stringify([{ ...experience[0], to: '2019-01' }]) }), 'workExperienceJson');
  expect(server.validateData('employer', { ...employer, dueDate: 'bad-date' }).dueDate === '', 'Unselected service fields discarded.');
  invalid(() => server.validateData('employer', { ...employer, services: ['陪月'], dueDate: 'bad-date' }), 'dueDate');
  invalid(() => server.validateIntake({ kind: 'employer', data: employer, idempotencyKey: randomUUID(), candidateIds: Array.from({ length: 4 }, randomUUID) }), 'candidateIds');
  const duplicate = randomUUID(); invalid(() => server.validateIntake({ kind: 'employer', data: employer, idempotencyKey: randomUUID(), candidateIds: [duplicate, duplicate] }), 'candidateIds');
  await expectStatus(await call('adminCandidates'), 401, 'Anonymous admin listing denied');
  await expectStatus(await call('matches'), 401, 'Anonymous matches denied');
  await expectStatus(await call('settings', 'PATCH', { phone: '61234567', expectedUpdatedAt: '' }), 401, 'Anonymous settings write denied');
  await expectStatus(await call('adminCandidates', 'POST', { intakeId: randomUUID() }), 401, 'Anonymous publication denied');
  const spoofEmail = request('/api/admin/records', { headers: { 'oai-authenticated-user-email': 'admin@example.test' } });
  expect(server.adminSession(spoofEmail).authorized === false, 'Email without trusted user identity cannot authorize.');
  const png = portraitFixture();
  let uploaded = await routes.photo.POST(new Request(`${origin}/api/intake-photo`, { method: 'POST', headers: { Origin: 'https://wrong.example.test', 'Content-Type': 'image/png' }, body: png }));
  await expectStatus(uploaded, 403, 'Cross-site photo upload denied');
  uploaded = await routes.photo.POST(new Request(`${origin}/api/intake-photo`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/html' }, body: 'html' }));
  await expectStatus(uploaded, 415, 'Photo content type restricted');
  uploaded = await routes.photo.POST(new Request(`${origin}/api/intake-photo`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'image/png' }, body: png.subarray(0,33) }));
  await expectStatus(uploaded,400,'Truncated PNG rejected before storage');
  uploaded = await routes.photo.POST(new Request(`${origin}/api/intake-photo`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'image/png', 'cf-connecting-ip': '198.51.100.252' }, body: png }));
  await expectStatus(uploaded, 201, 'Photo stored privately'); const photo = await uploaded.json();
  const photoMetadata = sqlite.prepare('SELECT * FROM intake_photos WHERE id = ?').get(photo.id);
  expect(photoMetadata.token_hash !== photo.token && photoMetadata.token_hash.length === 64 && photoMetadata.attached_record_id === null, 'Photo token stored only as hash.');
  await expectStatus(await call('intake', 'POST', { kind: 'jobseeker', data: seeker, idempotencyKey: randomUUID(), photo: { id: photo.id, token: randomUUID() } }), 400, 'Invalid attachment token denied');
  const intakeBody = { kind: 'jobseeker', data: seeker, idempotencyKey: randomUUID(), photo };
  const first = await call('intake', 'POST', intakeBody); await expectStatus(first, 201, 'Seeker with photo saved'); const receipt = await first.json();
  const retry = await call('intake', 'POST', intakeBody); await expectStatus(retry, 200, 'Identical intake retry preserved'); expect((await retry.json()).reference === receipt.reference, 'Retry returns one receipt.');
  await expectStatus(await call('intake', 'POST', { ...intakeBody, data: { ...seeker, fullName: 'changed' } }), 409, 'Changed retry rejected');
  let record = await server.getRecord(sqlite.prepare('SELECT id FROM intake_records WHERE reference = ?').get(receipt.reference).id);
  expect(record.photoId === photo.id && sqlite.prepare('SELECT attached_record_id FROM intake_photos WHERE id = ?').get(photo.id).attached_record_id === record.id, 'Photo atomically attached to one record.');
  await expectStatus(await call('privatePhoto', 'GET', undefined, photo.id), 401, 'Private portrait protected');
  await expectStatus(await call('privatePhoto', 'GET', undefined, photo.id, true), 200, 'Authorized private portrait read');
  await expectStatus(await call('intake', 'POST', { ...intakeBody, idempotencyKey: randomUUID() }), 400, 'Attached photo cannot be reused');
  const raceUpload = await routes.photo.POST(new Request(`${origin}/api/intake-photo`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'image/png', 'cf-connecting-ip': '198.51.100.250' }, body: png }));
  await expectStatus(raceUpload,201,'Race fixture photo uploaded');const racePhoto=await raceUpload.json(),beforeCount=sqlite.prepare('SELECT COUNT(*) AS total FROM intake_records').get().total;
  const normalBatch=globalThis.__jiahePlatformEnv.DB.batch;
  globalThis.__jiahePlatformEnv.DB.batch=statements=>{sqlite.prepare('UPDATE intake_photos SET expires_at = unixepoch() - 1 WHERE id = ?').run(racePhoto.id);return normalBatch(statements);};
  try{await expectStatus(await call('intake','POST',{kind:'jobseeker',data:seeker,idempotencyKey:randomUUID(),photo:racePhoto}),400,'Photo expiry between preflight and transaction prevents attachment');}
  finally{globalThis.__jiahePlatformEnv.DB.batch=normalBatch;}
  expect(sqlite.prepare('SELECT COUNT(*) AS total FROM intake_records').get().total===beforeCount,'Expired-photo race creates no partial intake.');
  sqlite.prepare('UPDATE intake_photos SET expires_at = 0 WHERE id = ?').run(photo.id);
  const cleanupUpload=await routes.photo.POST(new Request(`${origin}/api/intake-photo`,{method:'POST',headers:{Origin:origin,'Content-Type':'image/png','cf-connecting-ip':'198.51.100.249'},body:png}));await expectStatus(cleanupUpload,201,'Expired upload cleanup trigger succeeds');await cleanupUpload.json();
  expect(!sqlite.prepare('SELECT id FROM intake_photos WHERE id = ?').get(racePhoto.id)&&!objects.has(`intake-photos/${racePhoto.id}`),'Cleanup atomically removes only expired unattached metadata and object.');
  expect(objects.has(photoMetadata.object_key)&&sqlite.prepare('SELECT attached_record_id FROM intake_photos WHERE id = ?').get(photo.id).attached_record_id===record.id,'Expired token cannot cause attached portrait cleanup.');
  let draftResponse = await call('adminCandidates', 'POST', { intakeId: record.id }, undefined, true); await expectStatus(draftResponse, 201, 'Admin draft created'); let draft = await draftResponse.json();
  expect(draft.state === 'draft' && draft.displayName === '阿May' && draft.workExperiences.length === 0 && draft.qualifications === '', 'Draft uses only consented allowlisted public fields.');
  expect((await (await call('candidates')).json()).total === 0, 'Draft absent from catalog.');
  await expectStatus(await call('candidate', 'GET', undefined, draft.id), 404, 'Draft direct route denied');
  const privateProjection = { ...profileOf(draft), summary: '聯絡 private@example.test' };
  await expectStatus(await call('adminCandidate', 'PATCH', { profile: privateProjection, state: 'published', expectedUpdatedAt: draft.updatedAt }, draft.id, true), 400, 'Public description contact data denied');
  const published = await call('adminCandidate', 'PATCH', { profile: profileOf(draft), state: 'published', expectedUpdatedAt: draft.updatedAt }, draft.id, true); await expectStatus(published, 200, 'Consented profile published'); draft = await published.json();
  const catalog = await (await call('candidates', 'GET', undefined, undefined, false, '/api/candidates?service=%E5%AE%B6%E5%82%AD&language=%E5%BB%A3%E6%9D%B1%E8%A9%B1&district=%E6%B2%99%E7%94%B0&sort=salary-asc')).json();
  expect(catalog.total === 1 && catalog.candidates[0].id === draft.id && catalog.pageSize === 12, 'Published catalog filters and pagination work.');
  const dto = await (await call('candidate', 'GET', undefined, draft.id)).json(), encoded = JSON.stringify(dto);
  expect(!['私密姓名測試','61234567','private@example.test','私密履歷','私密資格','intakeId','token','notes','source_data_json'].some(value => encoded.includes(value)), 'Public DTO contains no private intake fields.');
  await expectStatus(await call('candidatePhoto', 'GET', undefined, draft.id), 200, 'Published approved portrait available');
  await expectStatus(await call('candidates', 'GET', undefined, undefined, false, '/api/candidates?sort=SQL'), 400, 'Unsafe public sort denied');
  await expectStatus(await call('candidates', 'GET', undefined, undefined, false, '/api/candidates?page=0'), 400, 'Invalid catalog page denied');
  await expectStatus(await call('candidateExport', 'GET', undefined, undefined, false, `/api/candidates/export?ids=${Array.from({ length: 4 }, randomUUID).join(',')}`), 400, 'Public PDF max three candidates enforced');
  const requested = await call('intake', 'POST', { kind: 'employer', data: employer, idempotencyKey: randomUUID(), candidateIds: [draft.id] }); await expectStatus(requested, 201, 'Employer selected candidate saved');
  const employerReceipt = await requested.json(), employerRecord = await server.getRecord(sqlite.prepare('SELECT id FROM intake_records WHERE reference = ?').get(employerReceipt.reference).id);
  expect(employerRecord.requestedCandidateIds[0] === draft.id, 'Selected reference retained.');
  const matchList = await (await call('matches', 'GET', undefined, undefined, true, `/api/admin/matches?employerId=${employerRecord.id}`)).json();
  expect(matchList.total === 1 && matchList.matches[0].jobseekerId === record.id && matchList.matches[0].stage === '待聯絡', 'Selected candidate enters backend matching workflow.');
  let match = matchList.matches[0];
  const changedMatch = await call('match', 'PATCH', { stage: '安排面試', interviewAt: '2026-11-01T15:00', notes: '配對內部測試備註', expectedUpdatedAt: match.updatedAt }, match.id, true); await expectStatus(changedMatch, 200, 'Match stage and interview saved'); const newerMatch = await changedMatch.json();
  await expectStatus(await call('match', 'PATCH', { stage: '已完成', expectedUpdatedAt: match.updatedAt }, match.id, true), 409, 'Stale match update denied'); match = newerMatch;
  await expectStatus(await call('matches', 'POST', { employerId: record.id, jobseekerId: employerRecord.id }, undefined, true), 400, 'Role-reversed match denied');
  const duplicateMatch = await (await call('matches', 'POST', { employerId: employerRecord.id, jobseekerId: record.id, stage: '已完成' }, undefined, true)).json();
  expect(duplicateMatch.id === match.id && duplicateMatch.stage === '安排面試', 'Duplicate pair does not overwrite existing workflow.');
  const savedSource = sqlite.prepare('SELECT data_json, request_hash FROM intake_records WHERE id = ?').get(record.id);
  const edited = await call('record', 'PATCH', { data: { ...record.data, fullName: '更正後姓名' }, nextFollowUp: '2026-11-03', notes: '登記內部測試備註', expectedUpdatedAt: record.updatedAt }, record.id, true); await expectStatus(edited, 200, 'Complete record correction and followup saved'); const newer = await edited.json();
  const preserved = sqlite.prepare('SELECT original_data_json, request_hash FROM intake_records WHERE id = ?').get(record.id);
  expect(preserved.original_data_json === savedSource.data_json && preserved.request_hash === savedSource.request_hash && newer.nextFollowUp === '2026-11-03', 'Correction preserves original JSON and immutable submission hash.');
  await expectStatus(await call('record', 'PATCH', { notes: 'stale', expectedUpdatedAt: record.updatedAt }, record.id, true), 409, 'Stale record correction denied'); record = newer;
  const unconsentedResponse = await call('intake', 'POST', { kind: 'jobseeker', data: { ...seeker, publicProfileConsent: false }, idempotencyKey: randomUUID() }); await expectStatus(unconsentedResponse, 201, 'Nonpublic intake saved');
  const unconsentedReceipt = await unconsentedResponse.json(), unconsented = await server.getRecord(sqlite.prepare('SELECT id FROM intake_records WHERE reference = ?').get(unconsentedReceipt.reference).id);
  const hiddenDraft = await (await call('adminCandidates', 'POST', { intakeId: unconsented.id }, undefined, true)).json();
  await expectStatus(await call('adminCandidate', 'PATCH', { state: 'published', expectedUpdatedAt: hiddenDraft.updatedAt }, hiddenDraft.id, true), 400, 'No-consent publication denied');
  await expectStatus(await call('record', 'PATCH', { data: { ...unconsented.data, publicProfileConsent: true }, expectedUpdatedAt: unconsented.updatedAt }, unconsented.id, true), 400, 'Admin cannot grant applicant public consent');
  const legacyNames = ['fullName','phone','email','englishName','nationality','currentLocation','education','services','languages','yearsExperience','skills','certificates','workHistory','employmentType','workLocations','availableFrom','expectedSalary','salaryUnit','schedule','introduction','consent'];
  const legacyData = Object.fromEntries(Object.entries(server.validateData('jobseeker', { ...seeker, publicProfileConsent: false })).filter(([key]) => legacyNames.includes(key)));
  const legacyKey = randomUUID(), legacyId = randomUUID(), legacyReference = `JH-J-20261013-${legacyId.slice(0,8).toUpperCase()}`, legacyTime = new Date().toISOString();
  sqlite.prepare('INSERT INTO intake_records (id,reference,kind,data_json,search_text,status,notes,created_at,updated_at,idempotency_hash,request_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(legacyId,legacyReference,'jobseeker',JSON.stringify(legacyData),'legacy-unit','新登記','',legacyTime,legacyTime,await server.hash(legacyKey),await server.hash(JSON.stringify({kind:'jobseeker',data:legacyData})));
  const legacyRetry = await call('intake','POST',{kind:'jobseeker',data:legacyData,idempotencyKey:legacyKey}); await expectStatus(legacyRetry,200,'Original-form pending retry survives new optional fields');
  expect((await legacyRetry.json()).reference===legacyReference,'Original-form retry returns original receipt.');
  await expectStatus(await call('intake','POST',{kind:'jobseeker',data:{...legacyData,publicProfileConsent:true},idempotencyKey:legacyKey}),409,'Legacy key cannot accept meaningful new fields');
  const paginationIds=[], publicationIds=[];
  for(let index=0;index<205;index++) {
    const id=randomUUID(),publicationId=randomUUID(),hash=await server.hash(id);paginationIds.push(id);publicationIds.push(publicationId);
    sqlite.prepare('INSERT INTO intake_records (id,reference,kind,data_json,search_text,status,notes,created_at,updated_at,idempotency_hash,request_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,`JH-J-20261013-${id.slice(0,8).toUpperCase()}`,'jobseeker',JSON.stringify(server.validateData('jobseeker',seeker)),`pagination-unit-${index}`,'新登記','',legacyTime,legacyTime,hash,hash);
    sqlite.prepare('INSERT INTO candidate_publications (id,intake_id,profile_json,state,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(publicationId,id,JSON.stringify({...profileOf(draft),displayName:`頁面測試${index}`}), 'published',legacyTime,legacyTime);
    sqlite.prepare('INSERT INTO record_matches (id,employer_id,jobseeker_id,stage,notes,interview_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),employerRecord.id,id,'待聯絡','','',legacyTime,legacyTime);
  }
  const firstPage=await(await call('adminCandidates','GET',undefined,undefined,true,'/api/admin/candidates?page=1')).json(),secondPage=await(await call('adminCandidates','GET',undefined,undefined,true,'/api/admin/candidates?page=2')).json();
  expect(firstPage.candidates.length===200&&secondPage.candidates.length===7&&firstPage.total===207&&!secondPage.candidates.some(value=>firstPage.candidates.some(other=>other.id===value.id)),'Admin publications provide complete pages beyond 200.');
  const matchPage=await(await call('matches','GET',undefined,undefined,true,`/api/admin/matches?employerId=${employerRecord.id}&page=2`)).json();
  expect(matchPage.matches.length===6&&matchPage.total===206,'Match pagination provides records beyond 200.');
  const selectedQuery=`/api/candidates?ids=${publicationIds.slice(0,13).join(',')}`;
  const savedPage1=await(await call('candidates','GET',undefined,undefined,false,selectedQuery)).json(),savedPage2=await(await call('candidates','GET',undefined,undefined,false,`${selectedQuery}&page=2`)).json();
  expect(savedPage1.candidates.length===12&&savedPage2.candidates.length===1&&savedPage1.total===13,'Saved selections beyond 12 remain accessible on next page.');
  for(const id of paginationIds)sqlite.prepare('DELETE FROM intake_records WHERE id = ?').run(id);
  await mkdir('work/platform-check', { recursive: true });
  const objectKey = photoMetadata.object_key, savedPortrait = objects.get(objectKey);
  objects.set(objectKey, png.subarray(0,33));
  const corruptPortraitPdf = await call('candidatePdf','GET',undefined,draft.id);await expectStatus(corruptPortraitPdf,200,'Corrupt optional stored portrait does not block PDF');
  const corruptPath='work/platform-check/candidate-malformed-photo.pdf';await writeFile(corruptPath,Buffer.from(await corruptPortraitPdf.arrayBuffer()));
  const corruptText=(await run('pdftotext',[corruptPath,'-'])).stdout;
  expect(corruptText.includes('照片暫未能顯示')&&corruptText.includes('阿May')&&!corruptText.includes('私密'),'Corrupt-photo PDF preserves safe profile and clear unavailable state.');
  objects.set(objectKey,savedPortrait);
  const budgetRecords=[],budgetPhotos=[];
  for(let index=0;index<7;index++) {
    const id=randomUUID(),photoId=randomUUID(),hash=await server.hash(id);budgetRecords.push(id);budgetPhotos.push(photoId);
    const time=new Date().toISOString();
    sqlite.prepare('INSERT INTO intake_records (id,reference,kind,data_json,search_text,status,notes,created_at,updated_at,idempotency_hash,request_hash,photo_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id,`JH-J-20261013-${id.slice(0,8).toUpperCase()}`,'jobseeker',JSON.stringify(server.validateData('jobseeker',{...seeker,fullName:`PDF人選${index}`})),'pdf-budget-unit','新登記','',time,time,hash,hash,photoId);
    sqlite.prepare('INSERT INTO intake_photos (id,token_hash,object_key,content_type,byte_length,expires_at,attached_record_id,created_at) VALUES (?,?,?,?,?,?,?,?)').run(photoId,hash,`budget-images/${photoId}`,'image/png',2*1024*1024,Math.floor(Date.now()/1000)+86400,id,time);objects.set(`budget-images/${photoId}`,png);
    sqlite.prepare('INSERT INTO record_matches (id,employer_id,jobseeker_id,stage,notes,interview_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(),employerRecord.id,id,'待聯絡','','',time,time);
  }
  const originalBucketGet=globalThis.__jiahePlatformEnv.BUCKET.get;let objectReads=0;
  globalThis.__jiahePlatformEnv.BUCKET.get=async key=>{objectReads++;return originalBucketGet(key);};
  try {
    const overBudget=await call('export','GET',undefined,undefined,true,`/api/admin/export?ids=${budgetRecords.join(',')}&mode=client`);await expectStatus(overBudget,400,'Photo budget rejects large batch before allocating portraits');
    expect((await overBudget.json()).error.includes('減少每份PDF的份數')&&objectReads===0,'Photo budget refusal is actionable and precedes object reads.');
  }finally{globalThis.__jiahePlatformEnv.BUCKET.get=originalBucketGet;}
  const exportSnapshot=new Date().toISOString();
  for(const [batch,count]of [[1,5],[2,2]]){
    const response=await call('export','GET',undefined,undefined,true,`/api/admin/export?scope=all&q=pdf-budget-unit&mode=client&batchSize=5&batch=${batch}&asOf=${encodeURIComponent(exportSnapshot)}`);
    await expectStatus(response,200,`Five-record batch ${batch} completes under photo budget`);
    expect(response.headers.get('X-Export-Records')===String(count)&&response.headers.get('X-Export-Batch-Size')==='5'&&response.headers.get('X-Export-Total')==='7'&&response.headers.get('X-Export-Batches')==='2','Small-batch metadata covers all seven records.');await response.arrayBuffer();
  }
  await expectStatus(await call('export','GET',undefined,undefined,true,'/api/admin/export?scope=all&q=pdf-budget-unit&batchSize=5&batch=3'),400,'Small-batch out-of-range rejected');
  await expectStatus(await call('export','GET',undefined,undefined,true,'/api/admin/export?scope=all&q=pdf-budget-unit&batchSize=6&batch=1'),400,'Unapproved batch size rejected');
  const matchSnapshot=(await(await call('matches','GET',undefined,undefined,true,`/api/admin/matches?employerId=${employerRecord.id}`)).json()).asOf;
  const stableMatches=sqlite.prepare("SELECT m.id, json_extract(j.data_json, '$.fullName') AS name FROM record_matches m JOIN intake_records j ON j.id = m.jobseeker_id WHERE employer_id = ? AND m.created_at <= ? ORDER BY m.created_at DESC, m.id DESC").all(employerRecord.id,matchSnapshot);
  for(const [batch,recordsCount]of [[1,6],[2,4]]){
    const response=await call('matchExport','GET',undefined,undefined,true,`/api/admin/matches/export?employerId=${employerRecord.id}&mode=client&batchSize=5&batch=${batch}&asOf=${encodeURIComponent(matchSnapshot)}`);
    await expectStatus(response,200,`Matching bundle batch ${batch} includes employer and full candidate data`);
    expect(response.headers.get('X-Export-Total')==='8'&&response.headers.get('X-Export-Records')===String(recordsCount)&&response.headers.get('X-Export-Batch-Size')==='5'&&response.headers.get('X-Export-As-Of')===matchSnapshot,'Match batches share creation snapshot and complete counts.');
    const temporaryPath=`work/platform-check/match-order-${batch}.pdf`;await writeFile(temporaryPath,Buffer.from(await response.arrayBuffer()));const extracted=(await run('pdftotext',[temporaryPath,'-'])).stdout;
    const expected=stableMatches.slice((batch-1)*5,batch*5),excluded=stableMatches.filter(value=>!expected.some(other=>other.id===value.id));
    expect(expected.every(value=>extracted.includes(value.name))&&excluded.every(value=>!extracted.includes(value.name)),'Match export keeps exact creation-ordered slice after another admin changes notes.');await rm(temporaryPath,{force:true});
    if(batch===1)sqlite.prepare('UPDATE record_matches SET notes = ?, updated_at = ? WHERE id = ?').run('排序更新驗證',new Date(Date.now()+1000).toISOString(),stableMatches[5].id);
  }
  await expectStatus(await call('matchExport','GET',undefined,undefined,true,`/api/admin/matches/export?employerId=${employerRecord.id}&batchSize=5&batch=3&asOf=${encodeURIComponent(matchSnapshot)}`),400,'Matching bundle invalid batch rejected');
  for(const id of budgetRecords)sqlite.prepare('DELETE FROM intake_records WHERE id = ?').run(id);
  for(const id of budgetPhotos)objects.delete(`budget-images/${id}`);
  for (const [name, response] of [
    ['candidate', await call('candidatePdf', 'GET', undefined, draft.id)],
    ['match-client', await call('matchExport', 'GET', undefined, undefined, true, `/api/admin/matches/export?employerId=${employerRecord.id}&mode=client`)],
    ['match-full', await call('matchExport', 'GET', undefined, undefined, true, `/api/admin/matches/export?employerId=${employerRecord.id}&mode=full`)],
  ]) {
    await expectStatus(response, 200, `${name} PDF generated`); const bytes = Buffer.from(await response.arrayBuffer()); expect(bytes.subarray(0,5).toString() === '%PDF-', 'PDF binary signature.');
    const path = `work/platform-check/${name}.pdf`; await writeFile(path, bytes);
    const { stdout } = await run('pdftotext', [path, '-']);
    if (name === 'candidate') expect(stdout.includes('阿May') && !stdout.includes('私密') && !stdout.includes('61234567') && !stdout.includes('private@example.test'), 'Public PDF renders allowed CJK fields only.');
    if (name === 'match-client') expect(stdout.includes('安排面試') && !stdout.includes('61234567') && !stdout.includes('private@example.test') && !stdout.includes('內部測試備註'), 'Client matching bundle hides contacts and internal notes.');
    if (name === 'match-full') expect(stdout.includes('61234567') && stdout.includes('配對內部測試備註') && stdout.includes('登記內部測試備註'), 'Internal bundle retains full authorized data.');
  }
  for(const [name,displayName]of [['candidate-long-name','名字'.repeat(40)],['candidate-spaced-name',('名'.repeat(8)+' ').repeat(8)+'名'.repeat(8)]]){
    const bytes=await pdfUtils.createCandidatesPdf([{...dto,displayName}],request('/api/name-layout'));
    const path=`work/platform-check/${name}.pdf`;await writeFile(path,bytes);const extracted=(await run('pdftotext',[path,'-'])).stdout;
    expect(extracted.includes('…')&&extracted.replace(/\s/g,'').includes(displayName.replace(/\s/g,'')),'Long PDF heading is abbreviated while complete name remains in body.');
    await run('pdftoppm',['-f','1','-l','1','-scale-to','1200','-singlefile','-png',path,`work/platform-check/${name}`]);
  }
  const paused = await call('adminCandidate', 'PATCH', { state: 'paused', expectedUpdatedAt: draft.updatedAt }, draft.id, true); await expectStatus(paused, 200, 'Public candidate paused'); draft = await paused.json();
  for (const name of ['candidate','candidatePhoto','candidatePdf']) await expectStatus(await call(name,'GET',undefined,draft.id),404,'Paused profile/photo/PDF denied');
  await expectStatus(await call('intake','POST',{kind:'employer',data:employer,idempotencyKey:randomUUID(),candidateIds:[draft.id]}),400,'Paused selection cannot enter a new intake');
  const restored = await call('adminCandidate','PATCH',{state:'published',expectedUpdatedAt:draft.updatedAt},draft.id,true); await expectStatus(restored,200,'Approved profile restored');
  const revoke = await call('record','PATCH',{data:{...record.data,publicProfileConsent:false},expectedUpdatedAt:record.updatedAt},record.id,true); await expectStatus(revoke,200,'Applicant public consent can be revoked');
  for(const name of ['candidate','candidatePhoto','candidatePdf']) await expectStatus(await call(name,'GET',undefined,draft.id),404,'Revoked consent immediately removes public access');
  expect((await(await call('candidates')).json()).total===0,'Revoked profile removed from catalog.');
  const info = await(await call('siteInfo')).json(); expect(info.phone===''&&info.whatsapp===''&&info.fees.length===0,'No company contacts or fees invented.');
  const setting = await call('settings','PATCH',{...info,phone:'61234567',fees:[{service:'測試服務',amount:'待確認',unit:'',notes:''}],expectedUpdatedAt:info.updatedAt},undefined,true); await expectStatus(setting,200,'Known settings saved privately');
  await expectStatus(await call('settings','PATCH',{...info,expectedUpdatedAt:info.updatedAt},undefined,true),409,'Stale site settings update denied');
  const currentSetting=await setting.json(),longSettings={...currentSetting,fees:Array.from({length:20},()=>({service:'項'.repeat(80),amount:'議'.repeat(80),unit:'次'.repeat(80),notes:'說'.repeat(1000)})),expectedUpdatedAt:currentSetting.updatedAt};
  expect(Buffer.byteLength(JSON.stringify(longSettings))>65536,'Valid 20-item Chinese fee table exceeds former settings byte cap.');
  await expectStatus(await call('settings','PATCH',longSettings,undefined,true),200,'Valid long Chinese company settings accepted');
  const report={passed:true,checks,isolatedDatabase:true,fixtureObjects:objects.size,pdfs:['candidate.pdf','match-client.pdf','match-full.pdf'],testedAt:new Date().toISOString()};
  await writeFile('work/platform-check/report.json',JSON.stringify(report,null,2)); console.log(JSON.stringify(report));
} finally {
  objects.clear(); sqlite.close(); delete globalThis.__jiahePlatformEnv;
  // This task owns only its exact temporary text files; PDFs are QA evidence.
  await rm('work/platform-check/pdf-text.txt',{force:true});
}
