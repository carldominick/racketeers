import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(path.join(tmpdir(),'site-improvements-'));
const modules={};
for(const name of ['organizer-safety','organizer-save','registration-pricing','registration-draft','payment-review-queue','desk-readiness','tournament']) {
 await build({entryPoints:[`lib/${name}.ts`],outfile:path.join(dir,`${name}.mjs`),bundle:true,platform:'node',format:'esm'});
 modules[name]=await import(pathToFileURL(path.join(dir,`${name}.mjs`)));
}
test.after(()=>rm(dir,{recursive:true,force:true}));
const logic=modules.tournament,pricing=modules['registration-pricing'],queue=modules['payment-review-queue'];
const match={id:'m',status:'ready',sets:[{a:0,b:0,complete:false}],validated:false,court:null};
test('regeneration blocks results, started play and active phases even after returning to Setup',()=>{
 const {regenerationIssue}=modules['organizer-safety'];const state={...logic.initialTournament(),matches:[match]};
 assert.equal(regenerationIssue(state),null);
 for(const change of [{status:'live'},{status:'finished'},{validated:true},{forfeit:{winnerId:'a'}},{completedAt:'2026-01-01'},{courtInUse:true},{sets:[{a:1,b:0,complete:false}]},{sets:[{a:0,b:0,complete:true}]}])assert.ok(regenerationIssue({...state,matches:[{...match,...change}]}));
 for(const status of ['live','completed'])assert.ok(regenerationIssue({...state,status}));
 assert.equal(regenerationIssue({...state,matches:[{...match,court:2,scheduledAt:'2026-01-01'}]}),null);
});
test('a save conflict retains the complete local draft and never retries at the returned revision',async()=>{
 const local={...logic.initialTournament(),tournamentName:'Local draft'},remote={...local,tournamentName:'Other desk',registrations:[{id:'public-new',name:'Alex'}]};
 const original=structuredClone(local);let calls=0;
 const result=await modules['organizer-save'].writeOrganizerDraft(local,4,'test',async(_url,options)=>{calls++;assert.equal(JSON.parse(options.body).expectedRevision,4);return Response.json({state:remote,revision:5},{status:409});});
 assert.equal(calls,1);assert.equal(result.kind,'conflict');assert.deepEqual(result.state.registrations,remote.registrations);assert.deepEqual(local,original);
 assert.deepEqual(modules['organizer-safety'].conflictingSections(local,remote),['Tournament setup','Registrations']);
});
test('failed credentials, malformed responses and network errors do not acknowledge a save',async()=>{
 const save=modules['organizer-save'].writeOrganizerDraft,state=logic.initialTournament();
 for(const response of [Response.json({error:'Expired'},{status:401}),Response.json({state,revision:0}),new Response('{')])await assert.rejects(save(state,1,'test',async()=>response));
 await assert.rejects(save(state,1,'test',async()=>{throw new Error('Network');}));
 const later={...state,tournamentName:'newer local typing'};
 const result=await save(state,1,'test',async()=>Response.json({state,revision:2}));assert.equal(result.kind,'saved');assert.equal(later.tournamentName,'newer local typing');
});
const division={id:'d',name:'Open',registrationPricing:{entry:'900',additionalEntry:'500',tournamentShirt:'50.25',blackShirt:'0'}};
test('pricing totals people and entries in exact cents, including second entries and different partners',()=>{
 const first={name:'Alex',partnerName:'Sam',divisionId:'d'},second={...first,name:'Sam',partnerName:'Taylor',secondShirt:'black',partnerSecondShirt:'tournament',samePartner:false};
 const people=[...pricing.draftChargePeople(first,'doubles'),...pricing.draftChargePeople(second,'doubles')];
 assert.equal(pricing.registrationCharges([division],people).total,335075);
 assert.equal(pricing.registrationCharges([division],pricing.draftChargePeople({...second,samePartner:true},'doubles')).total,105025);
 assert.equal(pricing.draftChargePeople(first,'singles').length,1);
 assert.equal(pricing.registrationCharges([{id:'d'}],people).total,null);
 assert.equal(pricing.priceCents('0'),0);for(const value of ['-1','1.234','1e2','',null])assert.equal(pricing.priceCents(value),null);
});
test('new partner shirt choices remain blank and validation checks only participating players',()=>{
 const draft={name:'Alex',partnerName:'Sam',shirtSize:'',partnerShirtSize:''};const check=modules['registration-draft'].shirtDetailsError;
 assert.match(check(draft,'doubles'),/Alex/);assert.match(check({...draft,shirtSize:'M'},'doubles'),/Sam/);assert.equal(check({...draft,shirtSize:'M'},'singles'),null);
 assert.equal(modules['registration-draft'].partnerFields({}).partnerShirtSize,'');
});
test('hydration bounds eligibility and preserves valid configured prices without changing legacy fees',()=>{
 const state=logic.initialTournament();state.divisions[0].eligibilityHint='x'.repeat(400);state.divisions[0].registrationPricing={...division.registrationPricing,entry:'-20'};
 const hydrated=logic.hydrateTournament(state);assert.equal(hydrated.divisions[0].eligibilityHint.length,300);assert.equal(hydrated.divisions[0].registrationPricing.entry,'');assert.equal(hydrated.divisions[0].registrationPricing.additionalEntry,'500');assert.equal(logic.hydrateTournament(logic.initialTournament()).divisions[0].registrationPricing,undefined);
});
test('public registration contact keeps only bounded HTTPS links without credentials',()=>{
 const normalize=logic.registrationContactUrl;
 assert.equal(normalize(' https://example.com/contact '),'https://example.com/contact');
 for(const value of ['javascript:alert(1)','http://example.com','https://user:secret@example.com','https://example.com/'+ 'x'.repeat(500),null])assert.equal(normalize(value),'');
 const state={...logic.initialTournament(),registrationContactUrl:'https://example.com/contact'};
 assert.equal(logic.hydrateTournament(state).registrationContactUrl,state.registrationContactUrl);
 assert.equal(logic.setupConfiguration(state).registrationContactUrl,state.registrationContactUrl);
 assert.equal(logic.hydrateTournament({...state,registrationContactUrl:'javascript:alert(1)'}).registrationContactUrl,'');
});
test('approved second-entry prices distinguish no shirt and never discount D/E for opting out',()=>{
 const divisions=[{id:'de',name:'D/E',registrationPricing:{entry:'1500',additionalEntry:'1200',additionalEntryNoShirt:'1200',tournamentShirt:'0',blackShirt:''}},{id:'other',name:'Other',registrationPricing:{entry:'950',additionalEntry:'950',additionalEntryNoShirt:'800',tournamentShirt:'0',blackShirt:''}}];
 const total=(divisionId,secondShirt)=>pricing.registrationCharges(divisions,[{name:'Alex',divisionId,secondShirt}]).total;
 assert.equal(total('de'),150000);assert.equal(total('other'),95000);
 assert.equal(total('de','tournament'),120000);assert.equal(total('de','none'),120000);
 assert.equal(total('other','tournament'),95000);assert.equal(total('other','none'),80000);
 assert.equal(pricing.registrationCharges([{id:'other',registrationPricing:{additionalEntry:'950'}}],[{name:'Alex',divisionId:'other',secondShirt:'none'}]).total,null);
 const draft={name:'Alex',partnerName:'Sam',shirtSize:'',partnerShirtSize:'',secondShirt:'none',partnerSecondShirt:'none'};
 assert.equal(modules['registration-draft'].shirtDetailsError(draft,'doubles'),null);
 assert.match(modules['registration-draft'].shirtDetailsError({...draft,partnerSecondShirt:'tournament'},'doubles'),/Sam/);
});
const players=[{id:'a',name:'Alex',divisionId:'d',partnerId:'b',paymentGroupId:'g',paid:false},{id:'b',name:'Sam',divisionId:'d',partnerId:'a',paymentGroupId:'g',paid:false}];
const record={groupId:'g',details:{amount:'1900.50',reference:'00123',provider:'Bank',date:'2026-10-23',transferStatus:'pending'},revision:1,proofVersion:'p1',stale:false,reviewedAt:'2026-10-23',duplicateReference:false,linkedRegistrationIds:['a','b']};
test('payment filters distinguish missing proof, pending transfers, stale reviews, mismatches and duplicates',()=>{
 const item={registrationId:'a',ids:['a','b'],record};
 assert.deepEqual(queue.paymentExceptions(item,[division],players),['pending','unconfirmed']);
 assert.deepEqual(queue.paymentExceptions({...item,record:null},[division],players),['missing','unconfirmed']);
 const changed={...item,record:{...record,stale:true,duplicateReference:true,details:{...record.details,date:'',amount:'10'}}};
 const issues=queue.paymentExceptions(changed,[division],players);for(const key of ['review','pending','date','amount','duplicate','unconfirmed'])assert.ok(issues.includes(key));
 assert.ok(!queue.paymentExceptions({...item,record:{...record,details:{...record.details,amount:'10'}}},[{id:'d'}],players).includes('amount'));
});
test('queue reads each linked group once and missing uploads are grouped without swallowing authorization failures',async()=>{
 let calls=0;const loaded=await queue.loadPaymentQueue(players,'test',new AbortController().signal,async()=>{calls++;return Response.json(record);});assert.equal(calls,1);assert.equal(loaded.length,1);
 const missing=await queue.loadPaymentQueue(players,'test',new AbortController().signal,async()=>Response.json({},{status:404}));assert.equal(missing.length,1);assert.deepEqual(missing[0].ids,['a','b']);
 await assert.rejects(queue.loadPaymentQueue(players,'test',new AbortController().signal,async()=>Response.json({},{status:401})),/access expired/);
});
test('Game Day checks use actual reservations and completed results, not planned schedule assignments',()=>{
 const state={matches:[{...match,id:'planned',court:1,scheduledAt:'2026-10-23'},{...match,id:'reserved',court:2,dispatchedAt:'2026-10-23'},{...match,id:'held',hold:{reason:'late'}},{...match,id:'forfeit',status:'finished',forfeit:{winnerId:'a'}},{...match,id:'done',status:'finished',validated:true}]};
 const checks=modules['desk-readiness'].deskReadiness(state);assert.deepEqual(checks.reserved.map(m=>m.id),['reserved']);assert.deepEqual(checks.held.map(m=>m.id),['held']);assert.deepEqual(checks.validations.map(m=>m.id),['forfeit']);assert.deepEqual(checks.noShows.map(m=>m.id),['forfeit']);
});
