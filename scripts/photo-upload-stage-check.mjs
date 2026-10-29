// Deterministic cancellation checks for the actual upload-stage helper.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url), ts = require('typescript');
const source = await readFile('lib/photo-upload.ts', 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { photoUploadStage } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const checks = [], check = (value, label) => { assert(value, label); checks.push(label); };
function controller() {
  const c = new AbortController(); let added = 0, removed = 0;
  const add = c.signal.addEventListener.bind(c.signal), remove = c.signal.removeEventListener.bind(c.signal);
  c.signal.addEventListener = (...args) => { added++; return add(...args); };
  c.signal.removeEventListener = (...args) => { removed++; return remove(...args); };
  return { c, balanced: () => added === removed };
}
const settle = async p => {
  let timer;
  try { return await Promise.race([p, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Stage did not settle within 100ms')), 100); })]); }
  finally { clearTimeout(timer); }
};
for (const mode of ['hung', 'late-resolve', 'late-reject']) {
  const { c, balanced } = controller(); let resolve, reject, calls = 0;
  const p = photoUploadStage(() => { calls++; return new Promise((yes, no) => { resolve = yes; reject = no; }); }, c.signal);
  await Promise.resolve(); c.abort();
  await assert.rejects(settle(p), { name: 'AbortError' }); checks.push(`${mode}: cancellation settles without waiting for underlying operation`);
  check(calls === 1 && balanced(), `${mode}: one operation and abort listener removed`);
  if (mode === 'late-resolve') resolve('obsolete claim');
  if (mode === 'late-reject') reject(new Error('obsolete failure'));
  await Promise.resolve(); await Promise.resolve();
}
{
  const { c, balanced } = controller(); c.abort(); let calls = 0;
  await assert.rejects(photoUploadStage(async () => { calls++; }, c.signal), { name: 'AbortError' });
  check(calls === 0 && balanced(), 'Pre-cancelled stage cannot begin image processing or network');
}
{
  const { c, balanced } = controller();
  check(await photoUploadStage(async () => 'confirmed claim', c.signal) === 'confirmed claim', 'Normal stage result preserved');
  check(!c.signal.aborted && balanced(), 'Success leaves caller signal usable and removes listener');
  check(await photoUploadStage(async () => 2, c.signal) === 2, 'Caller signal can be reused for the next stage');
}
{
  const { c, balanced } = controller(), error = new Error('synthetic decode failure');
  await assert.rejects(photoUploadStage(() => { throw error; }, c.signal), error);
  check(balanced() && !c.signal.aborted, 'Synchronous processing error removes listener without aborting caller');
}
{
  const { c, balanced } = controller(); let finish;
  const p = photoUploadStage(() => new Promise(resolve => { finish = resolve; }), c.signal);
  await Promise.resolve(); finish('late success'); c.abort();
  await assert.rejects(p, { name: 'AbortError' });
  check(balanced(), 'Abort before result observation rejects late success and cleans listener');
}
const report = { passed: true, checks: checks.length, assertions: checks, helperSha256: createHash('sha256').update(source).digest('hex'), syntheticOnly: true, runtime: process.version };
await mkdir('work/photo-upload-recovery', { recursive: true }); await writeFile('work/photo-upload-recovery/stage-check.json', JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
