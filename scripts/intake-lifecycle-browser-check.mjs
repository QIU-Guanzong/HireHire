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
  for (const kind of ['employer', 'jobseeker']) for (const mode of ['late-headers', 'late-body', 'digest-unmount', 'other-draft', 'timeout-retry', 'reopen-confirm', 'draft-actions', 'failure400']) {
    const lang = mode === 'late-body' || mode === 'failure400' ? 'en' : 'zh-Hant';
    const context = await browser.newContext({ viewport: { width: lang === 'en' ? 1280 : 360, height: 900 }, reducedMotion: 'reduce' });
    await context.route('**/*', route => { if (new URL(route.request().url()).origin !== origin) { unexpected.push('non-loopback request'); return route.abort(); } return route.continue(); });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    state = { mode, requests: [], receipts: new Map() };
    const label = text => `${kind}/${mode}/${lang}: ${text}`;
    const data = { fullName: '合成生命周期 ONLY', phone: '+852 00000005', services: ['家居清潔'], employmentType: '兼職', consent: true,
      ...(kind === 'employer' ? { district: '沙田', householdAdults: '2', duties: ['煮食'], startDate: '2026-11-01', schedule: '合成時間 unchanged', budgetNegotiable: true } : { nationality: '香港', currentLocation: '香港', languages: ['廣東話'], yearsExperience: '少於1年', workHistory: '首次求職', workLocations: ['沙田'], availableFrom: '2026-11-01', salaryNegotiable: true }) };
    const draftKey = `jiahe.intake.${kind}.v1`, attemptKey = `jiahe.attempt.${kind}.v1`;
    await page.goto(`${origin}/?kind=${kind}&lang=${lang}`);
    await page.evaluate(({ draftKey, data }) => { window.unmount(); localStorage.setItem(draftKey, JSON.stringify({ data, step: 3, reviewReached: true, savedAt: new Date().toISOString() })); window.mount(); }, { draftKey, data });
    if (mode === 'draft-actions') {
      for (let step = 0; step < 3; step++) {
        for (const [name, value] of Object.entries(data)) {
          const field = page.locator(`[name="${name}"]`);
          if (!await field.count() || !await field.first().isVisible()) continue;
          if (Array.isArray(value)) { for (const item of value) await page.locator(`[name="${name}"][value="${item}"]`).check(); }
          else if (typeof value === 'boolean') await field.setChecked(value);
          else if (await field.evaluate(el => el.tagName === 'SELECT')) await field.selectOption(value);
          else await field.fill(value);
        }
        await page.locator('.form-actions button[type="submit"]').click();
      }
      await page.locator('#field-consent').check();
    } else await page.locator('.draft-actions .primary').click();
    await page.locator('.review-sections').waitFor();
    if (mode === 'digest-unmount') await page.evaluate(() => { const original = crypto.subtle.digest.bind(crypto.subtle); crypto.subtle.digest = async (...args) => { const result = await original(...args); return new Promise(resolve => { window.releaseDigest = () => resolve(result); }); }; });
    if (mode === 'timeout-retry') await page.clock.install();
    const submit = page.locator('.form-actions button[type="submit"]');
    await submit.evaluate(el => { for (let i = 0; i < 3; i++) el.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    if (mode === 'digest-unmount') await page.waitForFunction(() => typeof window.releaseDigest === 'function'); else await poll(() => state.requests.length === 1);
    if (mode !== 'digest-unmount') check(state.requests.length === 1, label('Repeated clicks create one request'));
    if (['late-headers', 'late-body', 'digest-unmount', 'other-draft'].includes(mode)) {
      const replacement = { data: { ...data, fullName: '較新的合成草稿 KEEP' }, step: 3, reviewReached: true, savedAt: '2026-10-24T00:00:00Z', attempt: { key: 'new-synthetic-attempt-0002', fingerprint: 'new-fingerprint' }, pending: false };
      await page.evaluate(({ draftKey, attemptKey, replacement, unmount }) => { if (unmount) window.unmount(); localStorage.setItem(draftKey, JSON.stringify(replacement)); sessionStorage.setItem(attemptKey, JSON.stringify(replacement.attempt)); if (unmount) window.mount(); }, { draftKey, attemptKey, replacement, unmount: mode !== 'other-draft' });
      if (mode === 'digest-unmount') { await page.evaluate(() => window.releaseDigest()); if (baseline) await poll(() => state.requests.length === 1); }
      else release();
      await page.waitForTimeout(150);
      const stored = await page.evaluate(({ draftKey, attemptKey }) => ({ draft: localStorage.getItem(draftKey), attempt: sessionStorage.getItem(attemptKey) }), { draftKey, attemptKey });
      if (baseline) {
        check(mode === 'digest-unmount' ? JSON.parse(stored.draft).data.fullName === data.fullName : stored.draft === null, label('BUG reproduced: obsolete attempt alters newer draft'));
      } else {
        check(JSON.stringify(JSON.parse(stored.draft)) === JSON.stringify(replacement), label('Newer draft untouched by obsolete/different attempt'));
        check(JSON.parse(stored.attempt).key === replacement.attempt.key, label('Newer attempt key survives'));
        if (mode === 'digest-unmount') check(state.requests.length === 0, label('Unmount during digest prevents network send'));
        if (mode.startsWith('late-')) check(state.held.destroyed, label('Unmount aborts pending response'));
      }
      if (mode !== 'other-draft') check(await page.locator('.intake-success').count() === 0, label('New form does not display obsolete receipt'));
      release();
    } else if (mode === 'draft-actions') {
      const restart = page.locator('.draft-actions .secondary'), resume = page.locator('.draft-actions .primary');
      if (baseline) {
        check(!(await restart.isDisabled()) && !(await resume.isDisabled()), label('BUG reproduced: draft actions enabled during request'));
        await restart.click();check(await page.locator('#field-fullName').inputValue() === '', label('BUG reproduced: restart discards in-flight form input'));
      } else {
        check(await restart.isDisabled() && await resume.isDisabled(), label('Draft actions locked during in-flight submission'));
        check((await page.locator('.review-sections').innerText()).includes(data.fullName), label('In-flight reviewed input remains intact'));
      }
      release();await page.locator('.intake-success').waitFor();
    } else if (mode === 'reopen-confirm') {
      await page.evaluate(() => { window.unmount(); window.mount(); });
      await page.locator('.draft-actions .primary').click(); await page.locator('.review-sections').waitFor();
      check((await submit.innerText()).includes('重試確認'), label('Reopened pending draft confirms original submission'));
      check(await page.locator('.form-actions button.secondary').isDisabled(), label('Reopened original envelope remains locked'));
      await submit.click(); await page.locator('.intake-success').waitFor();
      check(state.requests.length === 2 && state.requests[0] === state.requests[1], label('Reopen retry sends original bytes and key'));
      check(state.receipts.size === 1, label('Reopen does not create a duplicate receipt'));
    } else if (mode === 'timeout-retry') {
      await page.clock.fastForward(31000); await poll(async () => !(await submit.isDisabled()));
      check((await submit.innerText()).includes('重試確認'), label('Timeout remains unconfirmed'));
      check(await page.locator('.form-actions button.secondary').isDisabled(), label('Original envelope locked while outcome unknown'));
      await submit.click(); await page.locator('.intake-success').waitFor();
      check(state.requests.length === 2 && state.requests[0] === state.requests[1], label('Confirmation uses identical payload and key'));
      check(state.receipts.size === 1, label('Only one synthetic receipt'));
      check(await page.evaluate(({ draftKey, attemptKey }) => localStorage.getItem(draftKey) === null && sessionStorage.getItem(attemptKey) === null, { draftKey, attemptKey }), label('Own confirmed draft and key cleared'));
    } else {
      await page.locator('.error-summary').waitFor(); await poll(async () => !(await submit.isDisabled()));
      check((await page.locator('.review-sections').innerText()).includes(data.fullName), label('Rejected submission preserves original input'));
      check(!(await page.locator('.review-heading button').first().isDisabled()), label('Confirmed rejection permits editing'));
      await page.locator('.review-heading button').first().click();
      check(await page.locator('#field-fullName').inputValue() === data.fullName, label('Back to edit retains input'));
      await page.locator('#field-fullName').fill('更正後 合成 ONLY'); await submit.click(); await page.locator('.review-sections').waitFor(); await submit.click(); await page.locator('.intake-success').waitFor();
      const [first, second] = state.requests.map(JSON.parse);check(first.idempotencyKey !== second.idempotencyKey && second.data.fullName === '更正後 合成 ONLY', label('Edited confirmed failure gets a new attempt'));
      check(state.receipts.size === 1, label('Rejected attempt creates no receipt'));
    }
    state.held?.destroy(); await context.close();
  }
  check(errors.length === 0, 'No uncaught browser errors'); check(unexpected.length === 0, 'No non-loopback requests');
} catch (error) { failure = error; }
finally { await browser.close(); for (const s of sockets) s.destroy(); await new Promise(resolve => server.close(resolve)); }
const report = { passed: !failure, baselineBugsReproduced: baseline && !failure, checks: checks.length, assertions: checks, componentSha256: createHash('sha256').update(await readFile(component)).digest('hex'), scope: 'actual React component with isolated locale provider; no Next app build', productionRequests: 0, syntheticOnly: true, browserErrors: errors, failure: failure?.message };
await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report)); if (failure) process.exitCode = 1;
