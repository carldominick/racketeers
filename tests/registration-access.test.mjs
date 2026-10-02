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
const create=(divisionId,extra={})=>({action:'registerPlayer',registration:{divisionId,name:'Alex',partnerName:'Sam',club:'Cebu Club',partnerClub:'Rackets',facebookProfile:'https://www.facebook.com/alex.test',phone:'09123456789',partnerFacebookProfile:'https://www.facebook.com/sam.test',partnerPhone:'+639123456780',...extra}});

test('new and duplicated divisions stay empty through regeneration and hydration',()=>{
 let state=logic.initialTournament();assert.equal(state.registrations.length,0);assert.equal(state.divisions[0].entries.length,0);
 state=logic.addDivision(state);state=logic.duplicateDivision(state,state.divisions[0].id);state=logic.hydrateTournament(logic.regenerateMatches(state));
 assert.equal(state.registrations.length,0);assert.ok(state.divisions.every(d=>d.entries.length===0));
 const stale={...state,divisions:[{...state.divisions[0],entries:[logic.makeEntry(0,'doubles',2,2)]}]};
 assert.equal(logic.hydrateTournament(stale).registrations.length,0);
});
test('clubs are required, persisted separately, and available on PIN lookup',async()=>{
 const state=await reset();const response=await post(create(state.divisions[0].id));assert.equal(response.status,200);
 const result=await response.json();assert.match(result.registration.id,/^[A-Z0-9]+$/);assert.equal(result.registration.club,'Cebu Club');assert.equal(result.registration.partnerClub,'Rackets');
 const lookup=await (await post({action:'lookupRegistration',pin:result.editPin})).json();assert.equal(lookup.registration.club,'Cebu Club');
 assert.equal((await post(create(state.divisions[0].id,{name:'Lee',partnerName:'Pat',club:undefined,partnerClub:undefined}))).status,400);
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
 const second=create(state.divisions[1].id,{sourceRegistrationId:first.registration.id,samePartner:false,partnerName:'Morgan',partnerClub:'Other Club',secondShirt:'tournament'});
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
 const beforeStaff = await (await api.GET(new Request('https://test/api/state'))).json();
 assert.deepEqual(beforeStaff.state.matches, []);
 const staffState = await (await api.GET(new Request('https://test/api/state',{headers:ump}))).json();
 assert.ok(staffState.state.matches.some(item => item.id === match.id));
 const opened = await (await post({action:'verifyMatch',pin:match.pin},ump)).json();
 assert.equal(opened.match.id,match.id);
 assert.equal(opened.match.pin,'');
 assert.ok(Array.isArray(opened.match.sets));
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

test('combined entries save atomically with one PIN, a shared payment group, and selectable edits',async()=>{
 let state=await reset();state=logic.addDivision(state,'Second division');saved.payload=JSON.stringify(state);
 const response=await post(create(state.divisions[0].id,{secondEntry:{divisionId:state.divisions[1].id,samePartner:true,secondShirt:'black',partnerSecondShirt:'tournament'}}));
 assert.equal(response.status,200);const result=await response.json();assert.equal(saved.revision,2);assert.equal(result.registrations.length,2);
 const current=JSON.parse(saved.payload);assert.equal(current.registrations.length,4);assert.equal(new Set(current.registrations.map(r=>r.paymentGroupId)).size,1);
 assert.ok(current.divisions.every(d=>d.entries.length===1));
 const second=result.registrations[1];assert.equal(second.secondShirt,'black');assert.equal(second.personId,result.registration.id);
 const lookup=await (await post({action:'lookupRegistration',pin:result.editPin,registrationId:second.id})).json();assert.equal(lookup.registration.id,second.id);assert.equal(lookup.registrations.length,2);
 const edit=await post({action:'updateRegistration',pin:result.editPin,registrationId:second.id,registration:{club:'Updated'}});assert.equal(edit.status,200);assert.equal((await edit.json()).registration.club,'Updated');
 const foreign=await (await post(create(state.divisions[0].id,{name:'Other'}))).json();
 assert.equal((await post({action:'lookupRegistration',pin:result.editPin,registrationId:foreign.registration.id})).status,401);
 assert.equal((await post({action:'updateRegistration',pin:result.editPin,registrationId:foreign.registration.id,registration:{name:'Wrong'}})).status,401);
 assert.equal((await post({...create(state.divisions[0].id,{sourceRegistrationId:result.registration.id,secondShirt:'black'}),pin:result.editPin})).status,409);
 assert.equal(JSON.stringify(result).includes('registrationPinRecovery'),false);assert.equal(JSON.stringify(lookup).includes('registrationPinHash'),false);
});
test('combined same-division entries support different partners and reject invalid second entries without saving',async()=>{
 const state=await reset(), id=state.divisions[0].id;
 for(const secondEntry of [{divisionId:'missing',secondShirt:'black'},{divisionId:id,secondShirt:'invalid'},{divisionId:id,secondShirt:'black',partnerName:''}]){
  assert.equal((await post(create(id,{secondEntry}))).status,400);assert.equal(saved.revision,1);assert.equal(JSON.parse(saved.payload).registrations.length,0);
 }
 const result=await (await post(create(id,{secondEntry:{divisionId:id,samePartner:false,partnerName:'Morgan',partnerClub:'Other Club',partnerFacebookProfile:'https://facebook.com/morgan.test',partnerPhone:'09123456788',secondShirt:'tournament'}}))).json();
 assert.equal(result.registrations.length,2);assert.equal(result.registrations[1].partnerName,'Morgan');assert.equal(result.registrations[1].partnerClub,'Other Club');assert.equal(JSON.parse(saved.payload).divisions[0].entries.length,2);
});
test('only organizers recover PINs; replacements rotate every linked entry and legacy PINs can be replaced',async()=>{
 const state=await reset(),id=state.divisions[0].id;
 const result=await (await post(create(id,{secondEntry:{divisionId:id,samePartner:true,secondShirt:'black',partnerSecondShirt:'black'}}))).json();
 const registrationId=result.registration.partnerId;
 assert.equal((await post({action:'viewRegistrationPin',registrationId})).status,401);
 assert.equal((await post({action:'replaceRegistrationPin',registrationId})).status,401);
 const shown=await post({action:'viewRegistrationPin',registrationId},org);assert.equal(shown.headers.get('cache-control'),'private, no-store');assert.equal((await shown.json()).pin,result.editPin);
 for(const headers of [{},org]){const data=await (await api.GET(new Request('https://test/api/state',{headers}))).text();assert.equal(data.includes('registrationPinRecovery'),false);assert.equal(data.includes(result.editPin),false);}
 const replacement=await (await post({action:'replaceRegistrationPin',registrationId},org)).json();assert.notEqual(replacement.pin,result.editPin);
 assert.equal((await post({action:'lookupRegistration',pin:result.editPin})).status,401);
 const lookup=await (await post({action:'lookupRegistration',pin:replacement.pin})).json();assert.equal(lookup.registrations.length,2);
 const legacy=JSON.parse(saved.payload);legacy.registrations.forEach(r=>delete r.registrationPinRecovery);saved.payload=JSON.stringify(legacy);
 assert.equal((await (await post({action:'viewRegistrationPin',registrationId},org)).json()).pin,null);
 assert.match((await (await post({action:'replaceRegistrationPin',registrationId},org)).json()).pin,/^\d{8,10}$/);
 const before=JSON.parse(saved.payload);const incoming=structuredClone(before);incoming.registrations.forEach(r=>{r.registrationPinRecovery='forged';r.registrationPinHash='forged';r.paymentGroupId='forged';});
 const savedResponse=await api.PUT(request({state:incoming,expectedRevision:saved.revision},org,'PUT'));assert.equal(savedResponse.status,200);assert.equal((await savedResponse.text()).includes('registrationPinRecovery'),false);
 assert.equal(JSON.parse(saved.payload).registrations[0].registrationPinRecovery,before.registrations[0].registrationPinRecovery);assert.equal(JSON.parse(saved.payload).registrations[0].paymentGroupId,before.registrations[0].paymentGroupId);
});

test('registration reset requires organizer, confirmation and current revision; division reset preserves other entries',async()=>{
 let state=await reset();state=logic.addDivision(state,'Keep');saved.payload=JSON.stringify(state);
 const first=await (await post(create(state.divisions[0].id,{secondEntry:{divisionId:state.divisions[1].id,samePartner:true,secondShirt:'black',partnerSecondShirt:'black'}}))).json();
 let current=JSON.parse(saved.payload);current=logic.regenerateMatches(current);saved.payload=JSON.stringify(current);
 const kept=current.registrations.filter(r=>r.divisionId===state.divisions[1].id);
 const action={action:'resetRegistrations',divisionId:state.divisions[0].id,confirmation:'RESET',expectedRevision:saved.revision};
 assert.equal((await post(action)).status,401);
 assert.equal((await post({...action,confirmation:''},org)).status,400);
 assert.equal((await post({...action,expectedRevision:0},org)).status,409);
 assert.equal((await post({...action,divisionId:'unknown'},org)).status,404);
 assert.equal((await post(action,org)).status,200);
 let next=JSON.parse(saved.payload);assert.deepEqual(next.registrations,kept);assert.equal(next.divisions[0].entries.length,0);assert.equal(next.divisions[0].name,state.divisions[0].name);assert.equal(next.matches.some(m=>m.divisionId===state.divisions[0].id),false);
 assert.deepEqual(next.divisions[1],current.divisions[1]);assert.equal((await post({action:'lookupRegistration',pin:first.editPin,registrationId:kept.find(r=>r.registrationPinHash).id})).status,200);
 assert.equal(logic.hydrateTournament(next).registrations.length,kept.length);
 assert.equal((await post({action:'resetRegistrations',confirmation:'RESET',expectedRevision:saved.revision},org)).status,200);
 next=JSON.parse(saved.payload);assert.equal(next.registrations.length,0);assert.equal(next.matches.length,0);assert.ok(next.divisions.every(d=>d.entries.length===0));assert.equal(next.organizerPinHash,current.organizerPinHash);assert.equal(next.status,current.status);
 assert.equal((await post({action:'lookupRegistration',pin:first.editPin})).status,401);
});


test('each player needs Facebook and phone contacts; old level restrictions no longer apply', async()=>{
 const state=await reset();const id=state.divisions[0].id;
 state.divisions[0].allowedDesiredLevels=['Pro'];saved.payload=JSON.stringify(state);
 for(const patch of [{club:''},{partnerClub:''},{facebookProfile:''},{phone:''},{partnerFacebookProfile:''},{partnerPhone:''},{facebookProfile:'https://facebook.com.evil.test/person'},{phone:'abc'},{facebookProfile:'javascript:alert(1)'}]) {
  assert.equal((await post(create(id,patch))).status,400);
 }
 assert.equal(JSON.parse(saved.payload).registrations.length,0);
 const response=await post(create(id));assert.equal(response.status,200);
 const result=await response.json();assert.equal(result.registration.desiredLevel,'');
 assert.equal(result.registration.partnerFacebookProfile,'https://www.facebook.com/sam.test');
 const publicResult=await (await api.GET(new Request('https://test/api/state'))).json();
 assert.doesNotMatch(JSON.stringify(publicResult),/alex.test|sam.test|09123456789/);
 const organizer=await (await api.GET(new Request('https://test/api/state',{headers:org}))).json();
 assert.equal(organizer.state.registrations[0].phone,'09123456789');
});

test('combined entries reuse same-player contacts and require separate new-partner contacts',async()=>{
 let state=await reset();state=logic.addDivision(state);saved.payload=JSON.stringify(state);
 const id=state.divisions[0].id, secondId=state.divisions[1].id;
 const same={divisionId:secondId,samePartner:true,secondShirt:'black',partnerSecondShirt:'tournament'};
 const result=await (await post(create(id,{secondEntry:same}))).json();
 let records=JSON.parse(saved.payload).registrations;
 assert.equal(records.length,4);
 assert.equal(records[0].facebookProfile,records[2].facebookProfile);
 assert.equal(records[1].phone,records[3].phone);
 const second=result.registrations.find(r=>r.divisionId===secondId);
 assert.equal((await post({action:'updateRegistration',pin:result.editPin,registrationId:second.id,registration:{phone:'+639998887777',partnerFacebookProfile:'https://facebook.com/new.sam'}})).status,200);
 records=JSON.parse(saved.payload).registrations;
 assert.equal(records[0].phone,'+639998887777');assert.equal(records[2].phone,'+639998887777');
 assert.equal(records[1].facebookProfile,'https://facebook.com/new.sam');assert.equal(records[3].facebookProfile,'https://facebook.com/new.sam');
 const different={divisionId:secondId,samePartner:false,partnerName:'Morgan',partnerClub:'Other Club',secondShirt:'tournament'};
 assert.equal((await post(create(id,{secondEntry:different}))).status,400);
 const response=await post(create(id,{secondEntry:{...different,partnerFacebookProfile:'https://facebook.com/morgan',partnerPhone:'09111222333'}}));
 assert.equal(response.status,200);const savedResult=await response.json();
 const newPartner=JSON.parse(saved.payload).registrations.find(r=>r.id===savedResult.registrations.find(r=>r.divisionId===secondId).partnerId);
 assert.equal(newPartner.facebookProfile,'https://facebook.com/morgan');assert.equal(newPartner.phone,'09111222333');
});

test('later second entries reuse saved contacts and legacy registrations can supply missing contacts',async()=>{
 const state=await reset();const id=state.divisions[0].id;
 const first=await (await post(create(id))).json();
 const request={action:'registerPlayer',pin:first.editPin,registration:{divisionId:id,name:'Alex',partnerName:'Sam',sourceRegistrationId:first.registration.id,samePartner:true,secondShirt:'black',partnerSecondShirt:'black'}};
 const different={...request,registration:{...request.registration,samePartner:false,partnerName:'New partner'}};
 assert.equal((await post(different)).status,400);
 const response=await post(request);assert.equal(response.status,200);
 assert.equal((await response.json()).registration.partnerPhone,'+639123456780');
 const current=JSON.parse(saved.payload);for(const r of current.registrations){delete r.phone;delete r.facebookProfile;}saved.payload=JSON.stringify(current);
 assert.equal((await post({action:'updateRegistration',pin:first.editPin,registration:{club:'Club'}})).status,400);
 assert.equal((await post({action:'updateRegistration',pin:first.editPin,registration:{facebookProfile:'https://facebook.com/alex',phone:'09123456789',partnerFacebookProfile:'https://facebook.com/sam',partnerPhone:'09123456780'}})).status,200);
 assert.ok(JSON.parse(saved.payload).registrations.every(r=>r.phone && r.facebookProfile));
});

test('setup stays editable during registration and setup/registration lock during live until phase is reopened',async()=>{
 let state=await reset();const id=state.divisions[0].id;
 await post(create(id));state=JSON.parse(saved.payload);
 const save=async next=>api.PUT(request({state:next,expectedRevision:saved.revision},org,'PUT'));
 state.tournamentName='Updated while registration open';state.venue='  Cebu Sports Center  ';assert.equal((await save(state)).status,200);
 assert.equal(JSON.parse(saved.payload).venue,'Cebu Sports Center');
 const publicVenue=await (await api.GET(new Request('https://test/api/state'))).json();assert.equal(publicVenue.state.venue,'Cebu Sports Center');
 state=JSON.parse(saved.payload);state.status='live';assert.equal((await save(state)).status,200);
 assert.equal((await post(create(id),org)).status,423);
 assert.equal((await post({action:'resetRegistrations',confirmation:'RESET',expectedRevision:saved.revision},org)).status,423);
 state=JSON.parse(saved.payload);
 assert.equal((await save({...state,tournamentName:'Blocked'})).status,423);
 assert.equal((await save({...state,venue:'Different venue'})).status,423);
 assert.equal((await save({...state,registrations:[]})).status,423);
 // Organizer responses omit PIN recovery, and a phase-only save must still succeed.
 const safe=await (await api.GET(new Request('https://test/api/state',{headers:org}))).json();
 assert.equal((await save({...safe.state,status:'registration'})).status,200);
 state=JSON.parse(saved.payload);state.startDate='2027-05-01';assert.equal((await save(state)).status,200);
});

test('public spectator data stays hidden before live while staff preview and live results remain available',async()=>{
 let state=await reset();await post(create(state.divisions[0].id));await post(create(state.divisions[0].id,{name:'Other',partnerName:'Player'}));
 state=logic.regenerateMatches(JSON.parse(saved.payload));state.umpirePinHash=await hash('87654321');saved.payload=JSON.stringify(state);
 const get=async headers=>(await (await api.GET(new Request('https://test/api/state',{headers}))).json()).state;
 const pre=await get({});assert.equal(pre.matches.length,0);assert.ok(pre.divisions.every(d=>d.entries.length===0));
 const staff=await get({'x-umpire-pin':'87654321'});assert.ok(staff.matches.length>0);assert.ok(staff.divisions[0].entries.length>0);assert.equal(staff.registrations.length,0);
 state.status='live';saved.payload=JSON.stringify(state);const live=await get({});assert.ok(live.matches.length>0);assert.ok(live.divisions[0].entries.length>0);
 assert.equal(logic.tournamentStartTime({startDate:'2026-10-01',dayStart:'08:30'}),Date.parse('2026-10-01T00:30:00Z'));
 assert.ok(Number.isNaN(logic.tournamentStartTime({startDate:'',dayStart:''})));
});

test('server rejects scores beyond stage rules and additions after a winning score',async()=>{
 let state=await reset();const d=state.divisions[0];d.registrationManaged=false;d.entries=[logic.makeEntry(0,'doubles'),logic.makeEntry(1,'doubles')];d.stageScoring={regular:{mode:'first_to_target',target:21,cap:21}};state=logic.regenerateMatches(state);saved.payload=JSON.stringify(state);const m=state.matches[0];
 const score=(a,b)=>api.PATCH(request({matchId:m.id,pin:m.pin,sets:[{a,b,complete:false}]},org,'PATCH'));
 assert.equal((await score(22,20)).status,400);assert.equal((await score(21,21)).status,400);assert.equal((await score(21,20)).status,200);assert.equal((await score(21,21)).status,400);assert.equal((await score(20,20)).status,200);
});

test('court occupancy starts on match access, releases per set and rejects simultaneous use',async()=>{
 const state=await reset();state.status='live';
 const match=(id,pin,format)=>({id,pin,divisionId:state.divisions[0].id,stage:'regular',round:1,label:id,entryAId:'a',entryBId:'b',sets:Array.from({length:format==='best_of_3_21'?3:1},()=>({a:0,b:0,complete:false})),status:'ready',court:1,scheduledAt:null,validated:false,format});
 state.matches=[match('first','1001','best_of_3_21'),match('second','1002','single_21')];saved.payload=JSON.stringify(state);
 const open=pin=>post({action:'verifyMatch',pin},org);
 const score=(id,pin,sets)=>api.PATCH(request({matchId:id,pin,sets},org,'PATCH'));
 const current=id=>JSON.parse(saved.payload).matches.find(m=>m.id===id);
 assert.equal((await open('1001')).status,200);assert.equal(current('first').status,'live');assert.equal(current('first').courtInUse,true);
 assert.equal((await open('1002')).status,409);
 let sets=current('first').sets;sets[0]={a:21,b:10,complete:false};assert.equal((await score('first','1001',sets)).status,200);assert.equal(current('first').courtInUse,true);
 sets[0].complete=true;assert.equal((await score('first','1001',sets)).status,200);assert.equal(current('first').courtInUse,false);
 assert.equal((await open('1002')).status,200);
 sets[1]={a:1,b:0,complete:false};assert.equal((await score('first','1001',sets)).status,409);
 assert.equal((await score('second','1002',[{a:21,b:8,complete:true}])).status,200);assert.equal(current('second').courtInUse,false);
 assert.equal((await score('first','1001',sets)).status,200);assert.equal(current('first').courtInUse,true);
 sets[1]={a:21,b:5,complete:true};assert.equal((await score('first','1001',sets)).status,200);assert.equal(current('first').courtInUse,false);
 assert.equal((await open('1001')).status,200);assert.equal(current('first').courtInUse,false);
});

test('court help is restricted to staff and an umpire can toggle only the court assigned to their match',async()=>{
 let state=await reset();state.umpirePinHash=await hash('87654321');const d=state.divisions[0];d.registrationManaged=false;d.entries=[logic.makeEntry(0,'doubles'),logic.makeEntry(1,'doubles')];state=logic.regenerateMatches(state);state.matches[0].court=1;saved.payload=JSON.stringify(state);const match=state.matches[0],ump={'x-umpire-pin':'87654321'};
 const body={action:'courtHelp',matchId:match.id,pin:match.pin,court:3,help:true};
 assert.equal((await post(body)).status,401);assert.equal((await post({...body,pin:'bad'},ump)).status,401);
 assert.equal((await post({...body,help:'yes'},ump)).status,400);
 assert.equal((await post(body,ump)).status,200);let current=JSON.parse(saved.payload);
 assert.ok(current.courtHelp[1]);assert.equal(current.courtHelp[3],undefined);assert.equal(current.staffNotifications.length,1);assert.equal(current.staffNotifications[0].kind,'help_requested');
 assert.equal((await post(body,ump)).status,200);assert.equal(JSON.parse(saved.payload).staffNotifications.length,1);
 assert.equal((await api.GET(new Request('https://test/api/state?staffUpdates=1'))).status,401);
 const publicData=await (await api.GET(new Request('https://test/api/state'))).json();assert.equal(publicData.state.courtHelp,undefined);assert.equal(publicData.state.staffNotifications,undefined);
 const staff=await (await api.GET(new Request('https://test/api/state?staffUpdates=1',{headers:ump}))).json();assert.ok(staff.courtHelp[1]);assert.deepEqual(staff.notifications,[]);
 const organizer=await (await api.GET(new Request('https://test/api/state?staffUpdates=1',{headers:org}))).json();assert.equal(organizer.notifications.length,1);
 assert.equal((await post({action:'courtHelp',court:1,help:false},org)).status,200);current=JSON.parse(saved.payload);assert.equal(current.courtHelp[1],undefined);assert.equal(current.staffNotifications.at(-1).kind,'help_cleared');
 assert.equal((await post(body,ump)).status,200);assert.equal((await post({...body,help:false},ump)).status,200);assert.equal(JSON.parse(saved.payload).courtHelp[1],undefined);
 assert.equal((await post({action:'courtHelp',court:state.courts+1,help:true},org)).status,400);
});

async function gameDayApiFixture(){
 let state=await reset();state.status='live';state.umpirePinHash=await hash('87654321');const d=state.divisions[0];d.registrationManaged=false;
 d.entries=Array.from({length:6},(_,i)=>({...logic.makeEntry(i,'doubles'),players:[`Player ${i}a`,`Player ${i}b`]}));state=logic.regenerateMatches(state);
 const base=state.matches.find(m=>m.stage==='regular');state.matches=[0,1,2].map(i=>({...base,id:`desk-${i}`,entryAId:d.entries[i*2].id,entryBId:d.entries[i*2+1].id,court:null,pin:`100${i}`,status:'ready',sets:[{a:0,b:0,complete:false}],scoring:{mode:'first_to_target',target:31,cap:31}}));
 state.gameDay={evenRotation:true,restMinutes:0,nearCapEnabled:true,nearCapPoints:5};saved.payload=JSON.stringify(state);return state;
}
test('game-day dispatch is organizer-only and atomically reserves courts without changing scores or PINs',async()=>{
 const state=await gameDayApiFixture();const body={action:'dispatchGame',matchId:state.matches[0].id,court:1,expectedRevision:1};
 assert.equal((await post(body)).status,401);assert.equal((await post(body,{'x-umpire-pin':'87654321'})).status,401);
 assert.equal((await post({...body,expectedRevision:0},org)).status,409);
 const assigned=await post(body,org);assert.equal(assigned.status,200);let current=(await assigned.json()).state;
 assert.equal(current.matches[0].court,1);assert.ok(current.matches[0].dispatchedAt);assert.equal(current.matches[0].courtInUse,false);assert.equal(current.matches[0].status,'ready');assert.equal(current.matches[0].pin,'1000');assert.deepEqual(current.matches[0].sets,state.matches[0].sets);
 assert.equal((await post({...body,matchId:state.matches[1].id,expectedRevision:saved.revision},org)).status,409);
 // A scheduled game cannot take a court reserved through the new dispatch action.
 current.matches[1].court=1;saved.payload=JSON.stringify(current);
 assert.equal((await post({action:'verifyMatch',pin:current.matches[1].pin},org)).status,409);
 assert.equal((await api.PATCH(request({matchId:current.matches[1].id,pin:current.matches[1].pin,sets:[{a:1,b:0,complete:false}]},org,'PATCH'))).status,409);
 const conflict=await api.PUT(request({state:{...current,matches:current.matches.map((m,i)=>i===1?{...m,status:'live',courtInUse:true}:m)},expectedRevision:saved.revision},org,'PUT'));assert.equal(conflict.status,409);const conflictData=await conflict.json();assert.equal(conflictData.conflictMatchId,current.matches[1].id);assert.equal(conflictData.revision,saved.revision);assert.deepEqual(conflictData.state.matches,current.matches);
 assert.equal((await post({action:'releaseGameCourt',matchId:current.matches[0].id,expectedRevision:saved.revision},org)).status,200);
 const released=JSON.parse(saved.payload).matches[0];assert.equal(released.court,null);assert.equal(released.dispatchedAt,undefined);assert.equal(released.pin,'1000');
});
test('two organizers assigning from the same revision cannot both reserve the same court',async()=>{
 const state=await gameDayApiFixture();const replies=await Promise.all(state.matches.slice(0,2).map(m=>post({action:'dispatchGame',matchId:m.id,court:1,expectedRevision:1},org)));
 assert.deepEqual(replies.map(r=>r.status).sort(),[200,409]);assert.equal(JSON.parse(saved.payload).matches.filter(m=>m.dispatchedAt&&m.court===1).length,1);
});
test('near-cap operations settings remain editable live and alerts persist once without leaking PINs publicly',async()=>{
 let state=await gameDayApiFixture();state.matches[0]={...state.matches[0],status:'live',court:1,courtInUse:true};saved.payload=JSON.stringify(state);
 const put=next=>api.PUT(request({state:next,expectedRevision:saved.revision},org,'PUT'));
 assert.equal((await put({...state,gameDay:{...state.gameDay,nearCapPoints:3}})).status,200);
 state=JSON.parse(saved.payload);assert.equal(state.gameDay.nearCapPoints,3);
 assert.equal((await put({...state,courts:state.courts+1})).status,423);
 const score=a=>api.PATCH(request({matchId:state.matches[0].id,pin:state.matches[0].pin,sets:[{a,b:20,complete:false}]},org,'PATCH'));
 assert.equal((await score(27)).status,200);assert.equal((JSON.parse(saved.payload).staffNotifications??[]).length,0);
 assert.equal((await score(28)).status,200);let current=JSON.parse(saved.payload);assert.equal(current.staffNotifications.length,1);assert.equal(current.staffNotifications[0].kind,'near_cap');assert.equal(current.staffNotifications[0].pointsRemaining,3);assert.ok(current.staffNotifications[0].nextMatchLabel.includes('Game 2'));
 assert.equal((await score(29)).status,200);assert.equal(JSON.parse(saved.payload).staffNotifications.length,1);
 const publicState=(await (await api.GET(new Request('https://test/api/state'))).json()).state;assert.equal(publicState.gameDay.nearCapPoints,3);assert.equal(publicState.staffNotifications,undefined);assert.ok(publicState.matches.every(m=>!m.pin));
});

test('completion alerts are durable, distinguish sets from games, and cannot be forged or removed by an organizer state save',async()=>{
 let state=await reset();state.status='live';const d=state.divisions[0];d.registrationManaged=false;d.entries=[logic.makeEntry(0,'doubles'),logic.makeEntry(1,'doubles')];state=logic.regenerateMatches(state);const match=state.matches[0];Object.assign(match,{court:1,courtInUse:true,status:'live',format:'best_of_3_21',scoring:{mode:'first_to_target',target:21,cap:21},sets:[{a:21,b:10,complete:false},{a:0,b:0,complete:false},{a:0,b:0,complete:false}]});saved.payload=JSON.stringify(state);
 const patch=sets=>api.PATCH(request({matchId:match.id,pin:match.pin,sets},org,'PATCH'));
 const set1=[{a:21,b:10,complete:true},{a:0,b:0,complete:false},{a:0,b:0,complete:false}];assert.equal((await patch(set1)).status,200);
 let current=JSON.parse(saved.payload);assert.equal(current.staffNotifications.length,1);assert.equal(current.staffNotifications[0].gameComplete,false);assert.equal(current.staffNotifications[0].available,true);assert.equal(current.staffNotifications[0].setNumber,1);
 assert.equal((await patch(set1)).status,200);assert.equal(JSON.parse(saved.payload).staffNotifications.length,1);
 assert.equal((await patch([{...set1[0]},{a:21,b:8,complete:false},{a:0,b:0,complete:false}])).status,200);
 assert.equal((await patch([{...set1[0]},{a:21,b:8,complete:true},{a:0,b:0,complete:false}])).status,200);
 current=JSON.parse(saved.payload);const completions=current.staffNotifications.filter(n=>n.kind==='court_released');assert.equal(completions.length,2);assert.equal(completions[1].gameComplete,true);assert.equal(current.staffNotifications.filter(n=>n.kind==='near_cap').length,1);
 assert.equal((await post({action:'courtHelp',court:1,help:true},org)).status,200);current=JSON.parse(saved.payload);
 const forged={...current,courtHelp:{},staffNotifications:[{id:'fake',kind:'help_requested',court:4}]};
 const put=await api.PUT(request({state:forged,expectedRevision:saved.revision},org,'PUT'));assert.equal(put.status,200);
 const after=JSON.parse(saved.payload);assert.deepEqual(after.courtHelp,current.courtHelp);assert.deepEqual(after.staffNotifications,current.staffNotifications);
 const updates=await (await api.GET(new Request('https://test/api/state?staffUpdates=1',{headers:org}))).json();assert.deepEqual(updates.notifications,current.staffNotifications);
});

test('organizer set completion generates the same alert and refresh, reset, and court assignment do not duplicate it',async()=>{
 let state=await reset();const d=state.divisions[0];d.registrationManaged=false;d.entries=[logic.makeEntry(0,'doubles'),logic.makeEntry(1,'doubles')];state=logic.regenerateMatches(state);const match=state.matches[0];Object.assign(match,{court:1,courtInUse:true,status:'live',format:'single_21',scoring:{mode:'first_to_target',target:21,cap:21},sets:[{a:21,b:9,complete:false}]});saved.payload=JSON.stringify(state);
 const put=state=>api.PUT(request({state,expectedRevision:saved.revision},org,'PUT'));
 assert.equal((await put({...state,matches:state.matches.map(m=>m.id===match.id?logic.completeMatchSet(m,0):m)})).status,200);
 let current=JSON.parse(saved.payload);assert.equal(current.staffNotifications.length,1);assert.equal(current.staffNotifications[0].gameComplete,true);
 assert.equal((await put(current)).status,200);assert.equal(JSON.parse(saved.payload).staffNotifications.length,1);
 current=JSON.parse(saved.payload);current.matches[0]={...current.matches[0],court:2,courtInUse:false,status:'ready',sets:[{a:0,b:0,complete:false}]};
 assert.equal((await put(current)).status,200);assert.equal(JSON.parse(saved.payload).staffNotifications.length,1);
});
