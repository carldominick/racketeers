import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(path.join(tmpdir(),'security-'));
await build({entryPoints:['lib/request-security.ts'],outfile:path.join(dir,'security.mjs'),bundle:true,platform:'node',format:'esm'});
const {protectedRequest,philippinesAccess}=await import(pathToFileURL(path.join(dir,'security.mjs')));
test.after(()=>rm(dir,{recursive:true,force:true}));
function database() {
 const rows = new Map();
 return { prepare(sql) {
  return { run: async () => ({}), bind(...args) {
   return { first: async () => rows.get(args[0]) || null, run: async () => {
    if (sql.startsWith('INSERT')) {
     const row = rows.get(args[0]);
     rows.set(args[0], {count: row && row.expires > args[2] ? row.count + 1 : 1, expires: row && row.expires > args[2] ? row.expires : args[1]});
    }
   }};
  }};
 }};
}
test('geolock allows PH and blocks other or unknown locations and forged country headers',()=>{
 for(const country of ['PH','US','XX',undefined]){
  for(const pathname of ['/','/api/state','/assets/app.js','/_vinext/image']){
   const req=new Request('https://racketeers.example'+pathname,{headers:{'cf-ipcountry':'PH'}});
   Object.defineProperty(req,'cf',{value:{country}});
   assert.equal(philippinesAccess(req)?.status??200,country==='PH'?200:403);
  }
 }
 assert.equal(philippinesAccess(new Request('https://racketeers.example')).status,403);
 assert.equal(philippinesAccess(new Request('http://localhost/')),null);
});
test('cross-site, malformed JSON and streamed oversized requests are rejected before app execution',async()=>{
 const next=async()=>{throw new Error('must not execute');};const db=database();
 assert.equal((await protectedRequest(new Request('https://test/api/state',{headers:{origin:'https://evil.test'}}),db,next)).status,403);
 assert.equal((await protectedRequest(new Request('https://test/api/state',{method:'POST',headers:{'content-type':'application/json'},body:'{'}),db,next)).status,400);
 assert.equal((await protectedRequest(new Request('https://test/api/state',{method:'POST',headers:{'content-type':'application/json'},body:'x'.repeat(17000)}),db,next)).status,413);
});
test('failed credentials share a persistent per-IP limit across endpoints; successful reads do not consume it',async()=>{
 const db=database();let calls=0;
 const req=path=>new Request('https://test/api/'+path,{headers:{'x-organizer-pin':'1234','cf-connecting-ip':'203.0.113.1'}});
 for(let i=0;i<20;i++) assert.equal((await protectedRequest(req('state'),db,async()=>new Response('{}'))).status,200);
 for(let i=0;i<15;i++) assert.equal((await protectedRequest(req(i%2?'state':'payment-proof'),db,async()=>{calls++;return new Response('{}',{status:401});})).status,401);
 const blocked=await protectedRequest(req('state'),db,async()=>{calls++;return new Response('{}');});
 assert.equal(blocked.status,429);assert.equal(calls,15);assert.equal(blocked.headers.get('retry-after'),'900');
 assert.equal(blocked.headers.get('cache-control'),'private, no-store');
});
test('allowed requests preserve JSON body and apply security headers',async()=>{
 const response=await protectedRequest(new Request('https://test/api/state',{method:'POST',headers:{'content-type':'application/json',origin:'https://test'},body:'{"action":"verifyOrganizer"}'}),database(),async req=>{assert.equal((await req.json()).action,'verifyOrganizer');return Response.json({ok:true});});
 assert.equal(response.status,200);assert.equal(response.headers.get('x-frame-options'),'DENY');assert.equal(response.headers.get('cache-control'),'private, no-store');
});
