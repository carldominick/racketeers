import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(path.join(tmpdir(),'organizer-accounts-'));
await build({entryPoints:['lib/organizer-accounts.ts'],outfile:path.join(dir,'accounts.mjs'),bundle:true,platform:'node',format:'esm'});
const {handleAccounts,organizerRequestMatches,auditedOrganizerRequest,passwordHash,passwordMatches}=await import(pathToFileURL(path.join(dir,'accounts.mjs')));
const databases=[];
test.after(async()=>{databases.forEach(db=>db.close());await rm(dir,{recursive:true,force:true});});
function fixture(){const sql=new DatabaseSync(':memory:');databases.push(sql);sql.exec('CREATE TABLE tournament_state(id TEXT PRIMARY KEY,payload TEXT,revision INTEGER,updated_at TEXT)');const db={prepare(query){const statement=sql.prepare(query);const bound=(...args)=>({first:async()=>statement.get(...args)||null,runSync:()=>({meta:{changes:Number(statement.run(...args).changes)}}),run:async()=>({meta:{changes:Number(statement.run(...args).changes)}})});return {...bound(),bind:bound};},async batch(statements){sql.exec('BEGIN');try{const result=statements.map(s=>s.runSync());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};return {db,sql};}
const request=(body,cookie='',pin='')=>new Request('https://test/api/organizers',{method:'POST',headers:{'content-type':'application/json',cookie,...(pin?{'x-organizer-pin':pin}:{})},body:JSON.stringify(body)});
async function activated(){const f=fixture();const pin='87654321';const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pin))).toString('hex');f.sql.prepare('INSERT INTO tournament_state VALUES (?,?,1,?)').run('racketeers',JSON.stringify({organizerPinHash:hash,registrations:[],matches:[]}),new Date().toISOString());const result=await handleAccounts(request({action:'activate'},'',pin),f.db);assert.equal(result.status,200);const {credentials}=await result.json();return {...f,pin,credentials,state:()=>JSON.parse(f.sql.prepare('SELECT payload FROM tournament_state').get().payload)};}
async function login(f,username,password){const response=await handleAccounts(request({action:'login',username,password}),f.db);return {response,cookie:response.headers.get('set-cookie')?.split(';')[0]||'',data:await response.json()};}

test('audit history describes a shared payment update and translates older request labels', async () => {
 const f = await activated();
 const organizer = f.credentials[0];
 const initial = await login(f, organizer.username, organizer.password);
 const password = 'replacement shared payment password';
 assert.equal((await handleAccounts(request({action:'update',currentPassword:organizer.password,password}, initial.cookie), f.db)).status, 200);
 const {cookie} = await login(f, organizer.username, password);
 const registrations = [{id:'one',paid:false,phone:'private contact'}, {id:'two',paid:false}];
 const before = {...f.state(),registrations};
 const expectedRevision = f.sql.prepare('SELECT revision FROM tournament_state').get().revision;
 f.sql.prepare('UPDATE tournament_state SET payload=?').run(JSON.stringify(before));
 f.sql.prepare('INSERT INTO organizer_audit (user_id,username,happened_at,action,outcome) VALUES (?,?,?,?,?)')
  .run(initial.data.actor.id,organizer.username,new Date().toISOString(),'POST /api/state: releaseGameCourt','Succeeded');
 const state = {...before,registrations:registrations.map(player => ({...player,paid:true}))};
 const save = new Request('https://test/api/state', {method:'PUT',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({state,expectedRevision})});
 assert.equal((await auditedOrganizerRequest(save, f.db, async () => Response.json({ok:true}))).status, 200);
 const history = await handleAccounts(new Request('https://test/api/organizers?audit=1',{headers:{cookie}}), f.db);
 const {events} = await history.json();
 assert.equal(events[0].action, 'Confirm payment for 2 player entries');
 assert.equal(events[0].outcome, 'Succeeded');
 assert.equal(events[0].username, organizer.username);
 assert.equal(events[1].action, 'Release a court');
 assert.doesNotMatch(JSON.stringify(events), /private contact|releaseGameCourt|\/api\//);
});
test('passwords are salted, verify correctly and reject tampering',async()=>{const a=await passwordHash('a sufficiently long password'),b=await passwordHash('a sufficiently long password');assert.notEqual(a,b);assert.equal(await passwordMatches('a sufficiently long password',a),true);assert.equal(await passwordMatches('wrong',a),false);assert.equal(await passwordMatches('wrong','bad hash'),false);});
test('activation is one-time; first sign-in requires password change; PIN fallback is closed',async()=>{const f=await activated();assert.equal(f.credentials.length,4);assert.equal(new Set(f.credentials.map(c=>c.password)).size,4);assert.ok(f.credentials.every(c=>c.password.length>=32));assert.equal((await handleAccounts(request({action:'activate'},'',f.pin),f.db)).status,403);const carl=f.credentials.find(c=>c.username==='carl.taboada');const signed=await login(f,carl.username,carl.password);assert.equal(signed.response.status,200);assert.match(signed.response.headers.get('set-cookie'),/Secure; HttpOnly; SameSite=Strict/);assert.equal(signed.data.actor.must_change,1);assert.equal(await organizerRequestMatches(request({},signed.cookie,'session'),f.db,f.state()),false);assert.equal(await organizerRequestMatches(request({},'',f.pin),f.db,f.state()),false);const changed=await handleAccounts(request({action:'update',password:'new sufficiently long password',currentPassword:carl.password},signed.cookie),f.db);assert.equal(changed.status,200);assert.equal((await login(f,carl.username,carl.password)).response.status,401);const next=await login(f,carl.username,'new sufficiently long password');assert.equal(await organizerRequestMatches(request({},next.cookie,'session'),f.db,f.state()),true);assert.equal(await organizerRequestMatches(request({},signed.cookie,'session'),f.db,f.state()),false);assert.equal(await organizerRequestMatches(request({},next.cookie,''),f.db,f.state()),false);assert.doesNotMatch(JSON.stringify(next.data),/password_hash/);});
test('generic account can view history but cannot administer another user; managers reset without exposing hashes',async()=>{const f=await activated();async function ready(name){const c=f.credentials.find(c=>c.username===name),s=await login(f,name,c.password);const password='replacement sufficiently long password';assert.equal((await handleAccounts(request({action:'update',currentPassword:c.password,password},s.cookie),f.db)).status,200);return {...await login(f,name,password),password};}const generic=await ready('racketeers'),erin=await ready('erin.kizel');assert.equal(erin.data.actor.manager,1);assert.equal(generic.data.actor.manager,0);assert.equal((await handleAccounts(new Request('https://test/api/organizers?audit=1',{headers:{cookie:generic.cookie}}),f.db)).status,200);assert.equal((await handleAccounts(request({action:'reset',id:erin.data.actor.id,currentPassword:generic.password},generic.cookie),f.db)).status,403);const reset=await handleAccounts(request({action:'reset',id:generic.data.actor.id,currentPassword:erin.password},erin.cookie),f.db);assert.equal(reset.status,200);const data=await reset.json();assert.ok(data.initialPassword);assert.equal(await organizerRequestMatches(request({},generic.cookie,'session'),f.db,f.state()),false);const resetLogin=await login(f,'racketeers',data.initialPassword);assert.equal(resetLogin.data.actor.must_change,1);const audit=await handleAccounts(new Request('https://test/api/organizers?audit=1',{headers:{cookie:erin.cookie}}),f.db);const events=(await audit.json()).events;assert.ok(events.some(e=>e.username==='erin.kizel'&&e.action.includes('racketeers')));assert.ok(events.every(e=>!JSON.stringify(e).includes(erin.password)));});
test('audit intent is durable before writes, retains original usernames, and records rejected changes',async()=>{const f=await activated();const c=f.credentials[0],s=await login(f,c.username,c.password);await handleAccounts(request({action:'update',currentPassword:c.password,password:'long replacement password'},s.cookie),f.db);const signed=await login(f,c.username,'long replacement password');const req=new Request('https://test/api/state',{method:'PUT',headers:{cookie:signed.cookie,'x-organizer-pin':'session','content-type':'application/json'},body:JSON.stringify({state:{registrations:[{phone:'private contact'}]}})});let calls=0;const result=await auditedOrganizerRequest(req,f.db,async()=>{calls++;assert.ok(f.sql.prepare("SELECT id FROM organizer_audit WHERE outcome='Pending'").get());return Response.json({error:'conflict'},{status:409});});assert.equal(result.status,409);assert.equal(calls,1);const row=f.sql.prepare('SELECT * FROM organizer_audit ORDER BY id DESC LIMIT 1').get();assert.equal(row.username,c.username);assert.equal(row.outcome,'Rejected (409)');assert.doesNotMatch(JSON.stringify(row),/private contact|long replacement/);f.sql.exec('DROP TABLE organizer_audit');await assert.rejects(()=>auditedOrganizerRequest(req,f.db,async()=>{throw new Error('must not execute');}));});
test('persistent account admission caps distributed attempts and expired sessions cannot authorize',async()=>{const f=await activated(),c=f.credentials[0];for(let i=0;i<15;i++)assert.equal((await login(f,c.username,'incorrect')).response.status,401);assert.equal((await login(f,c.username,c.password)).response.status,429);f.sql.exec('UPDATE organizer_login_limits SET expires=0');const s=await login(f,c.username,c.password);f.sql.exec('UPDATE organizer_sessions SET expires=0');assert.equal((await handleAccounts(new Request('https://test/api/organizers',{headers:{cookie:s.cookie}}),f.db)).status,401);});

test('racketeers can read organizer data but every mutation path is denied, including alternate staff credentials',async()=>{
 const f=await activated(),c=f.credentials.find(c=>c.username==='racketeers'),initial=await login(f,c.username,c.password);
 assert.equal((await handleAccounts(request({action:'update',currentPassword:c.password,password:'new viewer private password'},initial.cookie),f.db)).status,200);
 const signed=await login(f,c.username,'new viewer private password');assert.equal(signed.data.actor.read_only,1);
 assert.equal(await organizerRequestMatches(new Request('https://test/api/state',{headers:{cookie:signed.cookie,'x-organizer-pin':'session'}}),f.db,f.state()),true);
 for(const [method,path,action] of [['PUT','state',''],['PATCH','state',''],['POST','state','dispatchGame'],['POST','state','changeUmpirePin'],['POST','state','verifyMatch'],['POST','state','viewRegistrationPin'],['POST','sponsors',''],['DELETE','sponsors',''],['POST','payment-settings',''],['POST','payment-proof',''],['DELETE','payment-proof',''],['POST','payment-details',''],['POST','demo','']]) {
  const req=new Request('https://test/api/'+path,{method,headers:{cookie:signed.cookie,'x-organizer-pin':'session','x-umpire-pin':'12345678','content-type':'application/json'},body:JSON.stringify({action})});
  let executed=false;const response=await auditedOrganizerRequest(req,f.db,async()=>{executed=true;return Response.json({ok:true});});assert.equal(response.status,403,method+path);assert.equal(executed,false);
 }
 assert.equal((await handleAccounts(request({action:'update',currentPassword:'new viewer private password',username:'different.viewer'},signed.cookie),f.db)).status,403);
});

test('renaming an account preserves first-sign-in requirements and stable privileges',async()=>{
 const f=await activated(),c=f.credentials.find(c=>c.username==='carl.taboada'),initial=await login(f,c.username,c.password);
 await handleAccounts(request({action:'update',currentPassword:c.password,password:'manager replacement private password'},initial.cookie),f.db);
 const manager=await login(f,c.username,'manager replacement private password');
 const viewer=f.sql.prepare("SELECT id FROM organizer_accounts WHERE username='racketeers'").get();
 const renamed=await handleAccounts(request({action:'update',id:viewer.id,username:'racketeers.viewer',currentPassword:'manager replacement private password'},manager.cookie),f.db);assert.equal(renamed.status,200);
 const original=f.credentials.find(c=>c.username==='racketeers'),signed=await login(f,'racketeers.viewer',original.password);
 assert.equal(signed.data.actor.id,viewer.id);assert.equal(signed.data.actor.must_change,1);assert.equal(signed.data.actor.read_only,1);assert.equal(signed.data.actor.manager,0);
});

test('an initial password cannot be reused to bypass the required first change',async()=>{
 const f=await activated(),c=f.credentials[0],signed=await login(f,c.username,c.password);
 assert.equal((await handleAccounts(request({action:'update',currentPassword:c.password,password:c.password},signed.cookie),f.db)).status,400);
 assert.equal(f.sql.prepare('SELECT must_change FROM organizer_accounts WHERE username=?').get(c.username).must_change,1);
});

test('two simultaneous activations create one complete account set without replacing the winning credentials',async()=>{
 const f=fixture(),pin='87654321',hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pin))).toString('hex');
 f.sql.prepare('INSERT INTO tournament_state VALUES (?,?,1,?)').run('racketeers',JSON.stringify({organizerPinHash:hash,registrations:[],matches:[]}),new Date().toISOString());
 const responses=await Promise.all([handleAccounts(request({action:'activate'},'',pin),f.db),handleAccounts(request({action:'activate'},'',pin),f.db)]);
 assert.equal(responses.filter(r=>r.status===200).length,1);assert.ok(responses.every(r=>[200,403,409].includes(r.status)));
 assert.equal(f.sql.prepare('SELECT COUNT(*) AS count FROM organizer_accounts').get().count,4);
 const {credentials}=await responses.find(r=>r.status===200).json();
 for(const c of credentials){const stored=f.sql.prepare('SELECT password_hash FROM organizer_accounts WHERE username=?').get(c.username);assert.equal(await passwordMatches(c.password,stored.password_hash),true);}
 assert.equal(f.sql.prepare('SELECT revision FROM tournament_state').get().revision,2);
});
