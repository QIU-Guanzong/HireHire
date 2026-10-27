// Execute the actual submit handler with deterministic in-memory browser adapters.
// No HTTP server, real records, production access, or React-rendering claims.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url), ts = require('typescript');
const source = await readFile('components/intake-form.tsx', 'utf8');
const start = source.indexOf('  const submit = async (event: FormEvent) => {');
const end = source.indexOf('  const handleSavedDraft = ', start);
assert(start >= 0 && end > start, 'Extract the exact current submission handler');
const compiled = ts.transpileModule(source.slice(start, end) + '\nglobalThis.submitUnderTest = submit;',
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const checks = [], check = (value, label) => { assert(value, label); checks.push(label); };
const baseline = process.argv.includes('--expect-bug');
function fixture(kind, replies) {
  const writes = [], requests = [], timers = new Map(), storage = new Map(); let timerId = 0;
  const data = { fullName: '合成 原文 only', phone: '+852 00000000', consent: true };
  const context = { FormEvent: undefined, AbortController, TextEncoder, Uint8Array, crypto: webcrypto,
    kind, data, photo: { id: 'synthetic-photo', token: 'synthetic-photo-claim' }, candidateIds: [],
    busyRef: { current: false }, pendingDraft: null, photoUploading: false, step: 3,
    formSections: [{}, {}, {}], pendingSubmission: false, saveDraft: true,
    attemptRef: { current: null }, websiteRef: { current: { value: '' } },
    draftCompleteRef: { current: false }, submissionAbortRef: { current: null },
    titleRef: { current: null }, errorRef: { current: null },
    validate: () => true, allFields: () => [{ name: 'fullName' }], validateIntakeFields: () => ({}),
    attemptKey: value => 'attempt.' + value,
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    updateStoredDraft: async (value, options) => { writes.push({ value, options }); },
    intakeResponseError: () => '未能確認提交結果。資料仍在此頁，請重試。',
    requestAnimationFrame: callback => callback(),
    setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, init) => {
      requests.push({ url, body: init.body });
      const reply = replies.shift(); assert(reply, 'No automatic extra request');
      return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body };
    },
  };
  for (const [setter, key] of Object.entries({ setSubmitting: 'submitting', setSubmitError: 'error', setPendingSubmission: 'pendingSubmission', setReference: 'reference', setSaveDraft: 'saveDraft', setCandidateIds: 'candidateIds', setErrors: 'errors' })) context[setter] = value => { context[key] = value; };
  context.clearPhoto = () => { context.photo = null; };
  vm.runInNewContext(compiled, context);
  return { context, writes, requests, timers, storage, submit: () => context.submitUnderTest({ preventDefault() {} }) };
}
const reference = 'JH-E-20261027-ABCDEF12';
if (baseline) {
  const f = fixture('employer', [{ status: 200, body: { reference: {} } }]); await f.submit();
  check(typeof f.context.reference === 'object', 'Baseline accepts object as a successful reference');
  check(f.writes.some(entry => entry.value === null), 'Baseline deletes saved draft after malformed success');
  check(f.context.attemptRef.current === null && !f.context.pendingSubmission, 'Baseline loses confirmation retry identity');
} else {
  for (const kind of ['employer', 'jobseeker']) {
    for (const invalid of [undefined, null, '', '   ', '\n\t', {}, [], ['JH-E-20261027-ABCDEF12'], 42, true]) {
      const f = fixture(kind, [{ status: 200, body: { reference: invalid } }, { status: 200, body: { reference } }]);
      await f.submit();
      check(!f.context.reference && f.context.pendingSubmission === true, `${kind}/${JSON.stringify(invalid)} remains unconfirmed`);
      check(!f.writes.some(entry => entry.value === null) && !f.context.draftCompleteRef.current, 'Malformed response cannot complete or remove draft');
      check(f.context.attemptRef.current && f.context.photo && f.storage.size === 1, 'Original attempt, attachment and session key retained');
      check(f.requests.length === 1 && !f.context.submitting && !f.context.busyRef.current && f.timers.size === 0, 'No automatic retry; busy flag and deadline released');
      await f.submit();
      check(f.requests.length === 2 && f.requests[0].body === f.requests[1].body, 'Explicit retry sends identical envelope and idempotency key');
      check(f.context.reference === reference && f.writes.filter(entry => entry.value === null).length === 1 && f.storage.size === 0, 'One valid receipt clears owned draft and attempt once');
    }
    for (const status of [200, 201]) {
      const f = fixture(kind, [{ status, body: { reference, futureOptionalField: true } }]); await f.submit();
      check(f.context.reference === reference && !f.context.pendingSubmission, `${kind}/${status} legitimate receipt accepted with additional fields`);
    }
    for (const status of [400, 409, 408, 425, 503]) {
      const f = fixture(kind, [{ status, body: { reference, error: 'synthetic' } }]); await f.submit();
      check(!f.context.reference && !f.writes.some(entry => entry.value === null), `${status} cannot succeed from reference alone`);
      check(f.context.pendingSubmission === [408, 425, 503].includes(status), `${status} existing rejection/uncertainty policy retained`);
    }
    const f = fixture(kind, [{ status: 201, body: { reference } }]);
    await Promise.all([f.submit(), f.submit(), f.submit()]);
    check(f.requests.length === 1 && f.writes.filter(entry => entry.value === null).length === 1, 'Rapid clicks yield one request and one receipt cleanup');
  }
}
const output = { passed: true, baseline, checks: checks.length, assertions: checks, componentSha256: createHash('sha256').update(source).digest('hex'), syntheticOnly: true, actualHandler: true, browserRendered: false, node: process.version };
await mkdir('work/design-contract-audit-20261027', { recursive: true });
await writeFile(`work/design-contract-audit-20261027/intake-response-${baseline ? 'before' : 'after'}.json`, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output));
