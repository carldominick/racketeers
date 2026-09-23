import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = await mkdtemp(path.join(tmpdir(), 'projector-'));
await build({entryPoints:['lib/projector.ts'],outfile:path.join(dir,'logic.mjs'),bundle:true,platform:'node',format:'esm'});
const {paginateRows}=await import(pathToFileURL(path.join(dir,'logic.mjs')));
test('projector pages cover every row once for growing and shrinking lists and screen sizes',()=>{
 for(const count of [0,1,4,17,64,128])for(const available of [150,400,850]){
  const heights=Array.from({length:count},(_,i)=>i%3===0?90:48);
  const pages=paginateRows(heights,available);
  assert.deepEqual(pages.flatMap(p=>Array.from({length:p.end-p.start},(_,i)=>p.start+i)),Array.from({length:count},(_,i)=>i));
  for(const p of pages)assert.ok(heights.slice(p.start,p.end).reduce((a,b)=>a+b,0)<=available);
 }
});
test('long rows are kept whole and empty sections have one page',()=>{
 assert.deepEqual(paginateRows([50,300,50],150),[{start:0,end:1},{start:1,end:2},{start:2,end:3}]);
 assert.deepEqual(paginateRows([],150),[{start:0,end:0}]);
 assert.deepEqual(paginateRows([50,50],100),[{start:0,end:2}]);
});
test.after(()=>rm(dir,{recursive:true,force:true}));
