import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(path.join(tmpdir(),'organizer-demo-'));
for(const file of ['demo-runtime','demo-access','client-request'])await build({entryPoints:[`lib/${file}.ts`],outfile:path.join(dir,`${file}.mjs`),bundle:true,platform:'node',format:'esm'});
const {createDemoRuntime}=await import(pathToFileURL(path.join(dir,'demo-runtime.mjs')));
const {authorizeDemo}=await import(pathToFileURL(path.join(dir,'demo-access.mjs')));
const {apiFetch,installDemoTransport}=await import(pathToFileURL(path.join(dir,'client-request.mjs')));
const png=new Uint8Array(await readFile('preview/receipt-fixture.png'));
const org={'x-organizer-pin':'98765432'};
const request=(runtime,path='/api/state',method='GET',body,headers=org)=>runtime.send(path,{method,headers:{...headers,...(body&&!(body instanceof Uint8Array)?{'content-type':'application/json'}:{})},...(body?{body:body instanceof Uint8Array?body:JSON.stringify(body)}:{})});
const snapshot=async runtime=>(await request(runtime)).json();
test('demo entry grants only the current organizer and reads no live payload into its response',async()=>{
 const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('45678901'))).toString('hex');
 let writes=0;const env={DB:{prepare(){return {bind(){return {first:async()=>({payload:JSON.stringify({organizerPinHash:digest,registrations:[{name:'private fixture'}]})}),run:async()=>{writes++;}};},run:async()=>{writes++;}};}}};
 for(const headers of [{},{'x-organizer-pin':'98765432'},{'x-umpire-pin':'45678901'},{'x-registration-pin':'45678901'}])assert.equal((await authorizeDemo(new Request('https://example/api/demo',{method:'POST',headers}),env)).status,401);
 const response=await authorizeDemo(new Request('https://example/api/demo',{method:'POST',headers:{'x-organizer-pin':'45678901'}}),env);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
 const grant=await response.json();assert.equal(grant.authorized,true);assert.ok(grant.expiresAt>Date.now());assert.deepEqual(Object.keys(grant).sort(),['authorized','expiresAt']);assert.equal(writes,0);
});
test('demo uses real registration/CAS handlers in independent memory sessions with no network fallback',async()=>{
 const a=await createDemoRuntime(Date.now()+60000,png),b=await createDemoRuntime(Date.now()+60000,png);
 const native=globalThis.fetch;globalThis.fetch=()=>{throw new Error('Network escape');};
 try {
  const before=await snapshot(a);assert.equal(before.state.registrations.length,8);
  const body={action:'registerPlayer',registration:{divisionId:before.state.divisions[0].id,name:'Tomas Castillo',partnerName:'Lucia Velasco',club:'Shore Club',partnerClub:'Shore Club',facebookProfile:'https://facebook.com/tomas.demo',partnerFacebookProfile:'https://facebook.com/lucia.demo',phone:'09123456789',partnerPhone:'09123456780',shirtSize:'M',partnerShirtSize:'S'}};
  const created=await request(a,'/api/state','POST',body);assert.equal(created.status,200);assert.equal((await snapshot(a)).state.registrations.length,10);assert.equal((await snapshot(b)).state.registrations.length,8);
  const current=await snapshot(a);const proposed={...current.state,tournamentName:'Practice edit'};
  assert.equal((await request(a,'/api/state','PUT',{state:proposed,expectedRevision:current.revision})).status,200);
  assert.equal((await request(a,'/api/state','PUT',{state:proposed,expectedRevision:current.revision})).status,409);
  assert.equal((await request(a,'/api/unknown','POST',{})).status,404);
 }finally{globalThis.fetch=native;a.close();b.close();}
});
test('demo receipts have three seeded photos, enforce four slots, and invalidate reviewed details',async()=>{
 const runtime=await createDemoRuntime(Date.now()+60000,png);
 try {
  const base='/api/payment-proof?registrationId=DEMO-PLAYER-1';
  const meta=await(await request(runtime,base+'&metadata=1')).json();assert.equal(meta.photos.length,3);
  const record=await(await request(runtime,'/api/payment-details?registrationId=DEMO-PLAYER-1')).json();
  const saved=await request(runtime,'/api/payment-details?registrationId=DEMO-PLAYER-1','POST',{details:{amount:'1250.00',reference:'000123',provider:'Demo',date:'2026-11-07'},expectedRevision:record.revision,proofVersion:record.proofVersion});assert.equal(saved.status,200);
  assert.equal((await request(runtime,base+'&slot=4','POST',png,{...org,'content-type':'image/png'})).status,200);
  assert.equal((await request(runtime,base+'&slot=5','POST',png,{...org,'content-type':'image/png'})).status,400);
  assert.equal((await request(runtime,base,'GET',undefined,{})).status,401);
  const changed=await(await request(runtime,'/api/payment-details?registrationId=DEMO-PLAYER-1')).json();assert.equal(changed.stale,true);
  assert.ok((await snapshot(runtime)).state.registrations.every(p=>!p.paid));
  const links=await(await request(runtime,'/api/payment-proof?export-links=1','POST',{registrationIds:['DEMO-PLAYER-1']})).json();assert.match(links.links['DEMO-PLAYER-1'],/^blob:/);
 }finally{runtime.close();}
});
test('expired and closed demos deny mutations; the demo document never falls through to live fetch',async()=>{
 const expired=await createDemoRuntime(Date.now()-1);assert.equal((await request(expired)).status,401);expired.close();
 const runtime=await createDemoRuntime(Date.now()+60000);runtime.close();assert.equal((await request(runtime,'/api/state','PUT',{})).status,401);
 const oldWindow=globalThis.window,oldFetch=globalThis.fetch;let liveCalls=0;
 globalThis.window={location:{pathname:'/demo'}};globalThis.fetch=async()=>{liveCalls++;return Response.json({});};
 try {
  assert.equal((await apiFetch('/api/state',{method:'PUT'})).status,401);
  const fresh=await createDemoRuntime(Date.now()+60000);const stop=installDemoTransport(fresh);assert.equal((await apiFetch('/api/state',{headers:org})).status,200);stop();
  assert.equal((await apiFetch('/api/state')).status,401);assert.equal(liveCalls,0);
  globalThis.window.location.pathname='/';assert.throws(()=>installDemoTransport(fresh),/demo page/);
 }finally{globalThis.window=oldWindow;globalThis.fetch=oldFetch;}
});
test.after(()=>rm(dir,{recursive:true,force:true}));
