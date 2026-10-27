// Deterministic virtual time, real ReadableStreams, and the actual helper.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
const ts = createRequire(import.meta.url)('typescript');
const compiled = ts.transpileModule(await readFile('lib/private-pdf-request.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const baseline = process.argv.includes('--expect-absolute-deadline');
const checks = [], check = (ok, label) => { assert(ok, label); checks.push(label); };
const flush = () => new Promise(resolve => setImmediate(resolve));
const outcome = promise => promise.then(value => ({ value }), error => ({ error }));
function fixture({ status = 200, holdHeaders = false, fallback = false } = {}) {
  let clock = 0, id = 0, stream, resolveHeaders, canceled = 0, listeners = 0;
  const timers = new Map(), calls = [];
  const body = new ReadableStream({ start(controller) { stream = controller; }, cancel() { canceled++; } });
  const response = new Response(body, { status, headers: { 'content-type': status === 200 ? 'application/pdf' : 'application/json' } });
  const headers = new Promise(resolve => { resolveHeaders = resolve; });
  const context = { exports: {}, AbortController, Blob, Uint8Array,
    fetch: (...args) => { calls.push(args); return holdHeaders ? headers : Promise.resolve(fallback ? { ok: true, status: 200, headers: response.headers, blob: () => headers } : response); },
    setTimeout: (callback, delay) => { const key = ++id; timers.set(key, { callback, at: clock + delay }); return key; }, clearTimeout: key => timers.delete(key),
  };
  vm.runInNewContext(compiled, context);
  const caller = new AbortController(), add = caller.signal.addEventListener.bind(caller.signal), remove = caller.signal.removeEventListener.bind(caller.signal);
  caller.signal.addEventListener = (...args) => { listeners++; return add(...args); }; caller.signal.removeEventListener = (...args) => { listeners--; return remove(...args); };
  return { ...context.exports, caller, calls, timers, response, listeners: () => listeners, canceled: () => canceled,
    emit: text => stream.enqueue(new TextEncoder().encode(text)), emitBytes: bytes => stream.enqueue(bytes), end: () => stream.close(), resolveHeaders: value => resolveHeaders(value ?? response),
    advance: async ms => { clock += ms; for (const [key, timer] of [...timers]) if (timer.at <= clock) { timers.delete(key); timer.callback(); } await flush(); },
  };
}
const f = fixture(); let settled = false;
const pending = outcome(f.privatePdfRequest('/synthetic.pdf', f.caller.signal)).then(result => { settled = true; return result; }); await flush();
f.emit('%PDF-'); await flush();
for (let i = 0; i < 3; i++) { await f.advance(20000); if (!settled) { f.emit('continuous progress\n'); await flush(); } }
if (baseline) {
  const result = await pending;
  check(result.error instanceof f.PrivatePdfError && settled, 'Frozen absolute deadline rejects a stream still making progress at 60s');
} else {
  check(!settled && !f.caller.signal.aborted, 'Continuous nonempty chunks pass the former 60s total cutoff');
  await f.advance(20000); f.emit('%%EOF'); f.end(); await flush();
  const result = await pending;
  check(result.value && (await result.value.blob.text()).endsWith('%%EOF'), '80s progressing stream succeeds without byte changes');
  check(f.timers.size === 0 && f.listeners() === 0 && !f.response.body.locked, 'Successful stream releases timer, caller listener and reader lock');
  for (const scenario of ['headers', 'mid-body', 'empty-chunks', 'error-json', 'fallback']) {
    const g = fixture({ holdHeaders: scenario === 'headers', status: scenario === 'error-json' ? 403 : 200, fallback: scenario === 'fallback' });
    const p = outcome(g.privatePdfRequest('/synthetic.pdf', g.caller.signal)); await flush();
    if (scenario === 'mid-body' || scenario === 'error-json') { await g.advance(40000); g.emit(scenario === 'mid-body' ? '%PDF-' : '{"error":'); await flush(); await g.advance(59000); check(g.timers.size === 1, `${scenario}: nonempty progress renews idle window`); await g.advance(1000); }
    else if (scenario === 'empty-chunks') { await g.advance(30000); g.emit(''); await flush(); await g.advance(30000); }
    else await g.advance(60000);
    const result = await p;
    check(result.error instanceof g.PrivatePdfError && result.error.message.includes('逾時'), `${scenario}: inactivity settles the request`);
    check(result.error.status === (scenario === 'headers' ? 0 : scenario === 'error-json' ? 403 : 200), `${scenario}: known permission status retained`);
    check(g.calls.length === 1 && g.calls[0][1].signal.aborted && !g.caller.signal.aborted, `${scenario}: owns cancellation and never retries`);
    check(g.timers.size === 0 && g.listeners() === 0, `${scenario}: deadline/listener released`);
    if (!['headers', 'fallback'].includes(scenario)) check(g.canceled() === 1 && !g.response.body.locked, `${scenario}: active stream canceled and reader unlocked`);
  }
  const canceled = fixture(); const p = outcome(canceled.privatePdfRequest('/synthetic.pdf', canceled.caller.signal)); await flush(); canceled.emit('%PDF-'); await flush();
  const reason = new Error('Synthetic cancellation'); canceled.caller.abort(reason); const canceledResult = await p;
  check(canceledResult.error === reason && canceled.canceled() === 1, 'Caller cancellation interrupts a mid-body read');
  check(!canceled.response.body.locked && canceled.timers.size === 0 && canceled.listeners() === 0, 'Canceled reader and listener released');
  const denied = fixture({ status: 403 }); const deniedPromise = outcome(denied.privatePdfRequest('/synthetic.pdf', denied.caller.signal)); await flush();
  for (const chunk of ['{"error":', '"Synthetic', ' denied"}']) { await denied.advance(40000); denied.emit(chunk); await flush(); }
  denied.end(); const deniedResult = await deniedPromise;
  check(deniedResult.error.status === 403 && deniedResult.error.message === 'Synthetic denied', 'Progressing 120s error JSON preserves denial instead of forcing a total deadline');
  const delayed = fixture({ holdHeaders: true }); const delayedPromise = outcome(delayed.privatePdfRequest('/synthetic.pdf', delayed.caller.signal));
  await delayed.advance(59000); delayed.resolveHeaders(); await flush(); await delayed.advance(59000); delayed.emit('%PDF-1.4'); delayed.end();
  check(Boolean((await delayedPromise).value), 'Headers and body each receive an idle window; no silent combined total cutoff');
}
const maximumFixtures = process.argv.find(value => value.startsWith('--maximum-fixtures='))?.slice('--maximum-fixtures='.length);
const maximumControls = [];
if (!baseline && maximumFixtures) {
  const manifest = JSON.parse(await readFile(path.join(maximumFixtures, 'max-batch.json'), 'utf8'));
  assert(manifest.syntheticOnly && manifest.frozenHead === '0fa9acd3d377d28c51a130a8c0b5e1917ae0f4c1');
  for (const name of ['export-client', 'export-full', 'matchExport-client', 'matchExport-full']) {
    const bytes = await readFile(path.join(maximumFixtures, name + '.pdf'));
    const record = manifest.reports.find(row => row.name === name);
    check(record.status === 200 && record.records === (name.startsWith('match') ? 101 : 100) && record.bytes === bytes.length, `${name}: exact existing maximum-count synthetic export fixture`);
    const g = fixture(); const p = outcome(g.privatePdfRequest('/synthetic.pdf', g.caller.signal)); await flush();
    for (let chunk = 0; chunk < 6; chunk++) {
      await g.advance(49000); g.emitBytes(bytes.subarray(Math.ceil(bytes.length * chunk / 6), Math.ceil(bytes.length * (chunk + 1) / 6))); await flush();
    }
    g.end(); const result = await p;
    check(result.value && bytes.equals(Buffer.from(await result.value.blob.arrayBuffer())), `${name}: 294s progressing maximum batch retains every byte`);
    check(g.timers.size === 0 && g.listeners() === 0 && !g.response.body.locked, `${name}: maximum batch releases reader and deadline`);
    const stalled = fixture(); const stalledPromise = outcome(stalled.privatePdfRequest('/synthetic.pdf', stalled.caller.signal)); await flush();
    stalled.emitBytes(bytes.subarray(0, 1000)); await flush(); await stalled.advance(60000);
    check((await stalledPromise).error instanceof stalled.PrivatePdfError && stalled.canceled() === 1, `${name}: stopped maximum batch ends at idle deadline`);
    maximumControls.push({ name, records: record.records, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), progressingVirtualMs: 294000, bodyStallVirtualMs: 60000 });
  }
}
const report = { passed: true, expectedFrozenCounterexample: baseline, checks: checks.length, labels: checks, maximumControls, timing: 'virtual milliseconds; actual helper and ReadableStream', productionRequests: 0 };
await mkdir('work/pdf-progress', { recursive: true }); await writeFile(`work/pdf-progress/progress-${baseline ? 'before' : 'after'}.json`, JSON.stringify(report, null, 2)+'\n'); console.log(JSON.stringify(report));
