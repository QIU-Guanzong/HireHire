// Isolated transport regression: no sockets, real administrators or customer data.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const baseline = process.argv.includes('--expect-bug');
const root = process.cwd();
let source;
try { source = await readFile(path.join(root, 'lib/admin-request.ts'), 'utf8'); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  source = (await readFile(path.join(root, 'components/private-admin-shell.tsx'), 'utf8')).split('export class AdminApiError')[1].split('export function AdminNavigation')[0];
  source = 'export class AdminApiError' + source;
}
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const checks = [];
const check = (value, label) => { assert(value, label); checks.push(label); };
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(fetcher) {
  const timers = new Map(), calls = []; let timerId = 0;
  const context = { exports: {}, AbortController, DOMException, console,
    fetch: (url, init) => { calls.push({ url, init }); return fetcher(url, init); },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
  };
  vm.runInNewContext(compiled, context, { filename: 'admin-request-under-test.js' });
  return { ...context.exports, timers, calls, expire: () => { for (const { callback } of [...timers.values()]) callback(); } };
}
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const outcome = promise => promise.then(value => ({ value }), error => ({ error }));
if (baseline) {
  const invalid = fixture(async () => new Response('{broken', { status: 200 }));
  const result = await invalid.adminRequest('/api/admin/settings', { method: 'PATCH' });
  check(JSON.stringify(result) === '{}', 'Baseline accepts malformed successful write as empty object');
  const hanging = fixture(() => new Promise(() => {})); let settled = false;
  hanging.adminRequest('/api/admin/matches', { method: 'POST' }).finally(() => { settled = true; });
  await flush(); hanging.expire(); await flush();
  check(!settled && hanging.timers.size === 0, 'Baseline hung request has no deadline and never releases caller');
} else {
  const normal = fixture(async () => jsonResponse({ id: 'synthetic', updatedAt: 'v1' }));
  const body = await normal.adminRequest('/api/admin/matches', { method: 'POST', body: 'original-envelope' });
  check(body.id === 'synthetic', 'Valid object response returns unchanged');
  check(normal.calls.length === 1 && normal.calls[0].init.body === 'original-envelope', 'Exactly one request; payload unchanged');
  check(normal.calls[0].init.cache === 'no-store', 'No-store default retained');
  check(!normal.calls[0].init.signal.aborted && normal.timers.size === 0, 'Successful completion clears timer without late abort');
  for (const status of [400, 401, 403, 409, 503]) {
    for (const valid of [true, false]) {
      const f = fixture(async () => valid ? jsonResponse({ error: 'synthetic rejection', fields: { notes: 'synthetic field' } }, status) : new Response('broken', { status }));
      const r = await outcome(f.adminRequest('/api/admin/matches', { method: 'PATCH' }));
      check(r.error instanceof f.AdminApiError && r.error.status === status, `${status} status retained with ${valid ? 'JSON' : 'broken'} error body`);
      if (valid) check(r.error.fields.notes === 'synthetic field', `${status} validation fields retained`);
      check(f.timers.size === 0, `${status} error clears deadline`);
    }
  }
  for (const raw of ['broken', '', 'null', '[]', '"success"', '{}']) {
    const f = fixture(async () => new Response(raw, { status: 200 }));
    const r = await outcome(f.adminRequest('/api/admin/settings', { method: 'PATCH' }));
    check(r.error instanceof f.AdminApiError && r.error.message.includes('未能確認'), `Invalid success ${JSON.stringify(raw)} never claims write success`);
    check(f.calls.length === 1 && f.timers.size === 0, 'Invalid success does not retry and clears deadline');
  }
  for (const stage of ['headers', 'body']) {
    for (const method of ['GET', 'PATCH']) {
      const f = fixture(async () => stage === 'headers' ? new Promise(() => {}) : { ok: true, status: 200, json: () => new Promise(() => {}) });
      const p = outcome(f.adminRequest('/api/admin/settings', { method })); await flush();
      check([...f.timers.values()][0]?.delay === 20000, `${stage}/${method} has bounded 20s deadline`);
      f.expire(); const r = await p;
      check(r.error instanceof f.AdminApiError && r.error.message.includes(method === 'GET' ? '逾時' : '未能確認'), `${stage}/${method} distinguishes read timeout from unknown write result`);
      check(f.calls[0].init.signal.aborted && f.timers.size === 0, `${stage}/${method} aborts own transport and clears deadline`);
    }
  }
  for (const status of [401, 403, 409]) {
    const f = fixture(async () => ({ ok: false, status, json: () => new Promise(() => {}) }));
    const p = outcome(f.adminRequest('/api/admin/settings', { method: 'PATCH' })); await flush(); f.expire();
    const r = await p;
    check(r.error.status === status, `Known ${status} survives hung error body`);
  }
  for (const stage of ['before', 'headers', 'body']) {
    const caller = new AbortController();
    const f = fixture(async () => stage === 'body' ? { ok: true, status: 200, json: () => new Promise(() => {}) } : new Promise(() => {}));
    if (stage === 'before') caller.abort();
    const p = outcome(f.adminRequest('/api/admin/settings', { signal: caller.signal }));
    await flush(); caller.abort(); const r = await p;
    check(r.error.name === 'AbortError', `Caller cancellation preserved at ${stage}`);
    check(f.timers.size === 0 && (stage !== 'before' || f.calls.length === 0), `Cancellation ${stage} cleans up; pre-abort never sends`);
  }
  let release, parsed = false;
  const late = fixture(() => new Promise(resolve => { release = resolve; }));
  const pending = outcome(late.adminRequest('/api/admin/settings', { method: 'PATCH' }));
  await flush(); late.expire(); const timedOut = await pending;
  release({ ok: true, status: 200, json: async () => { parsed = true; return { ok: true }; } }); await flush();
  check(Boolean(timedOut.error) && !parsed && late.calls.length === 1, 'Late ignored-abort response cannot become success or parse body');
  const failure = fixture(async () => { throw new TypeError('synthetic network failure'); });
  const failed = await outcome(failure.adminRequest('/api/admin/settings', { method: 'PATCH' }));
  check(failed.error.message.includes('未能確認') && failure.timers.size === 0, 'Network write failure preserves uncertainty and releases timer');
}
const report = { status: 'passed', mode: baseline ? 'baseline-bugs-reproduced' : 'fixed-regression', checks: checks.length, labels: checks, productionRequests: 0, realRecords: 0 };
await mkdir('work/admin-response-recovery', { recursive: true });
await writeFile(`work/admin-response-recovery/request-${baseline ? 'before' : 'after'}.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
