// Executes the actual effect body with deterministic fetch/state adapters.
// Not a React render, browser, HTTP, or production acceptance test.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
const source = await readFile('components/site-information.tsx', 'utf8');
const start = 'useEffect(()=>{', end = '},[attempt]);';
assert.equal(source.split(start).length, 2, 'One unambiguous effect');
assert.equal(source.split(end).length, 2, 'One unambiguous attempt dependency');
const body = source.slice(source.indexOf(start) + start.length, source.indexOf(end));
const code = stripTypeScriptTypes('(function(){' + body + '})');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const settle = () => new Promise(resolve => setImmediate(resolve));
const assertions = [];
function check(condition, label) { assert(condition, label); assertions.push(label); }
function harness() {
  const requests = [], writes = [];
  const effect = vm.runInNewContext(code, {
    AbortController,
    fetch(url, init) { const request=deferred(); requests.push({...request,url,signal:init.signal}); return request.promise; },
    setInfo(value) { writes.push(['info',value]); },
    setError(value) { writes.push(['error',value]); },
  });
  return {effect,requests,writes};
}
const info = {fees:[], phone:'',whatsapp:'',email:'',address:'',hours:'',updatedAt:''};
{
 const h=harness(), cleanup=h.effect();
 h.requests[0].resolve({ok:true,json:async()=>info}); await settle();
 check(h.writes.length===1 && h.writes[0][1]===info,'Live success remains visible');
 cleanup(); check(h.requests[0].signal.aborted,'Cleanup still aborts transport');
}
{
 const h=harness(); h.effect();
 h.requests[0].resolve({ok:false}); await settle();
 check(h.writes.length===1 && h.writes[0][0]==='error','Live HTTP failure retains retry state');
}
{
 const h=harness(); h.effect();
 h.requests[0].reject(new Error('network')); await settle();
 check(h.writes.length===1 && h.writes[0][0]==='error','Live network failure retains retry state');
}
{
 const h=harness(), cleanup=h.effect(), json=deferred();
 h.requests[0].resolve({ok:true,json:()=>json.promise}); await settle();
 // Body has completed; cleanup happens before its queued continuation executes.
 json.resolve(info); cleanup(); await settle();
 check(h.writes.length===0,'Already-fulfilled body cannot publish after cleanup');
}
{
 const h=harness(), cleanup=h.effect(), json=deferred();
 h.requests[0].resolve({ok:true,json:()=>json.promise}); await settle();
 json.reject(new SyntaxError('invalid JSON')); cleanup(); await settle();
 check(h.writes.length===0,'Queued body failure cannot publish after cleanup');
}
{
 const h=harness(), firstCleanup=h.effect(), stale=deferred();
 h.requests[0].resolve({ok:true,json:()=>stale.promise}); await settle();
 firstCleanup(); const secondCleanup=h.effect();
 h.requests[1].resolve({ok:true,json:async()=>info}); await settle();
 stale.resolve({...info,phone:'superseded'}); await settle();
 check(h.writes.length===1 && h.writes[0][1]===info,'Effect setup-cleanup-setup ignores superseded success');
 secondCleanup();
}
{
 const h=harness(), firstCleanup=h.effect(), stale=deferred();
 h.requests[0].resolve({ok:true,json:()=>stale.promise}); await settle();
 firstCleanup(); const secondCleanup=h.effect();
 h.requests[1].resolve({ok:true,json:async()=>info}); await settle();
 stale.reject(new SyntaxError('superseded')); await settle();
 check(h.writes.length===1 && h.writes[0][1]===info,'Superseded failure cannot hide newer confirmed data');
 secondCleanup();
}
{
 const h=harness(); h.effect();
 h.requests[0].reject(new DOMException('cancelled','AbortError')); await settle();
 check(h.writes.length===0,'AbortError remains silent');
}
{
 const h=harness(), cleanup=h.effect();
 h.requests[0].resolve({ok:false}); cleanup(); await settle();
 check(h.writes.length===0,'Queued HTTP failure cannot publish after cleanup');
}
console.log(JSON.stringify({passed:true,checks:assertions.length,assertions,runtime:process.version,actualEffect:true,browser:false}));
