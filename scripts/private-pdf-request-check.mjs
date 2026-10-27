// No sockets, accounts, or actual records: test deadlines at every await.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), ts = require('typescript');
const compiled = ts.transpileModule(await readFile('lib/private-pdf-request.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const checks = [], check = (ok, label) => { assert(ok, label); checks.push(label); };
const flush = () => new Promise(resolve => setImmediate(resolve));
const outcome = promise => promise.then(value => ({ value }), error => ({ error }));
const valid = () => new Response('%PDF-1.4\n%%EOF', { headers: { 'content-type': 'application/pdf; charset=binary' } });
function fixture(fetcher) {
  const timers = new Map(), calls = []; let id = 0;
  const context = { exports: {}, AbortController, Blob, Uint8Array, fetch: (...args) => { calls.push(args); return fetcher(...args); }, setTimeout: (callback, delay) => { timers.set(++id, { callback, delay }); return id; }, clearTimeout: key => timers.delete(key) };
  vm.runInNewContext(compiled, context);
  const caller = new AbortController(); let listeners = 0;
  const add = caller.signal.addEventListener.bind(caller.signal), remove = caller.signal.removeEventListener.bind(caller.signal);
  caller.signal.addEventListener = (...args) => { listeners++; return add(...args); };
  caller.signal.removeEventListener = (...args) => { listeners--; return remove(...args); };
  return { ...context.exports, caller, timers, calls, listeners: () => listeners, expire: () => [...timers.values()].forEach(({ callback }) => callback()) };
}
for (const stage of ['headers', 'body', 'signature', 'error401', 'error403']) {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const status = stage === 'error401' ? 401 : stage === 'error403' ? 403 : 200;
  const f = fixture(async () => stage === 'headers' ? held : { ok: status === 200, status, headers: new Headers({ 'content-type': 'application/pdf' }), json: () => held, blob: async () => stage === 'body' ? held : { size: 10, slice: () => ({ text: () => held }) } });
  const p = outcome(f.privatePdfRequest('/synthetic.pdf', f.caller.signal)); await flush();
  check([...f.timers.values()][0]?.delay === 60000, `${stage}: exact 60s deadline`);
  f.expire(); const result = await p;
  check(result.error instanceof f.PrivatePdfError && result.error.message.includes('逾時'), `${stage}: deadline settles even when operation ignores abort`);
  check(result.error.status === (stage === 'headers' ? 0 : status), `${stage}: known status retained`);
  check(f.calls[0][1].signal.aborted && !f.caller.signal.aborted, `${stage}: only owned transport aborted`);
  check(f.timers.size === 0 && f.listeners() === 0, `${stage}: timer and listener cleaned`);
  release(stage === 'headers' ? valid() : stage === 'body' ? new Blob(['%PDF-']) : '%PDF-'); await flush();
  check(f.calls.length === 1 && !result.value, `${stage}: late work cannot retry or replace failure`);
}
for (const when of ['before', 'headers', 'body']) {
  const f = fixture(async () => when === 'body' ? { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/pdf' }), blob: () => new Promise(() => {}) } : new Promise(() => {}));
  const reason = new Error('Synthetic caller cancellation');
  if (when === 'before') f.caller.abort(reason);
  const p = outcome(f.privatePdfRequest('/synthetic.pdf', f.caller.signal)); await flush(); f.caller.abort(reason);
  check((await p).error === reason, `${when}: caller reason preserved`);
  check(f.timers.size === 0 && f.listeners() === 0 && (when !== 'before' || f.calls.length === 0), `${when}: canceled request releases resources; pre-abort sends nothing`);
}
for (const body of [null, [], 'wrong', { error: ['wrong'] }, { error: 'Synthetic denied' }]) {
  const f = fixture(async () => new Response(JSON.stringify(body), { status: 403 }));
  const result = await outcome(f.privatePdfRequest('/synthetic.pdf', f.caller.signal));
  check(result.error instanceof f.PrivatePdfError && result.error.status === 403, 'Malformed and valid rejection bodies preserve denied status');
  check(f.timers.size === 0 && f.listeners() === 0, 'Rejection clears all resources');
}
for (const [body, type] of [['', 'application/pdf'], ['not-pdf', 'application/pdf'], ['%PDF-', 'text/html']]) {
  const f = fixture(async () => new Response(body, { headers: { 'content-type': type } }));
  check((await outcome(f.privatePdfRequest('/synthetic.pdf', f.caller.signal))).error instanceof f.PrivatePdfError, 'Invalid PDF never succeeds');
}
const f = fixture(async () => valid());
for (let i = 0; i < 2; i++) {
  const result = await f.privatePdfRequest('/synthetic.pdf', f.caller.signal);
  check(await result.blob.text() === '%PDF-1.4\n%%EOF', 'Valid bytes preserved; parent signal reusable');
  check(!f.caller.signal.aborted && f.listeners() === 0 && f.timers.size === 0, 'Success clears resources without parent cancellation');
}
check(f.calls.every(([, init]) => init.cache === 'no-store' && init.credentials === 'same-origin'), 'Private transport options preserved');
const network = fixture(async () => { throw new TypeError('Synthetic network failure'); });
check(Boolean((await outcome(network.privatePdfRequest('/synthetic.pdf', network.caller.signal))).error) && network.timers.size === 0 && network.listeners() === 0, 'Network error releases resources');
const report = { passed: true, checks: checks.length, labels: checks, productionRequests: 0, syntheticOnly: true };
await mkdir('work/private-pdf-lifecycle', { recursive: true }); await writeFile('work/private-pdf-lifecycle/request.json', JSON.stringify(report, null, 2)+'\n'); console.log(JSON.stringify(report));
