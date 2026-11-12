import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(path.join(tmpdir(),'sync-status-'));
await build({entryPoints:['lib/sync-status.ts'],outfile:path.join(dir,'sync.mjs'),bundle:true,platform:'node',format:'esm'});
const {pollFailure,readStateResponse,syncDisplayState}=await import(pathToFileURL(path.join(dir,'sync.mjs')));
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
 assert.equal(syncDisplayState('saved',100000,116999,1000),'saved');
 assert.equal(syncDisplayState('saved',100000,117001,1000),'stale');
 assert.equal(syncDisplayState('saved',100000,113000,2000),'saved');
 assert.equal(syncDisplayState('saved',100000,119001,2000),'stale');
 assert.equal(syncDisplayState('saved',100000,120000,60000),'saved');
 assert.equal(syncDisplayState('saved',100000,286000,60000),'stale');
 for(const status of ['saving','offline'])assert.equal(syncDisplayState(status,100000,999999,1000),status);
});

test('polling tolerates brief failures, slows repeated retries and respects rate limits', () => {
 const now = 100000;
 assert.deepEqual(pollFailure(0,now),{failures:1,retryAt:102000,unavailable:false});
 assert.equal(pollFailure(1,now).unavailable,false);
 assert.deepEqual(pollFailure(2,now),{failures:3,retryAt:108000,unavailable:true});
 assert.equal(pollFailure(100,now).retryAt,130000);
 assert.equal(pollFailure(0,now,'900').retryAt,1000000);
 assert.equal(pollFailure(0,now,new Date(now+60000).toUTCString()).retryAt,160000);
 assert.equal(pollFailure(0,now,'invalid').retryAt,102000);
});
