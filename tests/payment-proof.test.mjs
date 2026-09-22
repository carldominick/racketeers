import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = await mkdtemp(path.join(tmpdir(), 'payment-proof-'));
await build({entryPoints:['lib/payment-proof-server.ts'],outfile:path.join(dir,'server.mjs'),bundle:true,platform:'node',format:'esm'});
const {handlePaymentProof,handlePaymentSettings,MAX_PROOF_BYTES} = await import(pathToFileURL(path.join(dir,'server.mjs')));
const hash = async pin => Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pin))).toString('hex');
const state = {status:'registration',organizerPinHash:await hash('876543'),registrations:[{id:'player-test',registrationPinHash:await hash('12345678'),paid:false},{id:'player-other',registrationPinHash:await hash('87654321')}]};
const objects=new Map(); let writes=0;
const env={DB:{prepare:()=>({bind:()=>({first:async()=>({payload:JSON.stringify(state)})})})},PAYMENT_PROOFS:{head:async key=>objects.get(key)??null,get:async key=>{const value=objects.get(key);return value?{...value,body:new Blob([value.bytes]).stream()}:null;},put:async(key,bytes,options)=>{writes++;objects.set(key,{bytes,size:bytes.length,uploaded:new Date(),options});}}};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1sAAAAASUVORK5CYII=','base64');
const req=(options={})=>new Request(`https://test/api/payment-proof?registrationId=${options.id??'player-test'}${options.metadata?'&metadata=1':''}`,{method:options.method??'GET',headers:{...(options.organizer?{'x-organizer-pin':options.organizer}:{'x-registration-pin':options.pin??'12345678'}),...(options.method==='POST'?{'content-type':options.type??'image/png'}:{})},...(options.method==='POST'?{body:options.body??png}:{})});
test('payment screenshots stay private and use registration ID filenames',async()=>{
 assert.equal((await handlePaymentProof(req({pin:''}),env)).status,401);
 assert.equal((await handlePaymentProof(req({pin:'87654321'}),env)).status,401);
 assert.equal((await handlePaymentProof(req({method:'POST'}),env)).status,200);
 assert.ok(objects.has('payments/player-test.png'));
 assert.equal(state.registrations[0].paid,false);
 const response=await handlePaymentProof(req(),env);
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.match(response.headers.get('content-disposition'),/player-test.png/);
 assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
 assert.equal((await handlePaymentProof(req({organizer:'876543'}),env)).status,200);
 const meta=await (await handlePaymentProof(req({metadata:true}),env)).json();assert.equal(meta.filename,'player-test.png');
});
test('replacement overwrites the same key without creating additional files',async()=>{
 await handlePaymentProof(req({method:'POST'}),env);assert.equal(objects.size,1);
});
test('uploads require correct PIN and cannot target another registration',async()=>{
 const before=writes;
 assert.equal((await handlePaymentProof(req({method:'POST',id:'player-other'}),env)).status,401);
 assert.equal((await handlePaymentProof(req({method:'POST',pin:'bad'}),env)).status,401);
 assert.equal(writes,before);
});
test('live tournament locks player uploads',async()=>{
 state.status='live';
 assert.equal((await handlePaymentProof(req({method:'POST'}),env)).status,423);
 assert.equal((await handlePaymentProof(req(),env)).status,200);
 state.status='registration';
});
test('rejects fake, wrong-type, oversized and path-traversal uploads',async()=>{
 const before=writes;
 assert.equal((await handlePaymentProof(req({method:'POST',body:'not a PNG'}),env)).status,415);
 assert.equal((await handlePaymentProof(req({method:'POST',type:'image/svg+xml'}),env)).status,415);
 assert.equal((await handlePaymentProof(req({method:'POST',body:new Uint8Array(MAX_PROOF_BYTES+1)}),env)).status,413);
 assert.equal((await handlePaymentProof(req({method:'POST',id:'../other'}),env)).status,400);
 assert.equal(writes,before);
});
test('missing storage fails gracefully and capabilities report unavailable',async()=>{
 const without={DB:env.DB};
 assert.equal((await handlePaymentProof(req({method:'POST'}),without)).status,503);
 const response=await handlePaymentProof(new Request('https://test/api/payment-proof?capabilities=1'),without);
 assert.equal((await response.json()).enabled,false);
});
test('deleted registrations cannot access retained files',async()=>{
 const removed=state.registrations.shift();
 assert.equal((await handlePaymentProof(req(),env)).status,401);
 state.registrations.unshift(removed);
});
test.after(()=>rm(dir,{recursive:true,force:true}));

test('payment settings preserve account zeroes and require organizer access for changes', async () => {
 let stored = null;
 const settingsEnv = { ...env, DB: { prepare(sql) { return { run: async()=>({}), bind(...values) { return { first: async()=>sql.includes('tournament_state')?{payload:JSON.stringify(state)}:stored?{payload:stored}:null, run: async()=>{stored=values[1];} }; } }; } } };
 const details = {bankName:'Test Bank',accountNumber:'001234567',accountName:'Tournament Organizer',instructions:'Use the player name as reference.'};
 const save = pin => new Request('https://test/api/payment-settings',{method:'POST',headers:{'x-organizer-pin':pin,'content-type':'application/json'},body:JSON.stringify(details)});
 assert.equal((await handlePaymentSettings(save('12345678'),settingsEnv)).status,401);
 assert.equal(stored,null);
 assert.equal((await handlePaymentSettings(save('876543'),settingsEnv)).status,200);
 const response=await handlePaymentSettings(new Request('https://test/api/payment-settings'),settingsEnv);
 const result=await response.json();assert.equal(result.accountNumber,'001234567');assert.equal(result.bankName,'Test Bank');
 assert.equal(result.organizerPinHash,undefined);
});
test('organizer QR image is public but uploads and removal require organizer PIN', async()=>{
 const bucket={...env.PAYMENT_PROOFS,delete:async key=>objects.delete(key)};
 const settingsEnv={...env,PAYMENT_PROOFS:bucket};
 const request=(method,pin)=>new Request('https://test/api/payment-settings?image=1',{method,headers:{'x-organizer-pin':pin??'','content-type':'image/png'},...(method==='POST'?{body:png}:{})});
 assert.equal((await handlePaymentSettings(request('POST','12345678'),settingsEnv)).status,401);
 assert.equal((await handlePaymentSettings(request('POST','876543'),settingsEnv)).status,200);
 assert.ok(objects.has('payment-instructions/qr.png'));
 const publicImage=await handlePaymentSettings(request('GET'),settingsEnv);
 assert.equal(publicImage.status,200);assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()),png);
 assert.equal((await handlePaymentSettings(request('DELETE'),settingsEnv)).status,401);
 assert.equal((await handlePaymentSettings(request('DELETE','876543'),settingsEnv)).status,200);
 assert.equal((await handlePaymentSettings(request('GET'),settingsEnv)).status,404);
});


test('upload size is capped at exactly 2 MiB for receipts and payment QR images', async () => {
 assert.equal(MAX_PROOF_BYTES, 2 * 1024 * 1024);
 const oversized = new Uint8Array(MAX_PROOF_BYTES + 1);
 assert.equal((await handlePaymentProof(req({method:'POST', body:oversized}), env)).status, 413);
 const response = await handlePaymentSettings(new Request('https://test/api/payment-settings?image=1', {method:'POST', headers:{'x-organizer-pin':'876543','content-type':'image/png'},body:oversized}),env);
 assert.equal(response.status,413);
});

test('only organizers can delete a payment photo without deleting the registration', async () => {
  const bucket = { ...env.PAYMENT_PROOFS, delete: async key => objects.delete(key) };
  const target = { ...env, PAYMENT_PROOFS: bucket };
  await handlePaymentProof(req({ method: 'POST' }), target);
  const savedState = JSON.stringify(state);
  assert.equal((await handlePaymentProof(req({ method: 'DELETE' }), target)).status, 403);
  assert.ok(objects.has('payments/player-test.png'));
  assert.equal((await handlePaymentProof(req({ method: 'DELETE', pin: '' }), target)).status, 401);
  assert.equal((await handlePaymentProof(req({ method: 'DELETE', organizer: '876543' }), target)).status, 200);
  assert.equal(objects.has('payments/player-test.png'), false);
  assert.equal(JSON.stringify(state), savedState);
  assert.equal((await handlePaymentProof(req({ metadata: true }), target)).status, 404);
});

test('organizer uploads and either reciprocal partner can read shared proof; unrelated players cannot', async () => {
 objects.clear();
 const first=state.registrations[0], second=state.registrations[1];
 Object.assign(first,{partnerId:second.id,divisionId:'d'}); Object.assign(second,{partnerId:first.id,divisionId:'d'});
 const upload=await handlePaymentProof(req({method:'POST',organizer:'876543'}),env);
 assert.equal(upload.status,200);
 const result=await upload.json(); assert.deepEqual(result.linkedRegistrationIds,[first.id,second.id].sort());
 assert.equal(objects.size,1);
 assert.equal((await handlePaymentProof(req({id:second.id}),env)).status,200);
 assert.equal((await handlePaymentProof(req({pin:'87654321'}),env)).status,200);
 assert.equal((await handlePaymentProof(req({pin:'99999999'}),env)).status,401);
 const pairedEnv={...env,PAYMENT_PROOFS:{...env.PAYMENT_PROOFS,delete:async key=>objects.delete(key)}};
 assert.equal((await handlePaymentProof(req({method:'DELETE',id:second.id,organizer:'876543'}),pairedEnv)).status,200);
 assert.equal((await handlePaymentProof(req(),env)).status,404);
 await handlePaymentProof(req({method:'POST'}),env);
 second.partnerId=null;
 assert.equal((await handlePaymentProof(req({id:second.id}),env)).status,401);
 assert.equal((await handlePaymentProof(req({id:second.id,pin:'87654321'}),env)).status,404);
 delete first.partnerId;delete first.divisionId;delete second.partnerId;delete second.divisionId;
});
