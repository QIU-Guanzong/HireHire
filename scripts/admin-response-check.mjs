// Endpoint response contracts; all transport and records are synthetic.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), ts = require('typescript');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const validators = { exports: {}, URLSearchParams };
vm.runInNewContext(compile(await readFile('lib/admin-response.ts', 'utf8')), validators);
let sent = 0, reply;
const client = { exports: {}, AbortController, setTimeout, clearTimeout, require: name => { assert.equal(name, './admin-response'); return validators.exports; }, fetch: async () => { sent++; return new Response(JSON.stringify(reply)); } };
vm.runInNewContext(compile(await readFile('lib/admin-request.ts', 'utf8')), client);
const { validAdminResponse: valid } = validators.exports, { adminRequest, AdminApiError } = client.exports;
const checks = [], check = (ok, label) => { assert(ok, label); checks.push(label); };
const time = '2026-10-25T00:00:00Z';
const settings = { phone: '', whatsapp: '', email: '', address: '', hours: '', fees: [{ service: '合成服務', amount: '', unit: '', notes: '' }], updatedAt: time };
const record = { id: 'r1', reference: 'LOCAL-R', kind: 'employer', data: { legacyQuestion: 'preserved', consent: true, services: [] }, status: '新登記', notes: '', createdAt: time, updatedAt: time };
const candidate = { id: 'c1', intakeId: 'r2', reference: 'LOCAL-C', state: 'draft', consented: false, hasPhoto: false, createdAt: time, updatedAt: time, displayName: '合成人選', nationality: '', candidateType: '', age: '', education: '', currentLocation: '', yearsExperience: '', employmentType: '', availableFrom: '', expectedSalary: '', salaryUnit: '', summary: '', qualifications: '', services: [], languages: [], skills: [], workLocations: [], workExperiences: [] };
const match = { id: 'm1', employerId: 'r1', jobseekerId: 'r2', employerName: '', employerReference: '', jobseekerName: '', jobseekerReference: '', stage: '待聯絡', notes: '', interviewAt: '', createdAt: time, updatedAt: time };
const pages = { total: 1, page: 1, pageSize: 20 };
const records = { ...pages, records: [record], asOf: time, counts: { all: 1, employer: 1, jobseeker: 0, statuses: { '新登記': 1 } } };
const routes = [
  ['/api/admin/session', 'GET', { configured: false, authenticated: false, authorized: false, email: null }],
  ['/api/admin/settings', 'GET', { ...settings, updatedAt: '' }], ['/api/admin/settings', 'PATCH', settings],
  ['/api/admin/records?kind=employer', 'GET', records], ['/api/admin/records/r1', 'GET', record], ['/api/admin/records/r1', 'PATCH', { record }],
  ['/api/admin/candidates', 'GET', { ...pages, candidates: [candidate] }], ['/api/admin/candidates', 'POST', candidate], ['/api/admin/candidates/c1', 'GET', candidate], ['/api/admin/candidates/c1', 'PATCH', candidate],
  ['/api/admin/matches', 'GET', { ...pages, matches: [match], asOf: time }], ['/api/admin/matches', 'POST', match], ['/api/admin/matches/m1', 'PATCH', match],
];
for (const [url, method, body] of routes) {
  check(valid(url, method, body), `${method} ${url}: current/compatible legacy shape accepted`);
  check(valid(url, method, { ...body, futureField: { untouched: true } }), `${method} ${url}: additive fields accepted without normalization`);
  reply = body; const before = sent;
  check(JSON.stringify(await adminRequest(url, { method })) === JSON.stringify(body) && sent === before + 1, `${method} ${url}: valid response returned unchanged, once`);
  reply = { ok: true }; const start = sent;
  await assert.rejects(adminRequest(url, { method }), error => error instanceof AdminApiError && error.message.includes(method === 'GET' ? '有效資料' : '未能確認'));
  check(sent === start + 1, `${method} ${url}: wrong nonempty shape rejected without automatic retry`);
}
for (const [url, method, body, label] of [
  ['/api/admin/settings', 'PATCH', { ...settings, updatedAt: '' }, 'write cannot use initial empty version'],
  ['/api/admin/settings', 'GET', { ...settings, fees: [null] }, 'null fee'],
  ['/api/admin/settings', 'GET', { ...settings, fees: [{ service: 'x' }] }, 'incomplete fee'],
  ['/api/admin/settings', 'GET', { ...settings, phone: 123 }, 'contact wrong type'],
  ['/api/admin/settings', 'PATCH', { ...settings, updatedAt: 'not-a-date' }, 'invalid update timestamp'],
  ['/api/admin/records/r1', 'GET', { ...record, id: 'r2' }, 'different record identity'],
  ['/api/admin/records/r1', 'GET', { ...record, data: [] }, 'record data wrong type'],
  ['/api/admin/records/r1', 'GET', { ...record, requestedCandidateIds: [false] }, 'optional field present but malformed'],
  ['/api/admin/records?kind=jobseeker', 'GET', records, 'role-reversed record list'],
  ['/api/admin/records', 'GET', { ...records, counts: {} }, 'missing aggregate counts'],
  ['/api/admin/candidates/c1', 'PATCH', { ...candidate, consented: 'true' }, 'consent must be boolean'],
  ['/api/admin/candidates/c1', 'GET', { ...candidate, workExperiences: [{}] }, 'malformed nested experience'],
  ['/api/admin/candidates', 'GET', { ...pages, candidates: [candidate, {}] }, 'malformed nested candidate'],
  ['/api/admin/matches', 'POST', { ...match, employerId: null }, 'missing employer identity'],
  ['/api/admin/matches/m1', 'PATCH', { ...match, id: 'm2' }, 'different match identity'],
  ['/api/admin/matches', 'GET', { ...pages, matches: [match], asOf: '' }, 'missing stable snapshot'],
  ['/api/admin/session', 'GET', { configured: true, authenticated: true, authorized: 'true', email: null }, 'session privilege wrong type'],
  ['/api/admin/unrecognized', 'GET', { ok: true }, 'unknown JSON endpoint has no implicit success contract'],
]) check(!valid(url, method, body), label);
for (const key of ['phone', 'whatsapp', 'email', 'address', 'hours', 'fees', 'updatedAt']) {
  const broken = { ...settings }; delete broken[key];
  check(!valid('/api/admin/settings', 'PATCH', broken), `Missing setting ${key} cannot replace draft`);
}
check(valid('/api/admin/candidates', 'GET', { total: 0, page: 1, pageSize: 200, candidates: [] }), 'Empty candidate list remains valid');
check(valid('/api/admin/records/r1', 'GET', record), 'Old record without newer optional fields remains valid');
const report = { passed: true, checks: checks.length, labels: checks, productionRequests: 0, realRecords: 0 };
await mkdir('work/admin-response-contracts', { recursive: true });
await writeFile('work/admin-response-contracts/contracts.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, labels: undefined }));
