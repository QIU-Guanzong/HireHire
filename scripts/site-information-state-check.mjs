// Actual component with deterministic hook/fetch adapters; not browser or HTTP acceptance.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url), ts = require('typescript');
const source = await readFile('components/site-information.tsx', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
let cursor = 0, effect, previousDeps, cleanup, inEffect = false, synchronousEffectWrites = 0;
const state = [], requests = [], checks = [];
const check = (condition, label) => { assert(condition, label); checks.push(label); };
const hooks = {
  useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => { if (inEffect) synchronousEffectWrites++; state[index] = typeof value === 'function' ? value(state[index]) : value; }]; },
  useEffect(callback, deps) { if (!previousDeps || deps.some((value, index) => value !== previousDeps[index])) { effect = callback; previousDeps = deps; } },
};
const compiledModule = { exports: {} };
vm.runInNewContext(compiled, {
  exports: compiledModule.exports, module: compiledModule, AbortController,
  require(name) { if (name === 'react') return hooks; if (name === './locale-provider') return { useLocale: () => ({ locale: 'zh-Hant' }) }; if (name === '@/lib/i18n') return { t: (_locale, text) => text }; return require(name); },
  fetch(url, init) { return new Promise((resolve, reject) => { requests.push({ url, init, resolve, reject }); }); },
});
const render = (mode = 'fees') => { cursor = 0; return compiledModule.exports.default({ mode }); };
const flushEffect = () => { if (!effect) return; cleanup?.(); const callback = effect; effect = undefined; inEffect = true; try { cleanup = callback(); } finally { inEffect = false; } };
const settle = () => new Promise(resolve => setImmediate(resolve));
let view = render();
check(view.props.role === 'status', 'Initial render shows loading');
flushEffect();
check(synchronousEffectWrites === 0, 'Fetch effect does not synchronously reset render state');
check(requests.length === 1 && requests[0].url === '/api/site-info', 'One initial request to existing public endpoint');
requests[0].resolve({ ok: false }); await settle();
view = render();
check(view.props.role === 'alert', 'Failed request shows retry alert');
const retry = view.props.children.find(child => child?.type === 'button');
retry.props.onClick();
view = render();
check(view.props.role === 'status', 'Retry clears error immediately before its effect runs');
check(state[0] === null && state[1] === false && state[2] === 1, 'Retry resets only loaded result/error and advances request attempt');
flushEffect();
check(requests[0].init.signal.aborted && requests.length === 2, 'Retry cleans previous request and starts one replacement');
check(synchronousEffectWrites === 0, 'Retry effect also avoids synchronous state writes');
requests[1].reject(new Error('synthetic network rejection')); await settle();
view = render();
check(view.props.role === 'alert', 'Rejected retry request returns to the retry alert');
view.props.children.find(child => child?.type === 'button').props.onClick();
view = render();
check(view.props.role === 'status' && state[2] === 2, 'A second explicit retry again enters loading');
flushEffect();
check(requests[1].init.signal.aborted && requests.length === 3 && synchronousEffectWrites === 0, 'Repeated retry replaces only its request without effect resets');
const info = { fees: [{ service: '家傭', amount: '100', unit: '次', notes: '合成資料' }], phone: '00000000', whatsapp: '', email: '', address: '', hours: '' };
requests[2].resolve({ ok: true, json: async () => info }); await settle();
view = render();
check(view.props.className === 'info-table-wrap' && state[0] === info, 'Confirmed retry data renders the fees table');
view = render('contact');
check(view.type === 'dl' && view.props.className === 'contact-list', 'Same confirmed data supports contact mode');
flushEffect();
check(requests.length === 3, 'Changing display mode does not refetch');
cleanup();
check(requests[2].init.signal.aborted, 'Unmount cleanup aborts the current request');
await mkdir('work/site-information-state', { recursive: true });
const report = { passed: true, checks: checks.length, assertions: checks, actualComponent: true, browserRendered: false, syntheticOnly: true, runtime: process.version };
await writeFile('work/site-information-state/report.json', JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report));
