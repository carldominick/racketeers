import assert from "node:assert/strict";
import test from "node:test";
import {readFile, readdir} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {crc32} from "node:zlib";
import {Miniflare} from "miniflare";

const client = fileURLToPath(new URL('../dist/client/', import.meta.url));

const mime = {'.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.wasm':'application/wasm', '.gz':'application/gzip'};
const env = {ASSETS:{async fetch(request) {
  const filename = path.resolve(client, '.' + new URL(request.url).pathname);
  if (!filename.startsWith(client.endsWith(path.sep) ? client : client + path.sep)) return new Response(null, {status:404});
  try { return new Response(await readFile(filename), {headers:{'content-type':mime[path.extname(filename)] || 'application/octet-stream'}}); }
  catch { return new Response(null, {status:404}); }
}}};
const server = fileURLToPath(new URL('../dist/server/',import.meta.url));
const serverFiles = await readdir(server,{recursive:true});
const runtime = new Miniflare({
  modules:[{type:'ESModule',path:path.join(server,'index.js')},...serverFiles.filter(name=>name!=='index.js' && name.endsWith('.js')).map(name=>({type:'ESModule',path:path.join(server,name)}))],
  modulesRoot:server,
  compatibilityDate:'2026-08-01',
  compatibilityFlags:['nodejs_compat'],
  serviceBindings:{ASSETS:env.ASSETS.fetch},
  d1Databases:{DB:'reliability-disposable'},
  r2Buckets:{PAYMENT_PROOFS:'reliability-disposable'},
  bindings:{INITIAL_ORGANIZER_PIN:'12345678'},
});
test.after(()=>runtime.dispose());
test('built demo entry requires the real organizer and preview query parameters do not unlock it',async()=>{
 await runtime.dispatchFetch('https://racketeers.example/api/state');
 const request=pin=>runtime.dispatchFetch('https://racketeers.example/api/demo',{method:'POST',headers:pin?{'x-organizer-pin':pin}:{}});
 assert.equal((await request()).status,401);assert.equal((await request('98765432')).status,401);
 assert.equal((await runtime.dispatchFetch('https://racketeers.example/api/demo',{method:'POST',headers:{'x-umpire-pin':'12345678'}})).status,401);
 const authorized=await request('12345678');assert.equal(authorized.status,200);assert.equal((await authorized.json()).authorized,true);
 const gate=await runtime.dispatchFetch('https://racketeers.example/demo?role=organizer');const html=await gate.text();assert.match(html,/Start demo/);assert.doesNotMatch(html,/Practice guide|DEMO-PLAYER/);
 const ordinary=await runtime.dispatchFetch('https://racketeers.example/?role=organizer&demo=true');assert.doesNotMatch(await ordinary.text(),/Open organizer demo|Practice guide/);
});
const fetchWorker = request => runtime.dispatchFetch(request.url,{method:request.method,headers:request.headers,cf:request.cf});
const fetchPage = pathname => fetchWorker(new Request('https://racketeers.example'+pathname, {headers:{accept:'text/html'}}));

test('built registration starts Connecting and uses deliverable assets without cached workspace font paths', async () => {
  const response = await fetchPage('/');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /^text\/html\b/);
  const html = await response.text();
  assert.match(html, /Racketeers/);
  assert.match(html, /Connecting…/);
  assert.doesNotMatch(html, />● Synced</);
  assert.doesNotMatch(html, /\/workspace\/|\.vinext\/fonts\/|as="font"/);
  const urls = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"?]+)(?:\?[^" ]*)?"/g)].map(match=>match[1]))];
  assert.ok(urls.some(url=>url.endsWith('.js')), 'built page references JavaScript');
  assert.ok(urls.some(url=>url.endsWith('.css')), 'built page references CSS');
  for (const url of urls) {
    const result = await fetchWorker(new Request('https://racketeers.example'+url));
    assert.equal(result.status, 200, url);
    assert.equal(result.headers.get('content-type'), mime[path.extname(url)], url);
    assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
    assert.ok((await result.arrayBuffer()).byteLength > 0, url);
  }
});

test('built Worker serves court pages, emitted assets and OCR binaries for overseas visitors', async () => {
  const files = await readdir(path.join(client, '_next', 'static'), {recursive:true});
  const script = files.find(name=>name.endsWith('.js'));
  assert.ok(script, 'Vinext emits a client script');
  for (const pathname of ['/','/courts', '/_next/static/'+script.split(path.sep).join('/'), '/ocr/worker.min.js','/ocr/core/tesseract-core-lstm.wasm','/ocr/lang/eng.traineddata.gz','/court-player-white.png','/court-player-navy.png']) {
    const page = pathname==='/' || pathname==='/courts';
    const request = new Request('https://racketeers.example'+pathname, {headers:{accept:page?'text/html':'*/*'}});
    Object.defineProperty(request, 'cf', {value:{country:'US'}});
    const response = await fetchWorker(request);
    assert.equal(response.status, 200, pathname);
    if (page) assert.match(await response.text(), pathname==='/'?/Racketeers/:/Court view/);
    else {
      assert.equal(response.headers.get('content-type'), mime[path.extname(pathname)], pathname);
      assert.ok((await response.arrayBuffer()).byteLength > 0, pathname);
    }
  }
});

test('new and legacy image URLs serve originals securely when no Images binding is configured', async () => {
  const original = await readFile(path.join(client, 'court-player-white.png'));
  for (const endpoint of ['/_next/image','/_vinext/image']) {
    const response = await fetchWorker(new Request('https://racketeers.example'+endpoint+'?url=%2Fcourt-player-white.png&w=640&q=75'));
    assert.equal(response.status, 200, endpoint);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), original);
  }
});

test('built Worker uses disposable D1 for venue registrations and enforces JSON and organizer access', async () => {
  const initial = await runtime.dispatchFetch('https://racketeers.example/api/state');
  assert.equal(initial.status, 200);
  const db = await runtime.getD1Database('DB');
  const row = await db.prepare('SELECT payload FROM tournament_state WHERE id = ?').bind('racketeers').first();
  const state = JSON.parse(row.payload);
  state.status = 'registration';
  await db.prepare('UPDATE tournament_state SET payload = ? WHERE id = ?').bind(JSON.stringify(state),'racketeers').run();
  const create = (index, headers={}) => runtime.dispatchFetch('https://racketeers.example/api/state', {
    method:'POST', headers:{'content-type':'application/json','cf-connecting-ip':'203.0.113.4',...headers},
    body:JSON.stringify({action:'registerPlayer',registration:{divisionId:state.divisions[0].id,name:`Alex ${index}`,partnerName:`Sam ${index}`,club:'Test club',partnerClub:'Test club',facebookProfile:`https://www.facebook.com/alex${index}.test`,partnerFacebookProfile:`https://www.facebook.com/sam${index}.test`,phone:'09123456789',partnerPhone:'09123456780'}}),
  });
  for (let i=0;i<35;i++) assert.equal((await create(i)).status, 200);
  assert.equal((await create(35,{'content-type':'image/png'})).status, 415);
  assert.equal((await create(35,{'x-organizer-pin':'99999999'})).status, 401);
  const verified = await runtime.dispatchFetch('https://racketeers.example/api/state',{headers:{'x-organizer-pin':'12345678'}});
  assert.equal(verified.status, 200);
  const data = await verified.json();
  assert.equal(data.organizer, true);
  assert.equal(data.state.registrations.length, 70);
  const successes = await db.prepare("SELECT count FROM request_limits WHERE id LIKE 'registration-success:%'").first();
  assert.equal(successes.count, 35);

  const registrationClosesAt = '2000-01-01T09:00';
  const save = await runtime.dispatchFetch('https://racketeers.example/api/state', {
    method:'PUT', headers:{'content-type':'application/json','x-organizer-pin':'12345678'},
    body:JSON.stringify({state:{...data.state,registrationClosesAt},expectedRevision:data.revision}),
  });
  assert.equal(save.status, 200);
  const closed = await create(36);
  assert.equal(closed.status, 423);
  assert.match((await closed.json()).error, /deadline has passed/);
  const published = await (await runtime.dispatchFetch('https://racketeers.example/api/state')).json();
  assert.equal(published.state.registrationClosesAt, registrationClosesAt);
  assert.deepEqual(published.state.registrations, []);
});

test('built named-account activation, password change, cookies, PIN retirement and audit use real workerd/D1',async()=>{
 const post=(body,cookie='',pin='')=>runtime.dispatchFetch('https://racketeers.example/api/organizers',{method:'POST',headers:{'content-type':'application/json',cookie,...(pin?{'x-organizer-pin':pin}:{})},body:JSON.stringify(body)});
 const legacyState=await (await runtime.dispatchFetch('https://racketeers.example/api/state',{headers:{'x-organizer-pin':'12345678'}})).json();
 const division=legacyState.state.divisions[0];
 const pin=Array.from({length:9000},(_,index)=>String(index+1000)).find(candidate=>legacyState.state.matches.every(game=>game.pin!==candidate));
 const match={id:'viewer-test-match',divisionId:division.id,stage:'regular',round:1,label:'Fixture game',entryAId:division.entries[0].id,entryBId:division.entries[1].id,sets:[{a:0,b:0,complete:false}],status:'ready',court:1,scheduledAt:null,validated:false,pin,format:'single_31'};
 const saveMatch=await runtime.dispatchFetch('https://racketeers.example/api/state',{
  method:'PUT',headers:{'content-type':'application/json','x-organizer-pin':'12345678'},
  body:JSON.stringify({state:{...legacyState.state,matches:[...legacyState.state.matches,match]},expectedRevision:legacyState.revision}),
 });
 assert.equal(saveMatch.status,200);
 const registration=legacyState.state.registrations[0];
 const r2=await runtime.getR2Bucket('PAYMENT_PROOFS');
 await r2.put(`payments/groups/${registration.paymentGroupId}/${registration.paymentGroupId}.png`, 'disposable fixture');
 const exportLink=async(pin,cookie='')=>{
  const response=await runtime.dispatchFetch('https://racketeers.example/api/payment-proof?export-links=1',{
   method:'POST',headers:{'content-type':'application/json','x-organizer-pin':pin,cookie},body:JSON.stringify({registrationIds:[registration.id]}),
  });
  assert.equal(response.status,200);
  const result=await response.json();
  assert.ok(result.links[registration.id]);
  return result.links[registration.id];
 };
 const oldLink=await exportLink('12345678');
 assert.equal((await runtime.dispatchFetch(oldLink)).status,200);
 const activation=await post({action:'activate'},'','12345678');assert.equal(activation.status,200);
 assert.equal((await runtime.dispatchFetch(oldLink)).status,401);
 const {credentials}=await activation.json(),c=credentials.find(c=>c.username==='carl.taboada');assert.ok(c);
 let signed=await post({action:'login',username:c.username,password:c.password});assert.equal(signed.status,200);
 let cookie=signed.headers.get('set-cookie').split(';')[0];assert.match(signed.headers.get('set-cookie'),/HttpOnly/);
 assert.equal((await runtime.dispatchFetch('https://racketeers.example/api/state',{headers:{cookie,'x-organizer-pin':'session'}})).status,401);
 const changed=await post({action:'update',currentPassword:c.password,password:'a new long private password'},cookie);assert.equal(changed.status,200);
 signed=await post({action:'login',username:c.username,password:'a new long private password'});assert.equal(signed.status,200);cookie=signed.headers.get('set-cookie').split(';')[0];
 const get=await runtime.dispatchFetch('https://racketeers.example/api/state',{headers:{cookie,'x-organizer-pin':'session'}});assert.equal(get.status,200);const state=await get.json();assert.equal(state.organizer,true);
 const pollUrl = 'https://racketeers.example/api/state?sinceRevision='+state.revision;
 const unchanged = await runtime.dispatchFetch(pollUrl,{headers:{cookie,'x-organizer-pin':'session'}});
 assert.equal(unchanged.status,204);
 assert.equal(await unchanged.text(),'');
 assert.equal((await runtime.dispatchFetch(pollUrl,{headers:{'x-organizer-pin':'session'}})).status,401);
 assert.equal((await runtime.dispatchFetch(pollUrl)).status,200);
 assert.equal(state.state.paymentProofShareKey,undefined);
 assert.equal(state.state.organizerPinHash,undefined);
 assert.equal((await runtime.dispatchFetch(await exportLink('session',cookie))).status,200);
 assert.equal((await runtime.dispatchFetch('https://racketeers.example/api/state?backup=1',{headers:{cookie,'x-organizer-pin':'session'}})).status,200);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1sAAAAASUVORK5CYII=','base64');
 const text=Buffer.alloc(12*1024*1024,65);
 text.write('tEXtFixture\0');
 const size=Buffer.alloc(4), checksum=Buffer.alloc(4);
 size.writeUInt32BE(text.length-4);checksum.writeUInt32BE(crc32(text));
 const sponsor=Buffer.concat([png.subarray(0,-12),size,text,checksum,png.subarray(-12)]);
 const uploaded=await runtime.dispatchFetch('https://racketeers.example/api/sponsors',{
  method:'POST',headers:{cookie,'x-organizer-pin':'session','x-sponsor-size':String(sponsor.length),'content-type':'image/png'},body:sponsor,
 });
 assert.equal(uploaded.status,201);
 const {image}=await uploaded.json();
 const stored=await r2.get(`sponsors/${image.id}.png`);
 assert.equal(stored.size,sponsor.length);
 assert.deepEqual(Buffer.from(await stored.arrayBuffer()),sponsor);
 for(const path of ['/api/state','/api/payment-settings','/api/sponsors','/api/demo']){const response=await runtime.dispatchFetch('https://racketeers.example'+path,{method:path==='/api/state'?'GET':'POST',headers:{'x-organizer-pin':'12345678','content-type':'application/json'},...(path==='/api/state'?{}:{body:'{}'})});assert.equal(response.status,401,path);}
 const registrationClosesAt='2026-11-29T08:30';
 const paidIds=new Set([registration.id,registration.partnerId]);
 const registrations=state.state.registrations.map(player=>paidIds.has(player.id)?{...player,paid:true}:player);
 const save=await runtime.dispatchFetch('https://racketeers.example/api/state',{method:'PUT',headers:{'content-type':'application/json',cookie,'x-organizer-pin':'session'},body:JSON.stringify({state:{...state.state,registrations,venue:'Fictional venue',registrationClosesAt,organizerAccountsEnabled:false},expectedRevision:state.revision})});assert.equal(save.status,200);
 assert.deepEqual((await save.json()).state.registrations.filter(player=>player.paid).map(player=>player.id),[...paidIds]);
 const changedPoll = await runtime.dispatchFetch(pollUrl,{headers:{cookie,'x-organizer-pin':'session'}});
 assert.equal(changedPoll.status,200);
 assert.equal((await changedPoll.json()).revision,state.revision+1);
 const audit=await runtime.dispatchFetch('https://racketeers.example/api/organizers?audit=1',{headers:{cookie}});assert.equal(audit.status,200);const events=(await audit.json()).events;
 assert.ok(events.some(e=>e.username===c.username&&e.action.includes('Confirm payment for 2 player entries')&&e.action.includes('venue')&&e.action.includes('registration deadline')&&e.outcome==='Succeeded'));
 const publicState=await runtime.dispatchFetch('https://racketeers.example/api/state');const publicData=await publicState.json();assert.equal(publicData.state.organizerAccountsEnabled,true);assert.equal(publicData.state.registrations.length,0);assert.equal(publicData.state.registrationClosesAt,registrationClosesAt);
 assert.equal((await runtime.dispatchFetch('https://racketeers.example/api/demo',{method:'POST',headers:{cookie,'x-organizer-pin':'session'}})).status,200);
 assert.equal((await post({action:'logout'},cookie)).status,200);
 assert.equal((await runtime.dispatchFetch('https://racketeers.example/api/state',{headers:{cookie,'x-organizer-pin':'session'}})).status,401);
 const viewer=credentials.find(c=>c.username==='racketeers');signed=await post({action:'login',username:viewer.username,password:viewer.password});cookie=signed.headers.get('set-cookie').split(';')[0];
 assert.equal((await post({action:'update',currentPassword:viewer.password,password:'viewer long private password'},cookie)).status,200);
 signed=await post({action:'login',username:'racketeers',password:'viewer long private password'});cookie=signed.headers.get('set-cookie').split(';')[0];
 const verify=await runtime.dispatchFetch('https://racketeers.example/api/state',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({action:'verifyOrganizer',pin:'session'})});assert.equal(verify.status,200);
 const viewed=await runtime.dispatchFetch('https://racketeers.example/api/state',{headers:{cookie,'x-organizer-pin':'session'}});
 assert.equal(viewed.status,200);
 const view=(await viewed.json()).state;
 assert.ok(view.registrations.length);
 assert.ok(view.registrations.every(r=>!r.registrationPinHash&&!r.registrationPinRecovery));
 assert.equal(view.matches.find(m=>m.id===match.id)?.pin,'');
 assert.equal(view.paymentProofShareKey,undefined);
 assert.equal(view.umpirePinHash,undefined);
 assert.equal((await runtime.dispatchFetch('https://racketeers.example/api/state?backup=1',{headers:{cookie,'x-organizer-pin':'session'}})).status,403);
 for(const action of ['verifyMatch','viewRegistrationPin']){
  assert.equal((await runtime.dispatchFetch('https://racketeers.example/api/state',{method:'POST',headers:{cookie,'x-organizer-pin':'session','content-type':'application/json'},body:JSON.stringify({action,pin:match.pin,registrationId:registration.id})})).status,403);
 }
 for(const path of ['/api/state','/api/sponsors','/api/payment-settings','/api/payment-proof','/api/payment-details','/api/demo']){const result=await runtime.dispatchFetch('https://racketeers.example'+path,{method:'POST',headers:{cookie,'x-organizer-pin':'session','x-umpire-pin':'12345678','content-type':'application/json','cf-connecting-ip':'203.0.113.12'},body:JSON.stringify({action:'changeUmpirePin',newPin:'87654321'})});assert.equal(result.status,403,path);}
});
