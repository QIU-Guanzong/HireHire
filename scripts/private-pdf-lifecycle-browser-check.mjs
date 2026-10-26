// Synthetic loopback only: exercise the actual preview hook, with real React.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = path.resolve(option('source') || process.cwd());
const output = path.resolve(option('output') || path.join(root, 'work/private-pdf-lifecycle'));
const baseline = process.argv.includes('--expect-timeout-bug');
const { build } = await import(option('esbuild') || 'esbuild');
const { chromium } = await import(option('playwright') || 'playwright');
const bundle = await build({ stdin: { contents: `
import React,{StrictMode,useState} from 'react'; import {createRoot} from 'react-dom/client';
import {usePrivatePdfPreview} from ${JSON.stringify(path.join(root, 'components/private-pdf-preview.tsx'))};
function Preview({scope}) { const pdf=usePrivatePdfPreview(scope);const request={url:'/api/admin/export?mode=client',mode:'client',targets:['Synthetic record'],scopeLabel:'Synthetic '+scope,fallbackFilename:'synthetic.pdf'};
window.testOpen=()=>pdf.open(request,document.getElementById('open'));window.testClose=pdf.close;
return <><button id="open" onClick={e=>void pdf.open(request,e.currentTarget)}>Preview</button><output id="busy">{String(pdf.busy)}</output>{pdf.dialog}</>; }
function App(){const[scope,setScope]=useState('A'),[mounted,setMounted]=useState(true);window.testScope=()=>setScope(s=>s==='A'?'B':'A');window.testUnmount=()=>setMounted(false);return mounted?<Preview scope={scope}/>:<p>Unmounted</p>;}
createRoot(document.getElementById('app')).render(<StrictMode><App/></StrictMode>);`, loader: 'tsx', resolveDir: root }, bundle: true, write: false, jsx: 'automatic', format: 'iife', define: { 'process.env.NODE_ENV': '"development"' }, tsconfig: path.join(root, 'tsconfig.json'), plugins: [{ name: 'css-fixture', setup(builder) { builder.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' })); } }], logLevel: 'silent' });
const sockets = new Set(), checks = [], unexpected = [], errors = [];
let requests = [], mode = 'valid';
const check = (ok, label) => { assert(ok, label); checks.push(label); };
const server = http.createServer((req, res) => {
  if (req.url === '/component.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(bundle.outputFiles[0].contents); return; }
  if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' }); res.end('<!doctype html><meta charset="utf-8"><div id="app"></div><script src="/component.js"></script>'); return; }
  if (req.method !== 'GET' || req.url !== '/api/admin/export?mode=client') { unexpected.push(req.method+' '+req.url); res.writeHead(404); res.end(); return; }
  requests.push(mode);
  if (mode === 'headers') return;
  if (mode === 'forbidden' || mode === 'forbidden-body') { res.writeHead(403, { 'content-type': 'application/json' }); res.write('{"error":'); if (mode === 'forbidden') res.end('"Synthetic forbidden"}'); return; }
  res.writeHead(200, { 'content-type': mode === 'wrong-type' ? 'text/html' : 'application/pdf', 'content-disposition': 'attachment; filename="synthetic.pdf"', 'x-export-records': '1' });
  if (mode === 'body') { res.write('%PDF-'); return; }
  res.end(mode === 'wrong-signature' ? 'broken' : '%PDF-1.4\n% synthetic fixture only\n%%EOF');
});
server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
let browser, failure;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: option('chromium'), headless: true });
  for (const scenario of (baseline ? ['headers', 'body'] : ['headers', 'body', 'forbidden', 'forbidden-body', 'wrong-type', 'wrong-signature', 'late', 'close', 'scope', 'valid', 'unmount'])) {
    mode = ['late', 'close', 'scope'].includes(scenario) ? 'valid' : scenario === 'unmount' ? 'valid' : scenario;
    requests = [];
    const context = await browser.newContext({ viewport: { width: 360, height: 800 }, reducedMotion: 'reduce', acceptDownloads: true });
    await context.addInitScript(() => {
      const timeout = window.setTimeout;
      window.setTimeout = (handler, delay, ...args) => timeout(handler, delay === 60000 ? 180 : delay, ...args);
      window.createdUrls = []; window.revokedUrls = [];
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = blob => { const url = create(blob); window.createdUrls.push(url); return url; };
      URL.revokeObjectURL = url => { window.revokedUrls.push(url); revoke(url); };
    });
    await context.route('**/*', route => {
      const url = route.request().url();
      // Chrome's built-in PDF viewer loads local browser resources, not a
      // network service. Keep every non-loopback HTTP(S) request denied.
      if (url.startsWith(origin+'/') || url.startsWith('blob:') || url.startsWith('chrome://resources/') || url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/')) return route.continue();
      unexpected.push(url); return route.abort();
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin); await page.locator('#open').waitFor();
    if (['late', 'close', 'scope'].includes(scenario)) await page.evaluate(() => {
      window.fetch = async () => new Promise(resolve => { window.releasePdf = () => resolve(new Response('%PDF-1.4\n%%EOF', { headers: { 'content-type': 'application/pdf' } })); });
    });
    await page.locator('#open').click();
    if (baseline) {
      await page.waitForTimeout(450);
      check(await page.locator('#busy').textContent() === 'true' && await page.getByRole('alert').count() === 0, `${scenario}: baseline remains busy beyond accelerated deadline`);
      await context.close(); continue;
    }
    if (scenario === 'close' || scenario === 'scope') {
      await page.evaluate(s => s === 'close' ? window.testClose() : window.testScope(), scenario);
      await page.evaluate(() => window.releasePdf());
      await page.waitForTimeout(250);
      check(await page.getByRole('dialog').count() === 0 && await page.locator('#busy').textContent() === 'false', `${scenario}: late response cannot reopen preview`);
      check(await page.evaluate(() => window.createdUrls.length === 0), `${scenario}: no private blob URL from canceled response`);
    } else if (scenario === 'valid' || scenario === 'unmount') {
      await page.getByText('PDF已產生，核對版本、對象及內容後再下載。', { exact: true }).waitFor();
      const download = page.getByRole('button', { name: '下載已核對PDF', exact: true });
      check(await download.isDisabled(), `${scenario}: download requires acknowledgement`);
      await page.getByLabel('已核對版本及對象').check();
      const event = page.waitForEvent('download'); await download.click(); await event;
      check(await download.isDisabled(), `${scenario}: duplicate download locked`);
      await page.evaluate(() => window.testUnmount());
      await page.getByText('Unmounted', { exact: true }).waitFor();
      check(await page.evaluate(() => window.createdUrls.length === 2 && window.createdUrls.every(url => window.revokedUrls.includes(url))), `${scenario}: unmount revokes preview and download URLs`);
      check(await page.evaluate(() => document.body.style.overflow === ''), `${scenario}: unmount restores scroll`);
    } else {
      await page.getByRole('alert').waitFor({ timeout: 3000 });
      check(await page.locator('#busy').textContent() === 'false', `${scenario}: failure releases busy state`);
      if (scenario.startsWith('forbidden')) {
        check(await page.getByRole('button', { name: '重試產生PDF' }).count() === 0, `${scenario}: denied response never offers retry`);
      } else {
        if (scenario === 'late') { await page.evaluate(() => window.releasePdf()); await page.waitForTimeout(100); check(await page.evaluate(() => window.createdUrls.length === 0), 'late: expired result cannot produce blob URL'); }
        check(scenario === 'late' || requests.length === 1, `${scenario}: no automatic repeat`);
        mode = 'valid'; if (scenario === 'late') await page.reload();
        if (scenario !== 'late') await page.getByRole('button', { name: '重試產生PDF' }).click(); else await page.locator('#open').click();
        await page.getByText('PDF已產生，核對版本、對象及內容後再下載。', { exact: true }).waitFor();
        check(true, `${scenario}: explicit retry can recover`);
      }
    }
    await context.close();
  }
  check(unexpected.length === 0 && errors.length === 0, 'No external requests or browser exceptions');
} catch (error) { failure = error; }
finally {
  await browser?.close(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve));
  await mkdir(output, { recursive: true });
  const report = { passed: !failure, expectedBaselineBug: baseline, checks: checks.length, labels: checks, unexpected, errors, failure: failure?.stack, syntheticOnly: true, productionRequests: 0, cssFixture: true, physicalPhone: false };
  await writeFile(path.join(output, 'browser.json'), JSON.stringify(report, null, 2)+'\n'); console.log(JSON.stringify(report));
}
if (failure) process.exitCode = 1;
