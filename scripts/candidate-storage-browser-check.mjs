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
let missing = false, lookupCase = '', lookupCalls = [];
const check = (ok, label) => { assert(ok, label); checks.push(label); };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method !== 'GET') { unexpected.push(req.method + ' ' + req.url); res.writeHead(405); res.end(); return; }
  if (url.pathname === '/component.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(bundle.outputFiles[0].contents); return; }
  if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (url.pathname === '/api/candidates') {
    const selected = (url.searchParams.get('ids') || '').split(',').filter(id => ids.includes(id));
    const page = Number(url.searchParams.get('page') || 1), selection = url.searchParams.get('selection') === '1';
    const legacy = lookupCase.startsWith('legacy');
    const pageSize = legacy || !selection ? 12 : 30;
    let names = selected;
    if (lookupCase) {
      lookupCalls.push({ ids: selected, page, selection });
      if (lookupCalls.length > 1 && lookupCase === 'legacy-move') names = [...names].sort((a,b) => Number(b === ids[12]) - Number(a === ids[12]));
      if (lookupCalls.length > 1 && lookupCase === 'legacy-pause') names = names.filter(id => id !== ids[0]);
      if (lookupCase === 'legacy-failure' && selected.includes(ids[12]) && selected.length === 1) {
        res.writeHead(503, { 'content-type': 'application/json' }); res.end('{}'); return;
      }
    }
    const rows = (missing ? [] : names).map(id => ({ ...candidate, id, displayName: `SYNTHETIC ${ids.indexOf(id) + 1}` }));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ candidates: rows.slice((page-1)*pageSize,page*pageSize), total: rows.length, page, pageSize }));
    return;
  }
  if (url.pathname.startsWith('/api/candidates/')) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}'); return; }
  res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); res.end('<!doctype html><meta charset="utf-8"><div id="app"></div><script src="/component.js"></script>');
});
server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
const scenarios = ['add-saved', 'add-compare', 'remove-saved', 'remove-compare', 'clear', 'collection-remove', 'missing-saved', 'missing-compare', 'detail-both', 'detail-first', 'detail-second', 'url-limit'];
let browser, failure;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: option('chromium'), headless: true });
  for (const locale of ['zh-Hant', 'en']) for (const fault of (baseline ? ['quota'] : ['quota', 'security', 'none'])) for (const scenario of (process.argv.includes('--lookup-only') ? [] : scenarios)) {
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
  if (!baseline) for (const scenario of ['legacy-move','legacy-pause','legacy-failure','stable-30','compare-3','stale-success']) {
    lookupCase = scenario; lookupCalls = []; missing = false;
    const count = scenario === 'stable-30' ? 30 : scenario === 'compare-3' ? 3 : scenario === 'stale-success' ? 1 : 13;
    const seed = scenario === 'stable-30' ? ids.slice(0,count).reverse() : ids.slice(0,count);
    const surface = scenario === 'compare-3' ? 'compare' : 'saved';
    const context = await browser.newContext({ viewport: { width: scenario.startsWith('legacy') ? 360 : 1280, height: 850 }, reducedMotion: 'reduce' });
    await context.addInitScript(({ seed, surface, stale }) => {
      localStorage.setItem(`jiahe.${surface}-candidates.v1`, JSON.stringify(seed));
      if (!stale) return;
      const real = window.fetch.bind(window);
      window.fetch = (url, options) => {
        if (typeof url === 'string' && url.startsWith('/api/candidates?') && !window.oldLookup) {
          // Model a response already resolving as the collection is superseded;
          // this stub deliberately ignores transport cancellation.
          window.oldLookup = true;
          const request = real(url, { ...options, signal: undefined });
          return new Promise((resolve, reject) => { window.releaseOldLookup = () => request.then(resolve, reject); });
        }
        return real(url, options);
      };
    }, { seed, surface, stale: scenario === 'stale-success' });
    await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : (unexpected.push(route.request().url()), route.abort()));
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/?surface=${surface}&locale=en`);
    const cards = page.locator('.candidate-saved-grid h2');
    const unavailable = page.locator('.candidate-unavailable-notice');
    const waitCount = async count => page.waitForFunction(n => document.querySelectorAll('.candidate-saved-grid h2').length === n, count);
    if (scenario === 'stale-success') {
      await page.waitForFunction(() => typeof window.releaseOldLookup === 'function');
      await page.evaluate(next => {
        localStorage.setItem('jiahe.saved-candidates.v1', JSON.stringify([next]));
        window.dispatchEvent(new Event('jiahe:candidate-selection'));
      }, ids[12]);
      await cards.filter({ hasText: /^SYNTHETIC 13$/ }).waitFor();
      await page.evaluate(async () => { await window.releaseOldLookup(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      check(await cards.allTextContents().then(values=>values.join(',')==='SYNTHETIC 13') && await unavailable.count() === 0, 'Late old success cannot replace a newer saved lookup or offer deletion');
    } else if (scenario === 'legacy-failure') {
      await page.getByRole('alert').getByRole('button').waitFor();
      check(await unavailable.count() === 0 && await page.evaluate(() => JSON.parse(localStorage.getItem('jiahe.saved-candidates.v1')).length) === 13, 'Failed legacy group shows retry, not missing candidates or storage changes');
      lookupCase = 'legacy-move'; lookupCalls = []; await page.getByRole('alert').getByRole('button').click();
      await waitCount(13);
      check(await unavailable.count() === 0, 'Retry recovers all saved IDs');
    } else if (scenario === 'compare-3') {
      await page.locator('.candidate-compare-name').last().waitFor();
      check(await page.locator('.candidate-compare-name').count() === 3 && lookupCalls.length === 1, 'Comparison still displays three candidates in one request');
    } else {
      const kept = scenario === 'legacy-pause' ? seed.slice(1) : seed;
      await waitCount(kept.length);
      const expected = kept.map(id => `SYNTHETIC ${ids.indexOf(id) + 1}`);
      assert.deepEqual(await cards.allTextContents(), expected);
      check(lookupCalls.length === (scenario === 'stable-30' ? 1 : 3) && lookupCalls.every(call => call.page === 1), `${scenario}: no offset traversal and saved order is preserved`);
      check(await unavailable.count() === (scenario === 'legacy-pause' ? 1 : 0), `${scenario}: only a confirmed unavailable ID may be offered for removal`);
      if (scenario === 'legacy-pause') {
        await unavailable.getByRole('button').click();
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('jiahe.saved-candidates.v1')));
        assert.deepEqual(saved, kept);
        check(saved.includes(ids[12]), 'Removing the paused candidate preserves the still-published boundary candidate');
      }
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
