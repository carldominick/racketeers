import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(path.join(tmpdir(),'sync-status-'));
await build({entryPoints:['lib/sync-status.ts'],outfile:path.join(dir,'sync.mjs'),bundle:true,platform:'node',format:'esm'});
const {readStateResponse,syncDisplayState}=await import(pathToFileURL(path.join(dir,'sync.mjs')));
test.after(()=>rm(dir,{recursive:true,force:true}));

test('a failed HTTP response, malformed JSON or invalid state cannot confirm synchronization',async()=>{
 for(const status of [401,409,429,503])await assert.rejects(readStateResponse(Response.json({error:'retry'},{status})));
 await assert.rejects(readStateResponse(new Response('{')));
 for(const payload of [{},{revision:1,state:{}},{revision:-1,state:{matches:[],divisions:[]}}])await assert.rejects(readStateResponse(Response.json(payload)));
 const envelope={revision:2,state:{matches:[],divisions:[]},organizer:false};assert.deepEqual(await readStateResponse(Response.json(envelope)),envelope);
});
test('connection status starts unconfirmed and ages independently of successful saves',()=>{
 assert.equal(syncDisplayState('connecting',0,100000,1000),'connecting');
 assert.equal(syncDisplayState('saved',0,100000,1000),'connecting');
 assert.equal(syncDisplayState('saved',100000,107999,1000),'saved');
 assert.equal(syncDisplayState('saved',100000,108001,1000),'stale');
 assert.equal(syncDisplayState('saved',100000,120000,60000),'saved');
 assert.equal(syncDisplayState('saved',100000,286000,60000),'stale');
 for(const status of ['saving','offline'])assert.equal(syncDisplayState(status,100000,999999,1000),status);
});
