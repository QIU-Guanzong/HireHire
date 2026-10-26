import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),ts=require('typescript');
const source=await readFile('lib/private-pdf-request.ts','utf8');
assert(process.argv[2], 'Pass an explicit synthetic PDF fixture path');
const bytes=await readFile(process.argv[2]);assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
const chunkCount=65,intervalMs=1000;let chunks=0,delivered=0,interval,canceled=false;
const started=performance.now();
const context={exports:{},AbortController,Blob,Uint8Array,setTimeout,clearTimeout,fetch:async (_url,{signal})=>new Response(new ReadableStream({start(controller){
 const enqueue=()=>{const end=Math.ceil(bytes.length*(chunks+1)/chunkCount);controller.enqueue(bytes.subarray(delivered,end));delivered=end;chunks++;if(chunks===chunkCount){clearInterval(interval);controller.close();}};
 enqueue();interval=setInterval(enqueue,intervalMs);
 signal.addEventListener('abort',()=>{canceled=true;clearInterval(interval);controller.error(signal.reason);},{once:true});
}}),{headers:{'content-type':'application/pdf'}})};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
let error,completed=false,received;
try{const result=await context.exports.privatePdfRequest('/synthetic.pdf',new AbortController().signal);received=Buffer.from(await result.blob.arrayBuffer());completed=true;}catch(e){error=e;}
finally{clearInterval(interval);}
const elapsed=performance.now()-started;
assert(completed && !error && chunks===65 && !canceled && bytes.equals(received));
const report={helperSha256:(await import('node:crypto')).createHash('sha256').update(source).digest('hex'),syntheticOnly:true,productionRequests:0,clock:'real wall-clock; no timer acceleration',totalBytes:bytes.length,chunkCount,intervalMs,expectedCompletionMs:64000,chunksReceived:chunks,bytesReceived:delivered,elapsedMs:Math.round(elapsed),result:'64s continuous-progress PDF completes unchanged',completed,error:error?.message,status:error?.status,transportCanceled:canceled,byteIdentical:bytes.equals(received),absoluteTotalDeadline:false};
await writeFile('work/pdf-progress/continuous-stream-after.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
