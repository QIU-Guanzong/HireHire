// Actual public candidate components; synthetic loopback API and storage faults.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(option('source') || process.cwd()), output = path.resolve(option('output') || 'work/candidate-storage');
const baseline = process.argv.includes('--expect-warning-bug');
const { build } = await import(option('esbuild') || 'esbuild');
const { chromium } = await import(option('playwright') || 'playwright');
const ids = Array.from({ length: 31 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const candidate = { id: ids[0], reference: 'SYNTHETIC-001', displayName: 'SYNTHETIC', services: [], nationality: '', candidateType: '', age: '', education: '', currentLocation: '', languages: [], yearsExperience: '', skills: [], employmentType: '', workLocations: [], availableFrom: '', expectedSalary: '', salaryUnit: '', salaryNegotiable: false, summary: '', qualifications: '', workExperiences: [], hasPhoto: false, updatedAt: '2026-10-26T00:00:00Z' };
const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{CandidateCollection}from'./components/candidate-collection';import{CandidateDetail}from'./components/candidate-detail';import{CandidateButtons,CandidateSelectionBar,useCandidateSelections}from'./components/candidate-common';import{t}from'./lib/i18n';
const candidate=${JSON.stringify(candidate)};const params=new URLSearchParams(location.search);const locale=params.get('locale')||'zh-Hant';
function Card(){const selection=useCandidateSelections();return <><span id="ready">{String(selection.ready)}</span><p role="status">{t(locale,selection.message)}</p><CandidateButtons candidate={candidate} selection={selection}/><CandidateSelectionBar selection={selection}/></>};const surface=params.get('surface');createRoot(document.getElementById('app')).render(surface==='compare'?<CandidateCollection mode="compare"/>:surface==='saved'?<CandidateCollection mode="saved"/>:surface==='detail'?<CandidateDetail id={candidate.id}/>:<Card/>);`, loader: 'tsx', resolveDir: root }, bundle: true, write: false, jsx: 'automatic', format: 'iife', define: { 'process.env.NODE_ENV': '"development"' }, tsconfig: path.join(root, 'tsconfig.json'), plugins: [{ name: 'local-context', setup(builder) {
  builder.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }));
  builder.onResolve({ filter: /^\.\/locale-provider$/ }, () => ({ path: 'locale', namespace: 'fixture' }));
  builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: "const locale=new URLSearchParams(location.search).get('locale')||'zh-Hant';export const useLocale=()=>({locale});", loader: 'js' }));
} }], logLevel: 'silent' });
const checks = [], errors = [], unexpected = [], sockets = new Set();
let missing = false;
const check = (ok, label) => { assert(ok, label); checks.push(label); };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method !== 'GET') { unexpected.push(req.method + ' ' + req.url); res.writeHead(405); res.end(); return; }
  if (url.pathname === '/component.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(bundle.outputFiles[0].contents); return; }
  if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (url.pathname === '/api/candidates') { const rows = missing ? [] : (url.searchParams.get('ids') || '').split(',').filter(id => ids.includes(id)).map(id => ({ ...candidate, id })); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ candidates: rows, total: rows.length, page: 1, pageSize: 30 })); return; }
  if (url.pathname.startsWith('/api/candidates/')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}'); return; }
  res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); res.end('<!doctype html><meta charset="utf-8"><div id="app"></div><script src="/component.js"></script>');
});
server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
const scenarios = ['add-saved', 'add-compare', 'remove-saved', 'remove-compare', 'clear', 'collection-remove', 'missing-saved', 'missing-compare', 'detail-both', 'detail-first', 'detail-second', 'url-limit'];
let browser, failure;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: option('chromium'), headless: true });
  for (const locale of ['zh-Hant', 'en']) for (const fault of (baseline ? ['quota'] : ['quota', 'security', 'none'])) for (const scenario of scenarios) {
    const width = locale === 'en' ? 1280 : 360;
    const context = await browser.newContext({ viewport: { width, height: 850 }, reducedMotion: 'reduce' });
    const seed = { saved: scenario.startsWith('add') ? [] : [ids[0]], compared: scenario.startsWith('add') || scenario === 'url-limit' ? [] : [ids[0]] };
    await context.addInitScript(({ seed, fault, scenario }) => {
      const native = Storage.prototype.setItem;
      if (!localStorage.getItem('synthetic-selection-seeded')) { native.call(localStorage, 'jiahe.saved-candidates.v1', JSON.stringify(seed.saved)); native.call(localStorage, 'jiahe.compare-candidates.v1', JSON.stringify(seed.compared)); native.call(localStorage, 'synthetic-selection-seeded', 'true'); }
      window.selectionFault = scenario === 'url-limit' ? fault : 'none'; window.writeAttempts = [];
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('jiahe.') && key.endsWith('-candidates.v1')) {
          window.writeAttempts.push({ key, value });
          const matches = scenario === 'detail-first' ? key.includes('saved') : scenario === 'detail-second' ? key.includes('compare') : true;
          if (matches && window.selectionFault !== 'none') throw new DOMException('Synthetic local storage fault', window.selectionFault === 'security' ? 'SecurityError' : 'QuotaExceededError');
        }
        return native.call(this, key, value);
      };
    }, { seed, fault, scenario });
    await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : (unexpected.push(route.request().url()), route.abort()));
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    missing = scenario.startsWith('missing');
    const surface = scenario.startsWith('detail') ? 'detail' : scenario === 'missing-saved' ? 'saved' : scenario.startsWith('missing') || scenario === 'collection-remove' || scenario === 'url-limit' ? 'compare' : 'card';
    const url = `${origin}/?surface=${surface}&locale=${locale}${scenario === 'url-limit' ? '&ids=' + ids.slice(0, 4).join(',') : ''}`;
    await page.goto(url);
    if (surface === 'card') await page.locator('#ready').filter({ hasText: 'true' }).waitFor();
    else await page.waitForFunction(() => !/正在載入|Loading/.test(document.querySelector('[role=status]')?.textContent || ''));
    const action = async () => {
      if (scenario === 'url-limit') return;
      if (scenario === 'clear') await page.locator('.candidate-clear').click();
      else if (scenario.startsWith('detail')) await page.locator('.candidate-empty button').click();
      else if (scenario.startsWith('missing')) await page.locator('.candidate-unavailable-notice button').click();
      else if (scenario === 'collection-remove') await page.locator('.candidate-compare-actions button').first().click();
      else await page.locator('.candidate-action').nth(scenario.endsWith('saved') ? 0 : 1).click();
    };
    if (scenario !== 'url-limit') await page.evaluate(fault => { window.selectionFault = fault; }, fault);
    await action();
    await page.waitForFunction(() => window.writeAttempts.length > 0 && !/正在載入|Loading/.test(document.querySelector('[role=status]')?.textContent || ''));
    const warning = locale === 'en' ? 'This browser could not save your selection.' : '此瀏覽器未能保存選擇';
    const status = await page.getByRole('status').textContent();
    const disk = await page.evaluate(() => ({ saved: JSON.parse(localStorage.getItem('jiahe.saved-candidates.v1')), compared: JSON.parse(localStorage.getItem('jiahe.compare-candidates.v1')), attempts: window.writeAttempts }));
    const label = `${locale}/${fault}/${scenario}`;
    if (baseline) check(!status.includes(warning), `${label}: baseline overwrites the storage failure with a success/limit message`);
    else check(fault === 'none' ? !status.includes(warning) : status.includes(warning), `${label}: visible result matches persistence outcome`);
    if (fault !== 'none') {
      if (scenario !== 'detail-second') check(JSON.stringify(disk.saved) === JSON.stringify(seed.saved), `${label}: failed saved write leaves disk unchanged`);
      if (scenario !== 'detail-first') check(JSON.stringify(disk.compared) === JSON.stringify(seed.compared), `${label}: failed comparison write leaves disk unchanged`);
      if (!baseline && scenario.startsWith('add')) {
        check(await page.locator('.candidate-action').nth(scenario.endsWith('saved') ? 0 : 1).getAttribute('aria-pressed') === 'true', `${label}: failed save still retains this page's selection`);
        await page.reload(); await page.locator('#ready').filter({ hasText: 'true' }).waitFor();
        check(await page.locator('.candidate-action').nth(scenario.endsWith('saved') ? 0 : 1).getAttribute('aria-pressed') === 'false', `${label}: reload truthfully restores persisted state`);
        await page.evaluate(() => { window.selectionFault = 'none'; }); await action();
        check(!(await page.getByRole('status').textContent()).includes(warning), `${label}: explicit later action recovers after storage works`);
      }
    } else {
      const expected = scenario.startsWith('add') ? [ids[0]] : [];
      const actual = scenario.endsWith('saved') ? disk.saved : disk.compared;
      check(scenario === 'url-limit' ? disk.compared.length === 3 : JSON.stringify(actual) === JSON.stringify(expected), `${label}: normal action persists intended selection`);
    }
    await context.close();
  }
  check(unexpected.length === 0 && errors.length === 0, 'No production/external requests, writes to APIs, or browser exceptions');
} catch (error) { failure = error; }
finally {
  await browser?.close(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve));
  await mkdir(output, { recursive: true }); const report = { passed: !failure, expectedBaselineBug: baseline, checks: checks.length, labels: checks, errors, unexpected, failure: failure?.stack, syntheticOnly: true, productionRequests: 0, cssFixture: true, locales: ['zh-Hant', 'en'], widths: [360, 1280], physicalPhone: false };
  await writeFile(path.join(output, 'browser.json'), JSON.stringify(report, null, 2)+'\n'); console.log(JSON.stringify(report));
}
if (failure) process.exitCode = 1;
