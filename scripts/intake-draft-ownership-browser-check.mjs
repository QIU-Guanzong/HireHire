// Offline React-component regression. All submissions terminate in a synthetic loopback receiver.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const option = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(option('source') || fileURLToPath(new URL('..', import.meta.url)));
const dependencies = path.resolve(option('dependencies') || path.join(root, 'node_modules'));
const { build } = await import(option('esbuild') || 'esbuild');
const { chromium } = await import(option('playwright') || 'playwright');
const output = path.resolve(option('output') || path.join(root, 'work/intake-lifecycle'));
const baseline = process.argv.includes('--expect-bug');
await mkdir(output, { recursive: true });
const component = path.join(root, 'components/intake-form.tsx');
const built = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import IntakeForm from ${JSON.stringify(component)};let app;window.mount=()=>{app=createRoot(document.getElementById('app'));flushSync(()=>app.render(<IntakeForm kind={new URLSearchParams(location.search).get('kind')||'employer'}/>));};window.unmount=()=>{flushSync(()=>app.unmount());};window.mount();`, loader: 'tsx', resolveDir: root }, bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, nodePaths: [dependencies], plugins: [{ name: 'isolated-locale', setup(builder) { builder.onResolve({ filter: /^\.\/locale-provider$/ }, () => ({ path: 'locale', namespace: 'fixture' })); builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const useLocale=()=>({locale:new URLSearchParams(location.search).get('lang')||'zh-Hant'});`, loader: 'js' })); } }], tsconfig: path.join(root, 'tsconfig.json'), logLevel: 'silent' });
const script = built.outputFiles[0].contents;
let state, failure;
const checks = [], errors = [], unexpected = [], sockets = new Set();
const check = (v, label) => { assert(v, label); checks.push(label); };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'POST' && url.pathname === '/api/intake') {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks).toString(); const body = JSON.parse(bytes); state.requests.push(bytes);
    if (state.mode === 'failure400' && state.requests.length === 1) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: '請檢查表格內的資料。' })); return; }
    if (!state.receipts.has(body.idempotencyKey)) state.receipts.set(body.idempotencyKey, 'LOCAL-LIFECYCLE-ONLY-001');
    if (state.requests.length === 1) {
      state.held = res;
      if (state.mode === 'late-body') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{"reference":'); }
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ reference: state.receipts.get(body.idempotencyKey) })); return;
  }
  if (req.method !== 'GET') { unexpected.push(req.method + ' ' + url.pathname); res.writeHead(405); res.end(); return; }
  if (url.pathname === '/component.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(script); return; }
  if (url.pathname === '/api/candidates') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"candidates":[]}'); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<!doctype html><html><meta charset="utf-8"><title>Isolated intake component</title><div id="app"></div><script src="/component.js"></script></html>');
});
server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: option('chromium'), headless: true });
const poll = async f => { for (let i = 0; i < 100; i++) { if (await f()) return; await new Promise(r => setTimeout(r, 30)); } throw new Error('Bounded condition not reached'); };
const release = () => { if (!state.held || state.held.destroyed) return; if (state.mode === 'late-body') state.held.end('"LOCAL-LIFECYCLE-ONLY-001"}'); else { state.held.writeHead(200, { 'Content-Type': 'application/json' }); state.held.end('{"reference":"LOCAL-LIFECYCLE-ONLY-001"}'); } };
try {
  const compatibilityModes = ['missing-locks', 'reject-lock', 'unlocked-read-error', 'locked-read-error', 'missing-locks-503', 'reject-lock-503', 'persisted-503'];
  const modes = option('compat-case') ? [option('compat-case')] : process.argv.includes('--compat-only') ? compatibilityModes : ['cross-400', 'cross-body-400', 'cross-timeout', 'cross-body-timeout', 'cross-cancel', 'queued-unmount', 'concurrent-claim', 'same-400', 'same-key-400', 'same-key-success', 'stale-disable', 'stale-restart', 'stale-continue', 'ordinary-edit', 'shared-race'];
  for (const kind of ['employer', 'jobseeker']) for (const mode of modes) {
    const context = await browser.newContext({ viewport: { width: kind === 'employer' ? 360 : 1280, height: 900 }, reducedMotion: 'reduce' });
    await context.route('**/*', route => { if (new URL(route.request().url()).origin !== origin) { unexpected.push('non-loopback request'); return route.abort(); } return route.continue(); });
    const page = await context.newPage(), other = await context.newPage();
    for (const tab of [page, other]) tab.on('pageerror', e => errors.push(e.message));
    state = { mode, requests: [], receipts: new Map() };
    const label = text => `${kind}/${mode}: ${text}`;
    const data = { fullName: '合成 A ONLY', phone: '+852 00000005', services: ['家居清潔'], employmentType: '兼職', consent: true,
      ...(kind === 'employer' ? { district: '沙田', householdAdults: '2', duties: ['煮食'], startDate: '2026-11-01', schedule: '合成時間 unchanged', budgetNegotiable: true } : { nationality: '香港', currentLocation: '香港', languages: ['廣東話'], yearsExperience: '少於1年', workHistory: '首次求職', workLocations: ['沙田'], availableFrom: '2026-11-01', salaryNegotiable: true }) };
    const key = `jiahe.intake.${kind}.v1`, attemptKey = `jiahe.attempt.${kind}.v1`;
    const original = { data, step: 3, reviewReached: true, savedAt: '2026-10-24T00:00:00Z' };
    const url = `${origin}/?kind=${kind}&lang=${kind === 'employer' ? 'zh-Hant' : 'en'}`;
    const storage = tab => tab.evaluate(key => localStorage.getItem(key), key);
    const seed = async (tab, draft) => { await tab.evaluate(({ key, draft }) => { window.unmount(); localStorage.setItem(key, JSON.stringify(draft)); window.mount(); }, { key, draft }); };
    const resume = async tab => { await tab.locator('.draft-actions .primary').click(); await tab.locator('.review-sections').waitFor(); };
    const editName = async (tab, name) => { await tab.locator('.review-heading button').first().click(); await tab.locator('#field-fullName').fill(name); };
    await page.goto(url); await other.goto(url); await seed(page, original);
    if (!mode.startsWith('stale-') && mode !== 'concurrent-claim' && !compatibilityModes.includes(mode)) await resume(page);
    if (compatibilityModes.includes(mode)) {
      await page.evaluate(({ mode, key }) => {
        window.realLocks = navigator.locks;
        if (mode.startsWith('missing-locks') || mode === 'unlocked-read-error') Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
        if (mode.startsWith('reject-lock')) Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: () => Promise.reject(new DOMException('Synthetic lock denial', 'SecurityError')) } });
        if (mode.endsWith('read-error')) {
          const get = Storage.prototype.getItem;
          window.restoreRead = () => { Storage.prototype.getItem = get; };
          Storage.prototype.getItem = function(k) { if (this === localStorage && k === key) throw new DOMException('Synthetic read denial', 'SecurityError'); return get.call(this, k); };
        }
      }, { mode, key });
      await page.locator('.draft-actions .primary').click(); await page.waitForTimeout(200);
      if (mode.endsWith('read-error')) {
        check(await page.locator('.draft-banner').count() === 1 && await page.locator('.review-sections').count() === 0, label('Storage read failure does not pretend the draft was restored'));
        check((await page.locator('.draft-control p').innerText()).includes(kind === 'employer' ? '未能讀取已儲存草稿' : 'Could not read the saved draft'), label('Read failure is distinct from lock unavailability'));
        await page.evaluate(() => window.restoreRead());
        await page.locator('.draft-actions .primary').click(); await page.locator('.draft-banner').waitFor({ state: 'hidden' });
      }
      check(await page.locator('.review-sections').count() === 1 && (await page.locator('.review-sections').innerText()).includes(data.fullName), label('Readable draft restores into memory without a successful write lock'));
      if (mode !== 'locked-read-error' && mode !== 'persisted-503') {
        check(!(await page.locator('.draft-control input').isChecked()), label('Memory-only restore does not claim autosave is enabled'));
        check((await page.locator('.draft-control p').innerText()).includes(kind === 'employer' ? '無法安全鎖定草稿' : 'cannot safely lock drafts'), label('Persistence limitation is explained in the current language'));
      }
      if (mode.endsWith('503')) {
        if (mode !== 'persisted-503') await other.evaluate(key => localStorage.removeItem(key), key);
        await page.locator('.draft-control input').check();
        const submit = page.locator('.form-actions button[type="submit"]'); await submit.click(); await poll(() => state.requests.length === 1);
        state.held.writeHead(503, { 'Content-Type': 'application/json' }); state.held.end('{"error":"synthetic unavailable"}');
        await page.locator('.error-summary').waitFor(); await poll(async () => !(await submit.isDisabled()));
        const note = await page.locator('.draft-control p').innerText();
        if (mode === 'persisted-503') {
          const stored = JSON.parse(await storage(other));
          check(stored.pending === true && stored.attempt.key === JSON.parse(state.requests[0]).idempotencyKey, label('Successful persistence retains the original pending attempt'));
          check(note.includes(kind === 'employer' ? '草稿會保留至確認完成' : 'The draft will stay until the submission is confirmed.'), label('Pending retention message is reserved for a successful save'));
        } else {
          check(await storage(other) === null, label('No persistent draft exists after failed save and 503'));
          check(note.includes(kind === 'employer' ? '無法安全鎖定草稿' : 'cannot safely lock drafts') && !note.includes(kind === 'employer' ? '草稿會保留至確認完成' : 'The draft will stay until the submission is confirmed.'), label('Save failure takes priority over pending-submission retention promise'));
        }
        check((await page.locator('.review-sections').innerText()).includes(data.fullName), label('Unknown outcome retains input in memory'));
        await submit.click(); await page.locator('.intake-success').waitFor();
        check(state.requests.length === 2 && state.requests[0] === state.requests[1], label('Memory-only retry confirms the original envelope and key'));
      } else {
      const replacement = { ...original, data: { ...data, fullName: '合成 B SAFE' }, revision: 'newer-compat-revision' };
      await seed(other, replacement); await resume(other); await editName(other, '合成 B PROTECTED');
      await poll(async () => JSON.parse(await storage(other)).data.fullName === '合成 B PROTECTED'); const before = await storage(other);
      await editName(page, '合成 A MEMORY EDIT'); await page.waitForTimeout(150);
      check(await page.locator('#field-fullName').inputValue() === '合成 A MEMORY EDIT', label('Restored memory remains editable'));
      check(await storage(other) === before, label('Later editing never overwrites another page draft'));
      await page.locator('.draft-control input').check(); await page.locator('.draft-control input').uncheck(); await page.waitForTimeout(150);
      check(await storage(other) === before, label('Autosave toggles do not bypass failed locking or lost ownership'));
      if (mode !== 'locked-read-error' && mode !== 'persisted-503') {
        await page.evaluate(() => Object.defineProperty(navigator, 'locks', { configurable: true, value: window.realLocks }));
        await page.locator('.draft-control input').check(); await page.locator('#field-fullName').fill('合成 A LATER EDIT'); await page.waitForTimeout(150);
        check(await storage(other) === before, label('Memory-only session never silently reacquires write permission'));
      }
      }
    } else if (mode === 'concurrent-claim') {
      await other.reload(); await other.locator('.draft-banner').waitFor();
      await Promise.all([page.locator('.draft-actions .primary').click(), other.locator('.draft-actions .primary').click()]);
      await poll(async () => (await page.locator('.review-sections').count()) + (await other.locator('.review-sections').count()) === 1);
      await page.waitForTimeout(150);
      check((await page.locator('.review-sections').count()) + (await other.locator('.review-sections').count()) === 1, label('Concurrent claim admits exactly one revision owner'));
      check((await page.locator('.draft-banner').count()) + (await other.locator('.draft-banner').count()) === 1, label('Losing claim keeps the draft choice instead of silently replacing it'));
    } else if (mode === 'queued-unmount') {
      await other.evaluate(kind => { window.lockHeld = false; navigator.locks.request(`jiahe.draft.${kind}`, () => new Promise(resolve => { window.releaseLock = resolve; window.lockHeld = true; })); }, kind);
      await other.waitForFunction(() => window.lockHeld);
      const before = await storage(page);
      await page.locator('.form-actions button[type="submit"]').click();
      await page.waitForFunction(async kind => (await navigator.locks.query()).pending.some(lock => lock.name === `jiahe.draft.${kind}`), kind);
      await page.evaluate(() => window.unmount()); await other.evaluate(() => window.releaseLock()); await page.waitForTimeout(150);
      check(await storage(other) === before && state.requests.length === 0, label('Unmount while waiting for storage lock neither persists nor sends'));
    } else if (mode === 'ordinary-edit') {
      await editName(page, '明確繼續 A EDIT'); await poll(async () => JSON.parse(await storage(page)).data.fullName === '明確繼續 A EDIT');
      check(true, label('Explicitly resumed old draft still autosaves edits'));
      await page.reload(); await page.locator('.draft-actions .primary').click(); await page.locator('.draft-banner').waitFor({ state: 'hidden' });
      check(await page.locator('#field-fullName').inputValue() === '明確繼續 A EDIT', label('Own edit survives reload'));
      await page.locator('.draft-control input').uncheck(); await poll(async () => await storage(page) === null);
      check(true, label('Disabling own draft removes only own snapshot'));
    } else if (mode === 'shared-race') {
      await other.reload(); await resume(other); // A now holds a stale snapshot of the same attempt.
      await editName(other, '合成 B OWNER'); await poll(async () => JSON.parse(await storage(other)).data.fullName === '合成 B OWNER');
      const before = await storage(other);
      await editName(page, '合成 A LOCAL'); await page.waitForTimeout(150);
      check(await storage(other) === before, label('Two live forms cannot silently autosave over a newer revision'));
      check(await page.locator('#field-fullName').inputValue() === '合成 A LOCAL', label('Losing tab retains editable input in memory'));
    } else if (mode.startsWith('stale-')) {
      const replacement = { ...original, data: { ...data, fullName: '合成 B NEW' }, revision: 'foreign-revision', attempt: { key: 'new-synthetic-attempt-0002', fingerprint: 'new-fingerprint' } };
      await seed(other, replacement); await resume(other); await editName(other, '合成 B EDIT');
      await poll(async () => JSON.parse(await storage(other)).data.fullName === '合成 B EDIT'); const before = await storage(other);
      if (mode === 'stale-disable') { await page.locator('.draft-control input').check(); await page.locator('.draft-control input').uncheck(); }
      else await page.locator(mode === 'stale-restart' ? '.draft-actions .secondary' : '.draft-actions .primary').click();
      await page.waitForTimeout(150); check(await storage(other) === before, label('Stale draft action cannot remove or replace newer saved work'));
      await page.reload(); await page.locator('.draft-actions .primary').click(); await page.locator('.draft-banner').waitFor({ state: 'hidden' });
      check(await page.locator('#field-fullName').inputValue() === '合成 B EDIT', label('Reload and explicit continue can edit the current saved draft'));
      await page.locator('#field-fullName').fill('明確繼續 B EDIT'); await poll(async () => JSON.parse(await storage(page)).data.fullName === '明確繼續 B EDIT');
      check(true, label('Explicit current-draft edit resumes autosave'));
    } else {
      if (mode.endsWith('timeout')) await page.clock.install();
      const submit = page.locator('.form-actions button[type="submit"]'); await submit.click(); await poll(() => state.requests.length === 1);
      if (mode.includes('-body-')) { state.held.writeHead(mode.endsWith('400') ? 400 : 200, { 'Content-Type': 'application/json' }); state.held.write('{\"error\":'); }
      const request = JSON.parse(state.requests[0]); const pending = JSON.parse(await storage(page));
      const replacement = { ...original, data: { ...data, fullName: '合成 B NEW' }, revision: 'foreign-revision', attempt: mode.startsWith('same-key') ? pending.attempt : { key: 'new-synthetic-attempt-0002', fingerprint: 'new-fingerprint' } };
      if (mode === 'same-400') await page.evaluate(({ key, replacement }) => localStorage.setItem(key, JSON.stringify(replacement)), { key, replacement });
      else { await seed(other, replacement); await resume(other); await editName(other, '合成 B EDIT'); await poll(async () => JSON.parse(await storage(other)).data.fullName === '合成 B EDIT'); }
      const before = await storage(other);
      if (mode.endsWith('timeout')) { await page.clock.fastForward(31000); await poll(async () => !(await submit.isDisabled())); }
      else if (mode === 'cross-cancel') { await page.evaluate(() => window.unmount()); await poll(() => state.held.destroyed); }
      else if (mode === 'same-key-success') { release(); await page.locator('.intake-success').waitFor(); }
      else { if (state.held.headersSent) state.held.end('"請檢查表格內的資料。"}'); else { state.held.writeHead(400, { 'Content-Type': 'application/json' }); state.held.end('{"error":"請檢查表格內的資料。"}'); } await page.locator('.error-summary').waitFor(); await poll(async () => !(await submit.isDisabled())); }
      await page.waitForTimeout(150);
      check(await storage(other) === before, label('Foreign/newer revision survives late response, timeout or cancellation'));
      if (mode.endsWith('400')) {
        await editName(page, '失敗後 A STILL EDITABLE'); await page.waitForTimeout(150);
        check(await page.locator('#field-fullName').inputValue() === '失敗後 A STILL EDITABLE', label('Confirmed failure preserves editable local input'));
        check(await storage(other) === before, label('Later edits do not silently regain ownership'));
      }
      if (mode.endsWith('timeout')) {
        check(await page.locator('.form-actions button.secondary').isDisabled(), label('Unknown outcome keeps original envelope locked'));
        await submit.click(); await page.locator('.intake-success').waitFor();
        check(state.requests.length === 2 && state.requests[0] === state.requests[1], label('Retry still confirms original bytes and key'));
        check(await storage(other) === before, label('Successful retry does not delete the foreign draft'));
      } else if (mode === 'cross-cancel') {
        check((await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), attemptKey)).key === request.idempotencyKey, label('Cancellation preserves original attempt identity'));
      }
      await page.reload(); await page.locator('.draft-actions .primary').click(); await page.locator('.draft-banner').waitFor({ state: 'hidden' });
      const expected = JSON.parse(before).data.fullName;
      if (mode === 'same-400') check((await page.locator('.review-sections').innerText()).includes(expected), label('Reload restores the surviving draft, not the late response'));
      else check(await page.locator('#field-fullName').inputValue() === expected, label('Reload restores the surviving draft, not the late response'));
    }
    state.held?.destroy(); await context.close();
  }
  check(errors.length === 0, 'No uncaught browser errors'); check(unexpected.length === 0, 'No non-loopback requests');
} catch (error) { failure = error; }
finally { await browser.close(); for (const s of sockets) s.destroy(); await new Promise(resolve => server.close(resolve)); }
const report = { passed: !failure, baselineBugsReproduced: baseline && !failure, checks: checks.length, assertions: checks, componentSha256: createHash('sha256').update(await readFile(component)).digest('hex'), scope: 'actual React component with isolated locale provider; no Next app build', productionRequests: 0, syntheticOnly: true, browserErrors: errors, failure: failure?.message };
await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report)); if (failure) process.exitCode = 1;
