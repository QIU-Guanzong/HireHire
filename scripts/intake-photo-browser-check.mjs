// Actual React form + browser image decoding/fetch. Synthetic pixels and loopback only.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const option = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(option('source') || fileURLToPath(new URL('..', import.meta.url)));
const { build } = await import(option('esbuild') || 'esbuild');
const { chromium } = await import(option('playwright') || 'playwright');
const output = path.resolve(option('output') || path.join(root, 'work/photo-upload-recovery'));
const baseline = process.argv.includes('--expect-bug'); await mkdir(output, { recursive: true });
const component = path.join(root, 'components/intake-form.tsx');
const built = await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import IntakeForm from ${JSON.stringify(component)};let app;window.mount=()=>{app=createRoot(document.getElementById('app'));flushSync(()=>app.render(<IntakeForm kind="jobseeker"/>));};window.unmount=()=>flushSync(()=>app.unmount());window.mount();`, loader: 'tsx', resolveDir: root }, bundle: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, nodePaths: [path.join(root, 'node_modules')], plugins: [{ name: 'isolated-locale', setup(builder) { builder.onResolve({ filter: /^\.\/locale-provider$/ }, () => ({ path: 'locale', namespace: 'fixture' })); builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const useLocale=()=>({locale:new URLSearchParams(location.search).get('lang')||'zh-Hant'});`, loader: 'js' })); } }], tsconfig: path.join(root, 'tsconfig.json'), logLevel: 'silent' });
const oldPhoto = { id: '11111111-1111-4111-8111-111111111111', token: '22222222-2222-4222-8222-222222222222' };
const newPhoto = { id: '33333333-3333-4333-8333-333333333333', token: '44444444-4444-4444-8444-444444444444' };
const checks = [], errors = [], unexpected = [], sockets = new Set(); let state, browser, failure;
const check = (v, label) => { assert(v, label); checks.push(label); };
const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/intake-photo') {
    const chunks = []; let size = 0;
    for await (const b of req) { size += b.length; if (size > 2 * 1024 * 1024) { res.writeHead(413); res.end(); return; } chunks.push(b); }
    const bytes = Buffer.concat(chunks); state.uploads.push({ size, jpeg: bytes[0] === 255 && bytes[1] === 216 });
    if (state.uploads.length === 1 && ['headers', 'body', 'body400', 'cancel', 'restart', 'restore'].includes(state.mode)) {
      state.held = res;
      if (state.mode !== 'headers') { res.writeHead(state.mode === 'body400' ? 400 : 201, { 'Content-Type': 'application/json' }); res.write('{"id":'); }
      return;
    }
    if (state.uploads.length === 1 && state.mode === 'invalid') { res.writeHead(201, { 'Content-Type': 'application/json' }); res.end('{"id":{},"token":["bad"]}'); return; }
    if (state.uploads.length === 1 && state.mode === 'reject') { res.writeHead(413, { 'Content-Type': 'application/json' }); res.end('{"error":"照片不可大於2MB。"}'); return; }
    res.writeHead(201, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(newPhoto)); return;
  }
  if (req.method === 'POST' && req.url === '/api/intake') { state.intakes++; res.writeHead(503); res.end('{}'); return; }
  if (req.method !== 'GET') { unexpected.push(req.method); res.writeHead(405); res.end(); return; }
  if (req.url === '/component.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(built.outputFiles[0].contents); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end('<!doctype html><html><meta charset="utf-8"><title>Photo upload synthetic fixture</title><div id="app"></div><script src="/component.js"></script></html>');
});
server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = `http://127.0.0.1:${server.address().port}`;
const poll = async f => { for (let i = 0; i < 100; i++) { if (await f()) return; await new Promise(r => setTimeout(r, 30)); } throw new Error('Bounded condition not reached'); };
const draftKey = 'jiahe.intake.jobseeker.v1', attemptKey = 'jiahe.attempt.jobseeker.v1';
try {
  browser = await chromium.launch({ executablePath: option('chromium'), headless: true, chromiumSandbox: true });
  for (const mode of baseline ? ['headers', 'body'] : process.argv.includes('--draft-switch-only') ? ['restart', 'restore'] : ['headers', 'body', 'body400', 'decode', 'encode', 'cancel', 'invalid', 'reject', 'success', 'restart', 'restore']) for (const lang of ['zh-Hant', 'en']) {
    state = { mode, uploads: [], intakes: 0 };
    const label = text => `${mode}/${lang}: ${text}`;
    const context = await browser.newContext({ viewport: { width: lang === 'en' ? 1440 : 360, height: 900 }, reducedMotion: 'reduce' });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : (unexpected.push('external'), route.abort()));
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/?lang=' + lang);
    await page.evaluate(({ draftKey, attemptKey, oldPhoto }) => {
      window.unmount();
      localStorage.setItem(draftKey, JSON.stringify({ data: { fullName: '合成照片 原文 ONLY', phone: '+852 00000005' }, step: 0, savedAt: new Date().toISOString(), photo: oldPhoto, attempt: { key: 'synthetic-existing-attempt-key', fingerprint: 'existing-fingerprint' } }));
      sessionStorage.setItem(attemptKey, JSON.stringify({ key: 'synthetic-existing-attempt-key', fingerprint: 'existing-fingerprint' })); window.mount();
    }, { draftKey, attemptKey, oldPhoto });
    const switching = ['restart', 'restore'].includes(mode);
    if (!switching) await page.locator('.draft-actions .primary').click();
    const initial = await page.evaluate(key => sessionStorage.getItem(key), attemptKey);
    const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = c.height = 16; c.getContext('2d').fillRect(0, 0, 16, 16); return c.toDataURL('image/png').split(',')[1]; });
    const file = { name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') };
    const processing = ['decode', 'encode'].includes(mode);
    await page.evaluate(mode => {
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      window.photoUrls = { created: [], revoked: [] };
      URL.createObjectURL = value => { const u = create(value); window.photoUrls.created.push(u); return u; };
      URL.revokeObjectURL = value => { window.photoUrls.revoked.push(value); return revoke(value); };
      if (mode === 'decode') { const original = HTMLImageElement.prototype.decode; let first = true; HTMLImageElement.prototype.decode = function () { if (first) { first = false; return new Promise(() => {}); } return original.call(this); }; }
      if (mode === 'encode') { const original = HTMLCanvasElement.prototype.toBlob; let first = true; HTMLCanvasElement.prototype.toBlob = function (...args) { if (first) { first = false; return; } return original.apply(this, args); }; }
    }, mode);
    await page.clock.install();
    await poll(async () => await page.locator('#field-photo').isEnabled());
    await page.locator('#field-photo').setInputFiles(file);
    try { await poll(async () => processing ? await page.locator('#field-photo').isDisabled() : state.uploads.length === 1); } catch (error) { throw new Error(error.message + '; photo UI: ' + (await page.locator('.intake-photo').innerText())); }
    if (!processing) check(state.uploads[0].jpeg, label('Browser decodes synthetic PNG and sends resized JPEG'));
    if (processing || ['headers','body','body400'].includes(mode)) { await page.locator('#field-photo').setInputFiles(file); check(state.uploads.length === (processing ? 0 : 1), label('Queued file change cannot start a concurrent upload')); }
    // Repeated submit while uploading must not create a registration.
    await page.locator('form').evaluate(el => { for (let i = 0; i < 3; i++) el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    if (switching) {
      await page.locator('.draft-actions .' + (mode === 'restart' ? 'secondary' : 'primary')).click();
      if (process.argv.includes('--expect-draft-switch-bug')) {
        state.held.end(JSON.stringify(newPhoto.id) + ',"token":' + JSON.stringify(newPhoto.token) + '}');
        await page.locator('.photo-selected img').waitFor();
        check(await page.locator('.photo-selected img').count() === 1, label('BUG: discarded in-flight upload attaches after draft switch'));
        check(await page.locator('#field-fullName').inputValue() === (mode === 'restore' ? '合成照片 原文 ONLY' : ''), label('BUG occurs after the chosen draft state is already applied'));
        await context.close(); continue;
      }
      await poll(() => state.held.destroyed);
      await poll(async () => await page.locator('#field-photo').isEnabled());
      check(await page.locator('.photo-selected img').count() === 0, label('Discarded in-flight upload cannot attach after draft switch'));
      check(await page.locator('#field-fullName').inputValue() === (mode === 'restore' ? '合成照片 原文 ONLY' : ''), label('Chosen draft action determines form data'));
      const stored = await page.evaluate(({draftKey,attemptKey}) => ({ draft:JSON.parse(localStorage.getItem(draftKey)), attempt:JSON.parse(sessionStorage.getItem(attemptKey)) }),{draftKey,attemptKey});
      if (mode === 'restore') check(stored.draft.photo.id === oldPhoto.id && stored.attempt.key === 'synthetic-existing-attempt-key', label('Restore keeps original draft photo and attempt'));
      else check(stored.draft === null && stored.attempt?.key === 'synthetic-existing-attempt-key', label('Restart clears owned draft and preserves existing session-key policy'));
      check(state.uploads.length === 1 && state.intakes === 0, label('Draft switch does not retry or register'));
      await context.close(); continue;
    }
    if (mode === 'cancel') {
      await page.evaluate(() => { window.unmount(); window.mount(); });
      await poll(() => state.held.destroyed);
      await page.locator('.draft-actions .primary').click();
      await poll(async () => await page.locator('#field-photo').isEnabled());
      check(await page.locator('#field-photo').isEnabled(), label('Unmount cancellation does not lock a new form'));
    } else if (['headers', 'body', 'body400', 'decode', 'encode'].includes(mode)) await page.clock.fastForward(31000);
    if (baseline) {
      check(await page.locator('#field-photo').isDisabled(), label('BUG: photo picker remains disabled after 31 seconds'));
      check(await page.locator('.form-actions button[type=submit]').isDisabled(), label('BUG: next/submit remains disabled after 31 seconds'));
    } else {
      await poll(async () => await page.locator('#field-photo').isEnabled());
      if (mode !== 'success') {
        if (mode !== 'cancel') {
          const error = await page.locator('.intake-photo [role=alert]').innerText();
          check(Boolean(error), label('Upload failure or uncertainty visible'));
          if (['headers', 'body', 'body400', 'decode', 'encode'].includes(mode)) check(error.includes(processing ? lang === 'en' ? 'timed out' : '逾時' : lang === 'en' ? 'could not be confirmed' : '未能確認'), label('Timeout distinguishes local processing from an unconfirmed upload'));
        }
        const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).photo, draftKey);
        check(JSON.stringify(stored) === JSON.stringify(oldPhoto), label('Previous photo claim preserved on failure/cancellation'));
        check(await page.evaluate(key => sessionStorage.getItem(key), attemptKey) === initial, label('Registration attempt identity unchanged'));
        check(state.uploads.length === (processing ? 0 : 1), label('No automatic upload retry'));
        check(await page.evaluate(() => window.photoUrls.created.every(u => window.photoUrls.revoked.includes(u))), label('Temporary source object URLs released after failed/cancelled processing'));
        await page.locator('#field-photo').setInputFiles(file);
      }
      await poll(async () => await page.locator('#field-photo').isEnabled() && await page.locator('.photo-selected img').count() === 1);
      await poll(async () => await page.evaluate(({ key, id }) => JSON.parse(localStorage.getItem(key)).photo.id === id, { key: draftKey, id: newPhoto.id }));
      check(await page.evaluate(({ key, photo }) => JSON.stringify(JSON.parse(localStorage.getItem(key)).photo) === JSON.stringify(photo), { key: draftKey, photo: newPhoto }), label('Only confirmed replacement claim enters saved draft'));
      check(await page.evaluate(key => sessionStorage.getItem(key), attemptKey) === initial, label('Photo retry never resets registration key'));
      check(await page.locator('#field-fullName').inputValue() === '合成照片 原文 ONLY', label('Original text retained'));
      await page.clock.fastForward(31000);
      check(await page.locator('.photo-selected img').count() === 1 && await page.locator('.intake-photo [role=alert]').count() === 0, label('Completed upload stays completed after deadline'));
    }
    check(state.intakes === 0, label('No registration request sent'));
    check(state.uploads.length === (baseline || mode === 'success' || processing ? 1 : 2), label('Exactly the explicit number of upload requests'));
    state.held?.destroy(); await context.close();
  }
  check(errors.length === 0, 'No uncaught browser errors'); check(unexpected.length === 0, 'Only loopback traffic');
} catch (error) { failure = error; }
finally { await browser?.close(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); }
const report = { passed: !failure, baseline, draftSwitchBugReproduced: process.argv.includes('--expect-draft-switch-bug') && !failure, checks: checks.length, assertions: checks, sourceSha256: createHash('sha256').update(await readFile(component)).digest('hex'), syntheticOnly: true, scope: 'actual React form in Chrome; isolated locale; no Next full-app or backend acceptance', serverClosed: !server.listening, errors, failure: failure?.message };
await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ ...report, assertions: undefined })); if (failure) process.exitCode = 1;
