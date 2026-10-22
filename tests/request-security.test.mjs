import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
const dir=await mkdtemp(path.join(tmpdir(),'security-'));
await build({entryPoints:['lib/request-security.ts'],outfile:path.join(dir,'security.mjs'),bundle:true,platform:'node',format:'esm'});
const {protectedRequest,PUBLIC_REGISTRATION_LIMIT,PUBLIC_REGISTRATION_ATTEMPTS}=await import(pathToFileURL(path.join(dir,'security.mjs')));
await build({entryPoints:['app/api/state/route.ts'],outfile:path.join(dir,'state.mjs'),bundle:true,platform:'node',format:'esm',plugins:[{name:'test-database',setup(build){build.onResolve({filter:/^cloudflare:workers$/},()=>({path:'mock',namespace:'mock'}));build.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const env={get DB(){return globalThis.__rackSecurityDB;}};',loader:'js'}));}}]});
await build({entryPoints:['lib/tournament.ts'],outfile:path.join(dir,'tournament.mjs'),bundle:true,platform:'node',format:'esm'});
const api=await import(pathToFileURL(path.join(dir,'state.mjs')));
const {initialTournament}=await import(pathToFileURL(path.join(dir,'tournament.mjs')));
const databases=[];
test.after(async()=>{databases.forEach(db=>db.close());await rm(dir,{recursive:true,force:true});});
function database() {
 const sqlite=new DatabaseSync(':memory:');databases.push(sqlite);
 sqlite.exec('CREATE TABLE tournament_state (id TEXT PRIMARY KEY,payload TEXT,revision INTEGER,updated_at TEXT)');
 return {sqlite,prepare(sql){const statement=sqlite.prepare(sql);const bound=(...args)=>({first:async()=>statement.get(...args)||null,run:async()=>({meta:{changes:Number(statement.run(...args).changes)}})});return {bind:bound,run:bound().run};}};
}
const hash=async value=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('hex');
const registration=(headers={},body={},url='/api/state',method='POST')=>new Request('https://test'+url,{method,headers:{'content-type':'application/json','cf-connecting-ip':'203.0.113.4',...headers},body:JSON.stringify({action:'registerPlayer',...body})});
async function quota(db,prefix,count){await protectedRequest(registration(),db,async()=>new Response('{}',{status:400}));db.sqlite.prepare('INSERT INTO request_limits VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET count=excluded.count,expires=excluded.expires').run(prefix+':'+await hash('203.0.113.4'),count,Date.now()+900000);}
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

test('shared-network registrations exceed 30; validation/conflict/locked/server retries refund success slots',async()=>{
 const db=database();
 for(const status of [400,409,423,503])for(let i=0;i<40;i++)assert.equal((await protectedRequest(registration(),db,async()=>new Response('{}',{status}))).status,status);
 for(let i=0;i<50;i++)assert.equal((await protectedRequest(registration(),db,async()=>new Response('{}'))).status,200);
 assert.equal(db.sqlite.prepare("SELECT count FROM request_limits WHERE id LIKE 'registration-success:%'").get().count,50);
 assert.equal(db.sqlite.prepare("SELECT count FROM request_limits WHERE id LIKE 'auth:%'").get(),undefined);
});

test('public success admission is atomic and bounded, with a separate attempt ceiling',async()=>{
 const db=database();let calls=0;
 const responses=await Promise.all(Array.from({length:PUBLIC_REGISTRATION_LIMIT+20},()=>protectedRequest(registration(),db,async()=>{calls++;return new Response('{}');})));
 assert.equal(calls,PUBLIC_REGISTRATION_LIMIT);assert.equal(responses.filter(r=>r.status===429).length,20);
 await quota(db,'registration-attempts',PUBLIC_REGISTRATION_ATTEMPTS);
 db.sqlite.prepare("UPDATE request_limits SET count=0 WHERE id LIKE 'registration-success:%'").run();
 const blocked=await protectedRequest(registration(),db,async()=>{throw new Error('must not execute');});assert.equal(blocked.status,429);assert.match(await blocked.text(),/registration attempts/);
 assert.equal(blocked.headers.get('retry-after'),'900');assert.equal(blocked.headers.get('cache-control'),'private, no-store');
});

test('verified organizer bypasses exhausted public quotas; forged and empty organizer headers do not',async()=>{
 const db=database();db.sqlite.prepare('INSERT INTO tournament_state VALUES (?,?,1,?)').run('racketeers',JSON.stringify({organizerPinHash:await hash('12345678')}),new Date().toISOString());
 await quota(db,'registration-success',PUBLIC_REGISTRATION_LIMIT);await quota(db,'registration-attempts',PUBLIC_REGISTRATION_ATTEMPTS);
 for(let i=0;i<40;i++)assert.equal((await protectedRequest(registration({'x-organizer-pin':'12345678'}),db,async()=>new Response('{}'))).status,200);
 for(const pin of ['','99999999'])assert.equal((await protectedRequest(registration({'x-organizer-pin':pin}),db,async()=>{throw new Error('must not execute');})).status,401);
 for(const header of ['x-umpire-pin','x-registration-pin'])assert.equal((await protectedRequest(registration({[header]:'12345678'}),db,async()=>{throw new Error('must not execute');})).status,429);
});

test('second-entry PIN failures and spoofed actions retain the independent 15-failure credential limit',async()=>{
 for(const [url,method] of [['/api/state','POST'],['/api/state','PUT'],['/api/payment-proof','POST']]){
  const db=database();
  for(let i=0;i<15;i++)assert.equal((await protectedRequest(registration({}, {pin:'00000000',registration:{sourceRegistrationId:'source'}},url,method),db,async()=>new Response('{}',{status:401}))).status,401);
  assert.equal((await protectedRequest(registration({}, {pin:'00000000',registration:{sourceRegistrationId:'source'}},url,method),db,async()=>{throw new Error('must not execute');})).status,429);
  // New public entries are not locked out by another person's bad PIN attempts.
  assert.equal((await protectedRequest(registration(),db,async()=>new Response('{}'))).status,200);
 }
});

test('encoded and trailing-slash registration paths cannot evade admission or origin checks',async()=>{
 const db=database();await quota(db,'registration-success',PUBLIC_REGISTRATION_LIMIT);
 for(const url of ['/api/state/','/api/%73tate','/%61pi/state','/api//state'])assert.equal((await protectedRequest(registration({}, {},url),db,async()=>{throw new Error('must not execute');})).status,429);
 assert.equal((await protectedRequest(registration({origin:'https://evil.test'}, {},'/%61pi/state'),db,async()=>{throw new Error('must not execute');})).status,403);
});

test('expired windows reset and accounting never changes a committed response into a failure',async()=>{
 const db=database();await quota(db,'registration-success',PUBLIC_REGISTRATION_LIMIT);
 db.sqlite.prepare('UPDATE request_limits SET expires=?').run(Date.now()-1);
 assert.equal((await protectedRequest(registration(),db,async()=>new Response('{}'))).status,200);
 const original=db.prepare.bind(db);let committed=false;
 db.prepare=sql=>{if(committed)throw new Error('simulated accounting outage');return original(sql);};
 assert.equal((await protectedRequest(registration(),db,async()=>{committed=true;return new Response('{}');})).status,200);
});

async function tournamentFixture(status='registration'){
 const db=database();globalThis.__rackSecurityDB=db;
 const state={...initialTournament(),status,organizerPinHash:await hash('12345678')};
 db.sqlite.prepare('INSERT INTO tournament_state VALUES (?,?,1,?)').run('racketeers',JSON.stringify(state),new Date().toISOString());
 const create=(index=0,headers={})=>registration(headers,{registration:{divisionId:state.divisions[0].id,name:`Alex ${index}`,partnerName:`Sam ${index}`,club:'Test club',partnerClub:'Test club',facebookProfile:`https://www.facebook.com/alex${index}.test`,partnerFacebookProfile:`https://www.facebook.com/sam${index}.test`,phone:'09123456789',partnerPhone:'09123456780'}});
 const submit=req=>protectedRequest(req,db,api.POST);
 return {db,state,create,submit};
}

test('actual registration handler admits shared-network traffic and retains phase and organizer authorization',async()=>{
 const {db,create,submit}=await tournamentFixture();
 for(let i=0;i<35;i++)assert.equal((await submit(create(i))).status,200);
 assert.equal(JSON.parse(db.sqlite.prepare('SELECT payload FROM tournament_state').get().payload).registrations.length,70);
 await quota(db,'registration-success',PUBLIC_REGISTRATION_LIMIT);await quota(db,'registration-attempts',PUBLIC_REGISTRATION_ATTEMPTS);
 assert.equal((await submit(create(40))).status,429);
 assert.equal((await submit(create(40,{'x-organizer-pin':'12345678'}))).status,200);
 assert.equal((await api.POST(create(41,{'x-organizer-pin':'99999999'}))).status,401);
 const saved=JSON.parse(db.sqlite.prepare('SELECT payload FROM tournament_state').get().payload);saved.status='live';
 db.sqlite.prepare('UPDATE tournament_state SET payload=?').run(JSON.stringify(saved));
 assert.equal((await submit(create(41,{'x-organizer-pin':'12345678'}))).status,423);
});

test('PNG-tagged JSON cannot bypass actual registration admission; binary upload bodies remain intact',async()=>{
 const {db,create,submit}=await tournamentFixture();await quota(db,'registration-success',PUBLIC_REGISTRATION_LIMIT);await quota(db,'registration-attempts',PUBLIC_REGISTRATION_ATTEMPTS);
 const before=db.sqlite.prepare('SELECT payload,revision FROM tournament_state').get();
 for(const url of ['/api/state','/api/state/','/api/%73tate','/%61pi/state']){
  const original=create(0,{'content-type':'image/png'});
  const response=await submit(new Request('https://test'+url,original));assert.equal(response.status,415);
 }
 assert.deepEqual(db.sqlite.prepare('SELECT payload,revision FROM tournament_state').get(),before);
 const bytes=new Uint8Array([137,80,78,71,13,10,26,10]);
 for(const endpoint of ['payment-proof','payment-settings','sponsors'])assert.equal((await protectedRequest(new Request('https://test/api/'+endpoint,{method:'POST',headers:{'content-type':'image/png'},body:bytes}),db,async req=>{assert.deepEqual(new Uint8Array(await req.arrayBuffer()),bytes);return new Response('{}');})).status,200);
});

test('organizer PIN rotation between admission and registration cannot fall back to public creation',async()=>{
 const {db,create}=await tournamentFixture();
 const before=db.sqlite.prepare('SELECT payload FROM tournament_state').get();
 const response=await protectedRequest(create(0,{'x-organizer-pin':'12345678'}),db,async req=>{
  const state=JSON.parse(before.payload);state.organizerPinHash=await hash('87654321');
  db.sqlite.prepare('UPDATE tournament_state SET payload=?,revision=revision+1').run(JSON.stringify(state));
  return api.POST(req);
 });
 assert.equal(response.status,401);assert.equal(JSON.parse(db.sqlite.prepare('SELECT payload FROM tournament_state').get().payload).registrations.length,0);
});

test('concurrent actual registrations retain CAS conflict protection and refund the unsuccessful slot',async()=>{
 const {db,create,submit}=await tournamentFixture();
 const responses=await Promise.all([submit(create(1)),submit(create(2))]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
 assert.equal(JSON.parse(db.sqlite.prepare('SELECT payload FROM tournament_state').get().payload).registrations.length,2);
 assert.equal(db.sqlite.prepare("SELECT count FROM request_limits WHERE id LIKE 'registration-success:%'").get().count,1);
});

test('actual linked-entry failures keep PIN protection without locking out fresh public registrations',async()=>{
 const {db,create,submit}=await tournamentFixture();
 const first=await (await submit(create())).json();
 const body=await create(1).json();body.pin='00000000';body.registration.sourceRegistrationId=first.registration.id;
 for(let i=0;i<15;i++)assert.equal((await submit(registration({},body))).status,401);
 body.pin=first.editPin;
 assert.equal((await submit(registration({},body))).status,429);
 assert.equal((await submit(create(2))).status,200);
 assert.equal(JSON.parse(db.sqlite.prepare('SELECT payload FROM tournament_state').get().payload).registrations.length,4);
 assert.equal(db.sqlite.prepare("SELECT count FROM request_limits WHERE id LIKE 'registration-success:%'").get().count,2);
});
