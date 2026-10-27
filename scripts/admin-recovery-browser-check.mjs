// Real React components against an isolated synthetic loopback API only.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(option('source') || process.cwd());
const output = path.resolve(option('output') || path.join(root, 'work/admin-response-recovery'));
const expectShapeBug = process.argv.includes('--expect-shape-bug');
const { build } = await import(option('esbuild') || 'esbuild');
const { chromium } = await import(option('playwright') || 'playwright');
const components = { settings: 'private-admin-settings', records: 'admin-workspace', matches: 'private-admin-matches', candidates: 'private-admin-candidates' };
const bundle = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';${Object.entries(components).map(([name, file]) => `import ${name} from ${JSON.stringify(path.join(root, 'components', file + '.tsx'))};`).join('')}const components={settings,records,matches,candidates};const Component=components[new URLSearchParams(location.search).get('surface')];createRoot(document.getElementById('app')).render(<Component/>);`, loader: 'tsx', resolveDir: root }, bundle: true, write: false, jsx: 'automatic', format: 'iife', define: { 'process.env.NODE_ENV': '"development"' }, nodePaths: [path.resolve(option('dependencies') || path.join(root, 'node_modules'))], tsconfig: path.join(root, 'tsconfig.json'), plugins: [{ name: 'local-fixtures', setup(builder) {
  builder.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }));
  builder.onResolve({ filter: /^\.\/locale-provider$/ }, () => ({ path: 'locale', namespace: 'fixture' }));
  builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: "export const useLocale=()=>({locale:'zh-Hant'});", loader: 'js' }));
} }], logLevel: 'silent' });
const script = bundle.outputFiles[0].contents, checks = [], unexpected = [], browserErrors = [], sockets = new Set();
let state;
const check = (ok, label) => { assert(ok, label); checks.push(label); };
const version1 = '2026-10-25T00:00:00.000Z', version2 = '2026-10-25T00:00:01.000Z';
const employer = '11111111-1111-4111-8111-111111111111', seeker = '22222222-2222-4222-8222-222222222222';
const makeRecord = kind => ({ id: kind === 'employer' ? employer : seeker, reference: 'LOCAL-' + kind, kind, data: { fullName: '合成測試 ' + kind, phone: '', services: [] }, status: '新登記', notes: '', nextFollowUp: '', createdAt: version1, updatedAt: version1, originalData: {} });
function reset(surface, kind, mode, session = 'allowed') {
  state = { surface, kind, mode, session, requests: [], reads: [], stored: surface === 'settings' ? { phone: '', whatsapp: '', email: '', address: '', hours: '', fees: [], updatedAt: version1 } : surface === 'matches' ? { id: '33333333-3333-4333-8333-333333333333', employerId: employer, jobseekerId: seeker, employerName: '合成僱主', employerReference: 'LOCAL-E', jobseekerName: '合成求職者', jobseekerReference: 'LOCAL-J', stage: '待聯絡', notes: '', interviewAt: '', createdAt: version1, updatedAt: version1 } : makeRecord(kind) };
  if (surface === 'candidates') state.stored = { id: seeker, reference: 'LOCAL-C', intakeId: seeker, state: 'draft', consented: false, createdAt: version1, updatedAt: version1, displayName: '合成人選', services: [], nationality: '', candidateType: '', age: '', education: '', currentLocation: '', languages: [], yearsExperience: '', skills: [], employmentType: '', workLocations: [], availableFrom: '', expectedSalary: '', salaryUnit: '', salaryNegotiable: false, summary: '', qualifications: '', workExperiences: [], hasPhoto: false };
}
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/component.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(script); return; }
  if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (!url.pathname.startsWith('/api/')) { res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); res.end('<!doctype html><html><meta charset="utf-8"><div id="app"></div><script src="/component.js"></script></html>'); return; }
  if (url.pathname === '/api/admin/session') { send(res, 200, { configured: state.session !== 'unconfigured', authenticated: state.session === 'allowed', authorized: state.session === 'allowed', email: null, name: 'Synthetic local session' }); return; }
  if (req.method === 'PATCH') {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString()); state.requests.push(payload);
    if (state.requests.length > 1 && payload.expectedUpdatedAt !== state.stored.updatedAt) { send(res, 409, { error: '合成版本衝突' }); return; }
    if (state.mode === 'forbidden') { send(res, 403, { error: '合成拒絕存取' }); return; }
    const values = { ...payload }; delete values.expectedUpdatedAt;
    state.stored = { ...state.stored, ...values, ...(values.profile || {}), updatedAt: version2 };
    if (state.requests.length === 1) {
      if (state.mode === 'wrong-shape') { send(res, 200, { ok: true }); return; }
      if (state.mode === 'invalid-json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{broken'); return; }
      if (state.mode === 'held-body') { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"incomplete":'); return; }
      if (state.mode === 'held-headers') return;
    }
    send(res, 200, state.stored); return;
  }
  state.reads.push(url.pathname);
  if (req.method !== 'GET') { unexpected.push(req.method + ' ' + url.pathname); send(res, 405, {}); return; }
  if (url.pathname === '/api/admin/candidates') { send(res, 200, { candidates: [state.stored], total: 1, page: 1, pageSize: 200 }); return; }
  if (url.pathname.startsWith('/api/admin/candidates/')) { send(res, 200, state.stored); return; }
  if (url.pathname === '/api/admin/settings') { send(res, 200, state.stored); return; }
  if (url.pathname === '/api/admin/matches') { send(res, 200, { matches: [state.stored], total: 1, page: 1, pageSize: 200, asOf: version2 }); return; }
  if (url.pathname === '/api/admin/records') {
    const record = state.surface === 'records' ? state.stored : makeRecord(url.searchParams.get('kind') || 'employer');
    send(res, 200, { records: [record], total: 1, page: 1, pageSize: 20, asOf: version2, counts: { all: 1, employer: record.kind === 'employer' ? 1 : 0, jobseeker: record.kind === 'jobseeker' ? 1 : 0, statuses: { '新登記': 1 } } }); return;
  }
  if (url.pathname.startsWith('/api/admin/records/')) { send(res, 200, state.stored); return; }
  unexpected.push(req.method + ' ' + url.pathname); send(res, 404, {});
});
server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
let browser, failure;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: option('chromium'), headless: true });
  for (const [surface, kind] of [['settings', ''], ['records', 'employer'], ['records', 'jobseeker'], ['matches', ''], ['candidates', '']].filter(([surface]) => !option('surface') || surface === option('surface'))) {
    for (const mode of ['invalid-json', 'held-headers', 'held-body', 'forbidden', 'wrong-shape'].filter(mode => !option('mode') || mode === option('mode'))) {
      reset(surface, kind, mode);
      const context = await browser.newContext();
      // Only accelerate the production request deadline; React/debounce timing is unchanged.
      await context.addInitScript(() => { const original = window.setTimeout; window.setTimeout = (handler, delay, ...args) => original(handler, delay === 20000 ? 250 : delay, ...args); });
      await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : (unexpected.push(route.request().url()), route.abort()));
      const page = await context.newPage(); page.on('pageerror', error => browserErrors.push(error.message));
      await page.goto(`${origin}/?surface=${surface}`);
      let field, button;
      if (surface === 'settings') { field = page.getByLabel('辦公時間', { exact: true }); button = page.getByRole('button', { name: '儲存設定', exact: true }); }
      else if (surface === 'records') { await page.locator('button[data-record-trigger="name"]').click(); field = page.locator('#record-notes'); button = page.getByRole('button', { name: '儲存更新', exact: true }); }
      else if (surface === 'candidates') { await page.getByRole('button', { name: '審核／修改', exact: true }).click(); field = page.locator('#candidate-field-summary'); button = page.getByRole('button', { name: '儲存簡介及狀態', exact: true }); await field.waitFor(); const publication = await page.locator('.private-publication-state option[value=published]').evaluate(element => ({ disabled: element.disabled, html: element.outerHTML })); check(publication.disabled, 'Unconsented candidate cannot select publication: ' + JSON.stringify(publication)); }
      else { await page.getByRole('button', { name: '修改跟進', exact: true }).click(); field = page.locator('#edit-match-notes'); button = page.getByRole('button', { name: '儲存跟進', exact: true }); }
      await field.fill('合成修改保留');
      const renderFailure = expectShapeBug ? page.waitForEvent('pageerror') : null;
      await button.click();
      if (expectShapeBug) {
        assert.equal(surface, 'settings'); assert.equal(mode, 'wrong-shape');
        const error = await renderFailure;
        check(/undefined|fees|length/.test(error.message) && state.requests.length === 1, 'Frozen PR10 replaces settings with wrong-shaped success and crashes');
        await context.close(); continue;
      }
      await page.getByRole('alert').filter({ hasText: mode === 'forbidden' ? '合成拒絕存取' : '未能確認' }).first().waitFor();
      check(await field.inputValue() === '合成修改保留', `${surface}/${kind}/${mode}: edit retained`);
      check(await field.isEnabled() && await button.isEnabled(), `${surface}/${kind}/${mode}: form released`);
      check(state.requests.length === 1 && state.requests[0].expectedUpdatedAt === version1, `${surface}/${kind}/${mode}: no automatic retry or version replacement`);
      if (mode !== 'forbidden') {
        // A separate synthetic writer changes the server copy after the lost response.
        state.stored[surface === 'settings' ? 'hours' : surface === 'candidates' ? 'summary' : 'notes'] = '合成其他更新';
        await button.click();
        if (surface === 'settings') await page.getByRole('heading', { name: '目前公開設定', exact: true }).waitFor();
        else await page.getByRole('button', { name: '載入最新資料', exact: true }).waitFor();
        check(await field.inputValue() === '合成修改保留' && state.requests.length === 2 && state.requests[1].expectedUpdatedAt === version1, `${surface}/${kind}/${mode}: explicit retry keeps original version and conflict preserves edit`);
        if (surface !== 'settings') await page.getByRole('button', { name: '載入最新資料', exact: true }).click();
        const confirm = page.getByRole('button', { name: surface === 'settings' ? '以我的修改更新最新設定' : '確認覆蓋並儲存', exact: true });
        await confirm.waitFor();
        check(await field.inputValue() === '合成修改保留', `${surface}/${kind}/${mode}: reload for comparison retains edit`);
        await confirm.click();
        await page.getByText(surface === 'settings' ? '設定已儲存，公開頁面已更新。' : surface === 'records' ? '更新已儲存' : surface === 'candidates' ? '簡介及公開狀態已儲存' : '配對跟進已儲存', { exact: true }).waitFor();
        check(state.requests.length === 3 && state.requests[2].expectedUpdatedAt === version2 && await field.inputValue() === '合成修改保留', `${surface}/${kind}/${mode}: explicit confirmation updates current version and finishes recovery`);

      }
      await context.close();
    }
  }
  for (const surface of (expectShapeBug ? [] : Object.keys(components)).filter(surface => !option('surface') || surface === option('surface'))) for (const session of ['unconfigured', 'denied']) {
    reset(surface, '', 'none', session);
    const context = await browser.newContext(); const page = await context.newPage();
    await page.goto(`${origin}/?surface=${surface}`);
    await page.getByRole('heading', { name: session === 'unconfigured' ? '管理帳戶尚未設定' : '請從管理入口開啟後台', exact: true }).waitFor();
    check(state.reads.length === 0 && state.requests.length === 0, `${surface}/${session}: gate does not request private data`);
    await context.close();
  }
  check(unexpected.length === 0 && (expectShapeBug ? browserErrors.length === 1 : browserErrors.length === 0), 'No external/unexpected requests or uncaught browser errors');
} catch (error) { failure = error; }
finally {
  await browser?.close(); for (const socket of sockets) socket.destroy();
  await new Promise(resolve => server.close(resolve));
  const report = { passed: !failure, scope: option('surface') || 'all', expectedBaselineBug: expectShapeBug, checks: checks.length, labels: checks, unexpected, browserErrors, failure: failure?.stack, productionRequests: 0, realRecords: 0, syntheticOnly: true };
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'browser.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, labels: undefined }));
}
if (failure) process.exitCode = 1;
