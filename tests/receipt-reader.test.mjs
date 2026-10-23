import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(path.join(tmpdir(),'receipt-reader-'));
await build({entryPoints:['lib/receipt-ocr.ts'],outfile:path.join(dir,'reader.mjs'),bundle:true,platform:'node',format:'esm',plugins:[{name:'ocr-engine',setup(build){
 build.onResolve({filter:/^tesseract\.js$/},()=>({path:'engine',namespace:'mock'}));
 build.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const OEM={LSTM_ONLY:1};export const createWorker=(...args)=>globalThis.__receiptTestWorker(...args);',loader:'js'}));
}}]});
const {createReceiptReader,readReceiptPage}=await import(pathToFileURL(path.join(dir,'reader.mjs')));
test.after(()=>rm(dir,{recursive:true,force:true}));

test('one lazy OCR engine reads multiple screenshots, preserves references and closes once',async()=>{
 let initialized=0,recognized=0,terminated=0;
 globalThis.__receiptTestWorker=async(language,mode,options)=>{
  initialized++;assert.equal(language,'eng');assert.equal(mode,1);
  assert.equal(options.workerPath,'/ocr/worker.min.js');assert.equal(options.corePath,'/ocr/core');assert.equal(options.langPath,'/ocr/lang');assert.equal(options.workerBlobURL,false);
  return {setParameters:async()=>{},recognize:async()=>{recognized++;return {data:{text:'GCash\nAmount Sent PHP 1250.00\nReference No. 001234567890\nOct 22, 2026',confidence:92}};},terminate:async()=>{terminated++;}};
 };
 const reader=createReceiptReader(()=>{});assert.equal(initialized,0);
 for(let i=0;i<3;i++){const result=await reader.read(new Blob(['fixture']));assert.equal(result.details.reference,'001234567890');assert.equal(result.details.amount,'1250.00');assert.deepEqual(result.warnings,[]);}
 assert.equal(initialized,1);assert.equal(recognized,3);await reader.close();await reader.close();assert.equal(terminated,1);
 await assert.rejects(reader.read(new Blob()),{name:'AbortError'});
});

test('low-confidence OCR remains an explicitly flagged draft',async()=>{
 globalThis.__receiptTestWorker=async()=>({setParameters:async()=>{},recognize:async()=>({data:{text:'GCash\nAmount 100.00\nReference No. 001234567890',confidence:50}}),terminate:async()=>{}});
 const reader=createReceiptReader(()=>{});const result=await reader.read(new Blob());
 assert.match(result.warnings.join(' '),/low confidence/);await reader.close();
});

test('reference token confidence matters even on a high-confidence page, and a clear retry can recover it',()=>{
 const page=confidence=>({text:'Maya\nReference ID 001234AB5678',blocks:[{paragraphs:[{lines:[{words:[{text:'Reference',confidence:96},{text:'ID',confidence:96},{text:'001234AB5678',confidence}]}]}]}]});
 const weak=readReceiptPage(page(34));assert.equal(weak.details.reference,'');assert.match(weak.notices.join(' '),/low OCR confidence/);
 const clear=readReceiptPage(page(94));assert.equal(clear.details.reference,'001234AB5678');
});

test('a sparse-text retry fills missing fields and resets layout mode before the next screenshot',async()=>{
 const modes=[];let calls=0,initialized=0;
 globalThis.__receiptTestWorker=async()=>{initialized++;return {
  setParameters:async options=>modes.push(options.tessedit_pageseg_mode),
  recognize:async()=>({data:{text:++calls===1?'Maya\nPHP 1250.00':'Maya\nPHP 1250.00\nRef.No. 001234567890\nOct 22, 2026',confidence:95}}),terminate:async()=>{},
 };};
 const reader=createReceiptReader(()=>{});
 const result=await reader.read(new Blob());assert.equal(result.details.reference,'001234567890');assert.equal(result.details.date,'2026-10-22');assert.deepEqual(result.warnings,[]);
 await reader.read(new Blob());assert.deepEqual(modes,['3','11','3']);assert.equal(initialized,1);assert.equal(calls,3);await reader.close();
});

test('conflicting OCR passes remain blank for review instead of favoring a confident but different number',async()=>{
 let calls=0;
 globalThis.__receiptTestWorker=async()=>({setParameters:async()=>{},recognize:async()=>({data:{text:++calls===1?'BPI\nAmount 1250.00\nRef No. 001234567890':'BPI\nAmount 1750.00\nRef No. 009234567890\nOct 22, 2026',confidence:95}}),terminate:async()=>{}});
 const reader=createReceiptReader(()=>{});const result=await reader.read(new Blob());
 assert.equal(result.details.amount,'');assert.equal(result.details.reference,'');assert.equal(result.details.date,'2026-10-22');assert.match(result.warnings.join(' '),/ambiguous/);await reader.close();
});

test('a failed optional retry preserves the original reading and reports the limitation',async()=>{
 let calls=0;
 globalThis.__receiptTestWorker=async()=>({setParameters:async()=>{},recognize:async()=>{if(++calls===2)throw Error('OCR job failed');return {data:{text:'BPI\nAmount 1250.00\nRef No. 001234567890',confidence:95}};},terminate:async()=>{}});
 const reader=createReceiptReader(()=>{});const result=await reader.read(new Blob());
 assert.equal(result.details.amount,'1250.00');assert.equal(result.details.reference,'001234567890');assert.match(result.warnings.join(' '),/additional OCR pass could not finish/);await reader.close();
});

test('stopping before the optional pass prevents another recognition and terminates the reused worker',async()=>{
 let calls=0,terminated=0;
 globalThis.__receiptTestWorker=async()=>({setParameters:async()=>{},recognize:async()=>{calls++;return {data:{text:'BPI\nAmount 1250.00',confidence:95}};},terminate:async()=>{terminated++;}});
 const reader=createReceiptReader(message=>{if(message.includes('Checking small text'))void reader.close();});
 await assert.rejects(reader.read(new Blob()),{name:'AbortError'});assert.equal(calls,1);assert.equal(terminated,1);
});

test('failed OCR initialization is reported as an engine failure rather than an unreadable screenshot',async()=>{
 globalThis.__receiptTestWorker=async()=>{throw new Error('engine download failed');};
 const reader=createReceiptReader(()=>{});
 await assert.rejects(reader.read(new Blob()),{name:'ReceiptEngineError'});await reader.close();
});

test('cancellation during engine initialization terminates the eventual worker without recognizing an image',async()=>{
 let ready,started;const loading=new Promise(resolve=>{started=resolve;});let terminated=0,recognized=0;
 globalThis.__receiptTestWorker=()=>{started();return new Promise(resolve=>{ready=resolve;});};
 const reader=createReceiptReader(()=>{});const reading=reader.read(new Blob());
 await loading;await reader.close();ready({recognize:async()=>{recognized++;},terminate:async()=>{terminated++;}});
 await assert.rejects(reading,{name:'AbortError'});assert.equal(terminated,1);assert.equal(recognized,0);
});
