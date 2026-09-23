import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(path.join(tmpdir(),'registration-access-'));
await build({entryPoints:['app/api/state/route.ts'],outfile:path.join(dir,'api.mjs'),bundle:true,platform:'node',format:'esm',plugins:[{name:'test-database',setup(build){build.onResolve({filter:/^cloudflare:workers$/},()=>({path:'mock',namespace:'mock'}));build.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const env = globalThis.__rackTestEnv;',loader:'js'}));}}]});
await build({entryPoints:['lib/tournament.ts'],outfile:path.join(dir,'logic.mjs'),bundle:true,platform:'node',format:'esm'});
const logic=await import(pathToFileURL(path.join(dir,'logic.mjs')));
let saved;
const hash=async pin=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pin))).toString('hex');
globalThis.__rackTestEnv={DB:{prepare(sql){return {run:async()=>({}),bind(...values){return {first:async()=>saved,run:async()=>{if(sql.startsWith('UPDATE')){if(values[4]!==saved.revision)return {meta:{changes:0}};saved={revision:values[0],payload:values[1],updated_at:values[2]};}return {meta:{changes:1}};}};}};}}};
const api=await import(pathToFileURL(path.join(dir,'api.mjs')));
async function reset(){const state=logic.initialTournament();Object.assign(state,{status:'registration',organizerPinHash:await hash('12345678')});saved={revision:1,payload:JSON.stringify(state),updated_at:new Date().toISOString()};return state;}
const request=(body,headers={},method='POST')=>new Request('https://test/api/state',{method,headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
const post=(body,headers)=>api.POST(request(body,headers));
const org={'x-organizer-pin':'12345678'};
const create=(divisionId,extra={})=>({action:'registerPlayer',registration:{divisionId,name:'Alex',partnerName:'Sam',club:'Cebu Club',partnerClub:'Rackets',...extra}});

test('new and duplicated divisions stay empty through regeneration and hydration',()=>{
 let state=logic.initialTournament();assert.equal(state.registrations.length,0);assert.equal(state.divisions[0].entries.length,0);
 state=logic.addDivision(state);state=logic.duplicateDivision(state,state.divisions[0].id);state=logic.hydrateTournament(logic.regenerateMatches(state));
 assert.equal(state.registrations.length,0);assert.ok(state.divisions.every(d=>d.entries.length===0));
 const stale={...state,divisions:[{...state.divisions[0],entries:[logic.makeEntry(0,'doubles',2,2)]}]};
 assert.equal(logic.hydrateTournament(stale).registrations.length,0);
});
test('clubs are optional, persisted separately, and available on PIN lookup',async()=>{
 const state=await reset();const response=await post(create(state.divisions[0].id));assert.equal(response.status,200);
 const result=await response.json();assert.match(result.registration.id,/^[A-Z0-9]+$/);assert.equal(result.registration.club,'Cebu Club');assert.equal(result.registration.partnerClub,'Rackets');
 const lookup=await (await post({action:'lookupRegistration',pin:result.editPin})).json();assert.equal(lookup.registration.club,'Cebu Club');
 assert.equal((await post(create(state.divisions[0].id,{name:'Lee',partnerName:'Pat',club:undefined,partnerClub:undefined}))).status,200);
});
test('linked same-division pair entries remain distinct and require original PIN; a third is rejected',async()=>{
 const state=await reset();const first=await (await post(create(state.divisions[0].id))).json();
 const second=create(state.divisions[0].id,{sourceRegistrationId:first.registration.id,samePartner:true,secondShirt:'black',partnerSecondShirt:'tournament'});
 assert.equal((await post(second)).status,401);
 second.pin=first.editPin;const response=await post(second);assert.equal(response.status,200);
 const data=await response.json();assert.notEqual(data.registration.id,first.registration.id);assert.equal(data.registration.secondShirt,'black');
 const current=JSON.parse(saved.payload);assert.equal(current.registrations.length,4);assert.equal(current.divisions[0].entries.length,2);assert.equal(data.registration.personId,first.registration.id);
 assert.equal((await post(second)).status,409);
});
test('second entry can target another division with a different partner and organizer can use the same endpoint',async()=>{
 let state=await reset();state=logic.addDivision(state,'Another Division');saved.payload=JSON.stringify(state);
 const first=await (await post(create(state.divisions[0].id))).json();
 const second=create(state.divisions[1].id,{sourceRegistrationId:first.registration.id,samePartner:false,partnerName:'Morgan',secondShirt:'tournament'});
 const response=await post(second,org);assert.equal(response.status,200);const result=await response.json();assert.equal(result.registration.partnerName,'Morgan');
 const current=JSON.parse(saved.payload);assert.equal(current.divisions[1].entries.length,1);assert.equal(current.registrations.find(r=>r.id===result.registration.partnerId).personId,undefined);
});
test('public phase lock applies while organizer creation is allowed and invalid pairs cannot be saved',async()=>{
 const state=await reset();state.status='setup';saved.payload=JSON.stringify(state);
 assert.equal((await post(create(state.divisions[0].id))).status,423);
 assert.equal((await post(create(state.divisions[0].id),org)).status,200);
 assert.equal((await post(create(state.divisions[0].id,{partnerName:''}),org)).status,400);
});
test('umpire access is separate, required for match APIs, rotates immediately, and never grants organizer access',async()=>{
 let state=await reset();const d=state.divisions[0];d.registrationManaged=false;d.entries=[logic.makeEntry(0,'doubles'),logic.makeEntry(1,'doubles')];state=logic.regenerateMatches(state);saved.payload=JSON.stringify(state);
 const match=state.matches[0];
 assert.equal((await post({action:'verifyMatch',pin:match.pin})).status,401);
 assert.equal((await post({action:'changeUmpirePin',newPin:'87654321'})).status,401);
 assert.equal((await post({action:'changeUmpirePin',newPin:'12345678'},org)).status,400);
 assert.equal((await post({action:'changeUmpirePin',newPin:'87654321'},org)).status,200);
 assert.equal((await (await post({action:'verifyAccess',pin:'87654321'})).json()).role,'umpire');
 assert.equal((await (await post({action:'verifyAccess',pin:'12345678'})).json()).role,'organizer');
 const ump={'x-umpire-pin':'87654321'};
 assert.equal((await post({action:'verifyMatch',pin:match.pin},ump)).status,200);
 assert.equal((await api.PATCH(request({matchId:match.id,pin:match.pin,sets:[{a:1,b:0,complete:false}]},{},'PATCH'))).status,401);
 assert.equal((await api.PATCH(request({matchId:match.id,pin:match.pin,sets:[{a:1,b:0,complete:false}]},ump,'PATCH'))).status,200);
 assert.equal((await api.PUT(request({state,expectedRevision:saved.revision},ump,'PUT'))).status,401);
 const publicData=await (await api.GET(new Request('https://test/api/state',{headers:ump}))).json();assert.equal(publicData.state.umpirePinHash,undefined);assert.equal(publicData.state.organizerPinHash,undefined);assert.deepEqual(publicData.state.registrations,[]);
 assert.equal((await post({action:'changeUmpirePin',newPin:'11223344'},org)).status,200);
 assert.equal((await post({action:'verifyMatch',pin:match.pin},ump)).status,401);
 assert.equal((await api.PATCH(request({matchId:match.id,pin:match.pin},ump,'PATCH'))).status,401);
});
test.after(()=>rm(dir,{recursive:true,force:true}));

test('either original partner can take a second entry using the pair PIN',async()=>{
 let state=await reset();state=logic.addDivision(state,'Singles');state.divisions[1].mode='singles';saved.payload=JSON.stringify(state);
 const first=await (await post(create(state.divisions[0].id))).json();
 const response=await post({...create(state.divisions[1].id,{sourceRegistrationId:first.registration.partnerId,name:'Sam',partnerName:'',samePartner:false,secondShirt:'black'}),pin:first.editPin});
 assert.equal(response.status,200);const second=await response.json();assert.equal(second.registration.name,'Sam');assert.equal(second.registration.personId,first.registration.partnerId);assert.equal(second.registration.partnerId,null);
 const changed=await post({action:'updateRegistration',pin:second.editPin,registration:{club:'Updated Club'}});assert.equal(changed.status,200);assert.equal((await changed.json()).registration.secondShirt,'black');
});
test('legacy placeholder entries without registration IDs never become registration records',()=>{
 const state=logic.initialTournament();state.version=4;state.divisions[0].entries=[logic.makeEntry(0,'doubles')];
 assert.equal(logic.hydrateTournament(state).registrations.length,0);
});
