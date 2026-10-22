import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const dir=await mkdtemp(path.join(tmpdir(),'court-ocr-'));
for(const [name,entry] of [['receipt','lib/receipt-details.ts'],['details','lib/payment-details-server.ts'],['proof','lib/payment-proof-server.ts'],['court','lib/court-view.ts'],['tournament','lib/tournament.ts'],['batch','lib/receipt-batch.ts']]) await build({entryPoints:[entry],outfile:path.join(dir,`${name}.mjs`),bundle:true,platform:'node',format:'esm'});
await build({entryPoints:['app/api/courts/route.ts'],outfile:path.join(dir,'court-api.mjs'),bundle:true,platform:'node',format:'esm',plugins:[{name:'test-database',setup(build){build.onResolve({filter:/^cloudflare:workers$/},()=>({path:'mock',namespace:'mock'}));build.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const env={get DB(){return globalThis.__rackCourtTestEnv.DB;}};',loader:'js'}));}}]});
const load=name=>import(pathToFileURL(path.join(dir,`${name}.mjs`)));
const {extractReceipt,validReceipt,receiptAmount}=await load('receipt');
const {handlePaymentDetails}=await load('details');
const {handlePaymentProof}=await load('proof');
const {courtViewSnapshot,badmintonLines}=await load('court');
const {initialTournament}=await load('tournament');
const {readReceiptBatch}=await load('batch');
const courtApi=await load('court-api');
test.after(()=>rm(dir,{recursive:true,force:true}));
const digest=async value=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('hex');
const details={amount:'1250.00',reference:'001234567890',provider:'GCash',date:'2026-10-22'};
async function fixture(){
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE tournament_state (id TEXT PRIMARY KEY,payload TEXT,revision INTEGER,updated_at TEXT)');
 const state={...initialTournament(),status:'registration',organizerPinHash:await digest('12345678'),registrations:[{id:'a',paymentGroupId:'group-a',paid:false,registrationPinHash:await digest('87654321')},{id:'b',paymentGroupId:'group-a',paid:false},{id:'c',paymentGroupId:'group-c',paid:false}]};
 db.prepare('INSERT INTO tournament_state VALUES (?,?,?,?)').run('racketeers',JSON.stringify(state),1,new Date().toISOString());
 const objects=new Map([['payments/groups/group-a/group-a.png',{etag:'first',size:67,uploaded:new Date()}],['payments/groups/group-c/group-c.png',{etag:'other',size:67,uploaded:new Date()}]]);
 const env={DB:{prepare(sql){const statement=db.prepare(sql);const bound=(...values)=>({first:async()=>statement.get(...values)||null,run:async()=>({meta:{changes:Number(statement.run(...values).changes)}})});return {bind:bound,run:bound().run};}},PAYMENT_PROOFS:{head:async key=>objects.get(key)||null,get:async key=>objects.has(key)?{...objects.get(key),body:new Blob([key]).stream()}:null}};
 const req=(id='a',body,headers={'x-organizer-pin':'12345678'})=>new Request(`https://test/api/payment-details?registrationId=${id}`,{method:body?'POST':'GET',headers:{'content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
 const get=async(id='a')=>(await handlePaymentDetails(req(id),env)).json();
 const save=(record,id='a',patch={})=>handlePaymentDetails(req(id,{details,expectedRevision:record.revision,proofVersion:record.proofVersion,...patch}),env);
 return {db,state,objects,env,req,get,save};
}
test('OCR identifies transferred amount rather than fee/balance, retaining leading-zero references',()=>{
 const value=extractReceipt('GCash\nAmount Sent\nPHP 1,250.00\nFee 15.00\nTotal 1265.00\nBalance 9000.00\nReference No. 001234567890\n2026-10-22');
 assert.deepEqual(value.details,details);assert.deepEqual(value.warnings,[]);
 assert.equal(receiptAmount('₱ 1,250.5'),'1250.50');assert.equal(receiptAmount('1.234'),null);assert.equal(receiptAmount('-5.00'),null);
});
test('ambiguous or unlabeled fields stay empty; malformed dates/references reject',()=>{
 const result=extractReceipt('Maya\nAmount 100.00\nAmount 200.00\nPhone 09123456789');
 assert.equal(result.details.amount,'');assert.equal(result.details.reference,'');assert.equal(result.warnings.length,2);
 assert.equal(validReceipt({...details,date:'2026-02-30'}),false);assert.equal(validReceipt({...details,reference:'<script>'}),false);
});
test('receipt review requires organizer access, not registration ownership or a share parameter',async()=>{
 const f=await fixture();
 assert.equal((await handlePaymentDetails(f.req('a',null,{}),f.env)).status,401);
 assert.equal((await handlePaymentDetails(f.req('a',null,{'x-registration-pin':'87654321'}),f.env)).status,401);
 assert.equal((await handlePaymentDetails(f.req('a',null,{'x-organizer-pin':'11111111'}),f.env)).status,401);
 assert.equal(f.db.prepare("SELECT name FROM sqlite_master WHERE name='payment_receipt_details'").get(),undefined);f.db.close();
});
test('linked players share one reviewed payment without changing tournament state or paid flags',async()=>{
 const f=await fixture(), before=f.db.prepare('SELECT * FROM tournament_state').get();
 const initial=await f.get();assert.equal(initial.revision,0);
 const response=await f.save(initial);assert.equal(response.status,200);
 const linked=await f.get('b');assert.deepEqual(linked.details,details);assert.equal(linked.revision,1);assert.equal(linked.duplicateReference,false);
 assert.deepEqual(f.db.prepare('SELECT * FROM tournament_state').get(),before);
 assert.equal((await f.save(initial)).status,409);f.db.close();
});
test('duplicate references flag unrelated groups, not partners sharing a proof',async()=>{
 const f=await fixture();await f.save(await f.get());const other=await f.get('c');
 const saved=await f.save(other,'c',{details:{...details,reference:'0012 3456 7890'}});assert.equal(saved.status,200);assert.equal((await saved.json()).duplicateReference,true);
 assert.equal((await f.get('b')).duplicateReference,true);f.db.close();
});
test('replacement invalidates old OCR and rejects saving against the old screenshot',async()=>{
 const f=await fixture(), initial=await f.get();await f.save(initial);
 f.objects.get('payments/groups/group-a/group-a.png').etag='replaced';
 const latest=await f.get();assert.equal(latest.stale,true);assert.notEqual(latest.proofVersion,initial.proofVersion);
 assert.equal((await f.save({...initial,revision:1})).status,409);
 assert.equal((await f.save(latest)).status,200);assert.equal((await f.get()).stale,false);f.db.close();
});
test('two initial reviewers cannot overwrite each other',async()=>{
 const f=await fixture(), initial=await f.get();const results=await Promise.all([f.save(initial),f.save(initial)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);f.db.close();
});
test('new entries keep the existing payment-group review',async()=>{
 const f=await fixture();await f.save(await f.get());
 f.state.registrations.push({id:'0-new-entry',paymentGroupId:'group-a',paid:false});f.db.prepare('UPDATE tournament_state SET payload=?').run(JSON.stringify(f.state));
 assert.deepEqual((await f.get('0-new-entry')).details,details);assert.equal((await f.get('0-new-entry')).duplicateReference,false);f.db.close();
});
test('metadata version is private and stable for the same receipt across linked players',async()=>{
 const f=await fixture();const metadata=async id=>(await handlePaymentProof(new Request(`https://test/api/payment-proof?metadata=1&registrationId=${id}`,{headers:{'x-organizer-pin':'12345678'}}),f.env)).json();
 assert.equal((await metadata('a')).proofVersion,(await metadata('b')).proofVersion);f.db.close();
});
test('court snapshots gate pre-live data and never expose credentials or registration details',()=>{
 const state={...initialTournament(),courts:12,status:'registration',organizerPinHash:'private',registrations:[{name:'Private contact',phone:'secret'}],courtHelp:{1:{note:'staff-only'}}};
 const publicView=courtViewSnapshot(state);assert.deepEqual(publicView.courts,[]);
 const staffView=courtViewSnapshot(state,true);assert.equal(staffView.courts.length,12);assert.equal(staffView.organizerPinHash,undefined);assert.equal(staffView.registrations,undefined);assert.equal(staffView.courtHelp,undefined);assert.doesNotMatch(JSON.stringify(staffView),/secret|staff-only|private/);
 state.status='live';assert.equal(courtViewSnapshot(state).courts.length,12);
});

test('court API discards staff credentials and query parameters before deriving its public display',async()=>{
 const f=await fixture();globalThis.__rackCourtTestEnv=f.env;
 f.state.courts=12;f.db.prepare('UPDATE tournament_state SET payload=?').run(JSON.stringify(f.state));
 const request=()=>new Request('https://test/api/courts?staffUpdates=1',{headers:{'x-organizer-pin':'12345678','x-umpire-pin':'87654321'}});
 const before=f.db.prepare('SELECT * FROM tournament_state').get();
 const hidden=await courtApi.GET(request());assert.equal(hidden.status,200);assert.deepEqual((await hidden.json()).courts,[]);
 assert.deepEqual(f.db.prepare('SELECT * FROM tournament_state').get(),before);
 f.state.status='live';f.db.prepare('UPDATE tournament_state SET payload=?').run(JSON.stringify(f.state));
 const response=await courtApi.GET(request());assert.match(response.headers.get('cache-control'),/no-store/);
 const display=await response.json();assert.equal(display.courts.length,12);
 assert.deepEqual(Object.keys(display).sort(),['name','venue','theme','phase','courts','updatedAt'].sort());
 assert.doesNotMatch(JSON.stringify(display),/organizerPin|registrationPin|paymentGroup|registrations|12345678/);f.db.close();
});
test('badminton line geometry leaves forecourts undivided and includes rear doubles service lines',()=>{
 const centre=badmintonLines.filter(([x1,,x2])=>x1===0&&x2===0);assert.equal(centre.length,2);
 for(const [,z1,,z2] of centre){assert.ok(Math.min(Math.abs(z1),Math.abs(z2))>=1.98);assert.equal(Math.sign(z1),Math.sign(z2));}
 for(const z of [-5.94,5.94])assert.ok(badmintonLines.some(([x1,z1,x2,z2])=>x1===-3.05&&x2===3.05&&z1===z&&z2===z));
});

const candidates=[{id:'a',name:'Alex'},{id:'b',name:'Sam'},{id:'c',name:'Morgan'}];
async function scanFixture(f,patch={}){
 const results=[],issues=[],requests=[];let reads=0,closed=0;
 const request=async(url,init)=>{
  requests.push({url,method:init.method||'GET'});
  const req=new Request('https://test'+url,init);
  return url.startsWith('/api/payment-details')?handlePaymentDetails(req,f.env):handlePaymentProof(req,f.env);
 };
 const summary=await readReceiptBatch({candidates,pin:'12345678',signal:new AbortController().signal,
  request,reader:{read:async image=>{assert.match(await image.text(),/payments\/groups\//);reads++;return {details,warnings:[]};},close:async()=>{closed++;}},
  onResult:r=>results.push(r),onIssue:m=>issues.push(m),onProgress(){},...patch});
 return {summary,results,issues,requests,reads,closed};
}

test('batch reads shared proofs once across registrations and stages results without saving or marking paid',async()=>{
 const f=await fixture(),before=f.db.prepare('SELECT * FROM tournament_state').get();
 const value=await scanFixture(f,{candidates:[...candidates,{id:'missing',name:'No upload'}]});
 assert.equal(value.reads,2);assert.equal(value.closed,1);assert.equal(value.summary.read,2);assert.equal(value.summary.shared,1);assert.equal(value.summary.missing,1);
 assert.deepEqual(value.results.map(r=>r.label),['Alex / Sam','Morgan']);assert.equal(value.issues.length,0);
 assert.ok(value.requests.every(r=>r.method==='GET'));assert.ok(!value.requests.some(r=>r.url.includes('registrationId=b')));
 assert.equal(f.db.prepare('SELECT count(*) AS count FROM payment_receipt_details').get().count,0);
 assert.deepEqual(f.db.prepare('SELECT * FROM tournament_state').get(),before);
 assert.equal((await f.save(value.results[0].record)).status,200);
 assert.deepEqual(f.db.prepare('SELECT * FROM tournament_state').get(),before);f.db.close();
});

test('batch skips current saved reviews by default, rereads replacements, and permits explicit rereading',async()=>{
 const f=await fixture();await f.save(await f.get());
 const first=await scanFixture(f);assert.equal(first.reads,1);assert.equal(first.summary.reviewed,1);
 const all=await scanFixture(f,{includeReviewed:true});assert.equal(all.reads,2);
 f.objects.get('payments/groups/group-a/group-a.png').etag='new screenshot';
 const replaced=await scanFixture(f);assert.equal(replaced.reads,2);assert.equal(replaced.results[0].record.stale,true);
 const remaining=await scanFixture(f,{excludeGroups:replaced.results.map(r=>r.record.groupId)});assert.equal(remaining.reads,0);assert.equal(remaining.summary.shared,3);f.db.close();
});

test('batch discards OCR if a screenshot is replaced or a review is saved during recognition',async()=>{
 for(const change of ['photo','review']){
  const f=await fixture();let closed=0,reads=0;
  const value=await scanFixture(f,{reader:{read:async()=>{if(++reads===1){if(change==='photo')f.objects.get('payments/groups/group-a/group-a.png').etag='replaced';else await f.save(await f.get());}return {details,warnings:[]};},close:async()=>{closed++;}}});
  assert.equal(value.summary.failed,1);assert.equal(value.summary.read,1);assert.match(value.issues[0],/changed during reading/);
  assert.deepEqual(value.results.map(r=>r.registrationId),['c']);assert.equal(closed,1);f.db.close();
 }
});

test('stopping a batch settles an unfinished OCR job, retains completed results and closes its worker',async()=>{
 const f=await fixture(),controller=new AbortController();let reads=0,closed=0;
 const value=await scanFixture(f,{signal:controller.signal,reader:{read:async()=>{if(++reads===1)return {details,warnings:[]};controller.abort();return new Promise(()=>{});},close:async()=>{closed++;}}});
 assert.equal(value.summary.stopped,true);assert.equal(value.summary.read,1);assert.equal(closed,1);assert.equal(value.issues.length,0);assert.equal(value.results[0].registrationId,'a');f.db.close();
});

test('batch failures stop promptly on expired access, throttling or unavailable storage without recording reviews',async()=>{
 for(const status of [401,403,429,503]){
  const f=await fixture();let requests=0;
  const value=await scanFixture(f,{request:async()=>{requests++;return Response.json({error:'test failure'},{status});}});
  assert.equal(value.summary.stopped,true);assert.equal(value.summary.failed,1);assert.equal(value.closed,1);assert.equal(requests,1);assert.equal(value.reads,0);
  assert.equal(f.db.prepare("SELECT name FROM sqlite_master WHERE name='payment_receipt_details'").get(),undefined);f.db.close();
 }
 const f=await fixture();const invalid=await scanFixture(f,{pin:'99999999'});assert.equal(invalid.summary.stopped,true);assert.equal(invalid.results.length,0);assert.equal(invalid.reads,0);f.db.close();
 const engineFixture=await fixture();let reads=0,closed=0;
 const engine=await scanFixture(engineFixture,{reader:{read:async()=>{reads++;const error=new Error('OCR unavailable');error.name='ReceiptEngineError';throw error;},close:async()=>{closed++;}}});
 assert.equal(engine.summary.stopped,true);assert.equal(reads,1);assert.equal(closed,1);engineFixture.db.close();
});

test('an unreadable image does not block another payment group and a later save still rejects a changed proof',async()=>{
 const f=await fixture();let reads=0;
 const value=await scanFixture(f,{reader:{read:async()=>{if(++reads===1)throw new Error('Unreadable image');return {details,warnings:['Check amount']};},close:async()=>{}}});
 assert.equal(value.summary.stopped,false);assert.equal(value.summary.failed,1);assert.equal(value.results.length,1);assert.deepEqual(value.results[0].warnings,['Check amount']);
 f.objects.get('payments/groups/group-c/group-c.png').etag='replaced after reading';
 assert.equal((await f.save(value.results[0].record,'c')).status,409);
 assert.equal(f.db.prepare('SELECT count(*) AS count FROM payment_receipt_details').get().count,0);f.db.close();
});
