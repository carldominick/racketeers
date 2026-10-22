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
const {createReceiptReader}=await import(pathToFileURL(path.join(dir,'reader.mjs')));
test.after(()=>rm(dir,{recursive:true,force:true}));

test('one lazy OCR engine reads multiple screenshots, preserves references and closes once',async()=>{
 let initialized=0,recognized=0,terminated=0;
 globalThis.__receiptTestWorker=async(language,mode,options)=>{
  initialized++;assert.equal(language,'eng');assert.equal(mode,1);
  assert.equal(options.workerPath,'/ocr/worker.min.js');assert.equal(options.corePath,'/ocr/core');assert.equal(options.langPath,'/ocr/lang');assert.equal(options.workerBlobURL,false);
  return {recognize:async()=>{recognized++;return {data:{text:'GCash\nAmount Sent PHP 1250.00\nReference No. 001234567890',confidence:92}};},terminate:async()=>{terminated++;}};
 };
 const reader=createReceiptReader(()=>{});assert.equal(initialized,0);
 for(let i=0;i<3;i++){const result=await reader.read(new Blob(['fixture']));assert.equal(result.details.reference,'001234567890');assert.equal(result.details.amount,'1250.00');assert.deepEqual(result.warnings,[]);}
 assert.equal(initialized,1);assert.equal(recognized,3);await reader.close();await reader.close();assert.equal(terminated,1);
 await assert.rejects(reader.read(new Blob()),{name:'AbortError'});
});

test('low-confidence OCR remains an explicitly flagged draft',async()=>{
 globalThis.__receiptTestWorker=async()=>({recognize:async()=>({data:{text:'GCash\nAmount 100.00\nReference No. 001234567890',confidence:50}}),terminate:async()=>{}});
 const reader=createReceiptReader(()=>{});const result=await reader.read(new Blob());
 assert.match(result.warnings.join(' '),/low confidence/);await reader.close();
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
