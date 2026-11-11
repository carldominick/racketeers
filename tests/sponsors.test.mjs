import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { crc32 } from 'node:zlib';
const dir = await mkdtemp(path.join(tmpdir(), 'sponsors-'));
await build({entryPoints:['lib/sponsor-server.ts'],outfile:path.join(dir,'server.mjs'),bundle:true,platform:'node',format:'esm'});
await build({entryPoints:['lib/request-security.ts'],outfile:path.join(dir,'security.mjs'),bundle:true,platform:'node',format:'esm'});
const {handleSponsors} = await import(pathToFileURL(path.join(dir,'server.mjs')));
const {protectedRequest} = await import(pathToFileURL(path.join(dir,'security.mjs')));
test.after(()=>rm(dir,{recursive:true,force:true}));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1sAAAAASUVORK5CYII=','base64');
const pin = '876543';
const hash = Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(pin))).toString('hex');
function fixture() {
 const rows = new Map(), objects = new Map([['payments/private.png',{bytes:png}]]);
 const state = JSON.stringify({organizerPinHash:hash,registrations:[{id:'private',phone:'private contact'}],matches:[{id:'game',sets:[{a:9,b:8}]}]});
 let failInsert = false;
 const env = {DB:{prepare(sql){return {run:async()=>({}),all:async()=>({results:[...rows.values()].sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id))}),bind(...args){return {first:async()=>sql.includes('tournament_state')?{payload:state}:rows.get(args[0])??null,run:async()=>{if(sql.startsWith('INSERT INTO sponsor_images')){if(failInsert)throw new Error('disposable database failure');rows.set(args[0],{id:args[0],name:args[1],created_at:args[2]});}if(sql.startsWith('DELETE FROM sponsor_images'))rows.delete(args[0]);return {};}};}};}},PAYMENT_PROOFS:{put:async(key,stream)=>objects.set(key,{bytes:Buffer.from(await new Response(stream).arrayBuffer())}),get:async key=>objects.has(key)?{body:new Blob([objects.get(key).bytes]).stream(),size:objects.get(key).bytes.length,uploaded:new Date()}:null}};
 return {env,rows,objects,state,setFailInsert:value=>{failInsert=value;}};
}
const req = (method='GET',options={}) => {
 const body=options.body??png;
 return new Request(`https://test/api/sponsors${options.id?`?image=${encodeURIComponent(options.id)}`:''}`,{method,headers:{...(options.pin?{'x-organizer-pin':options.pin}:{}),...(method==='POST'?{'content-type':options.type??'image/png','x-sponsor-name':encodeURIComponent(options.name??'Community Sponsor'),'x-sponsor-size':String(options.length??(typeof body==='string'?Buffer.byteLength(body):body.byteLength))}:{}),...(options.origin?{origin:options.origin}:{})},...(method==='POST'?{body,duplex:'half'}:{})});
};
test('public sponsor reads reveal only listed images; organizer uploads leave tournament and receipts untouched',async()=>{
 const f=fixture();
 assert.equal((await handleSponsors(req('POST'),f.env)).status,401);
 assert.equal((await handleSponsors(req('POST',{pin:'12345678'}),f.env)).status,401);
 assert.equal(f.rows.size,0);
 const result=await handleSponsors(req('POST',{pin,name:'Lime & Navy'}),f.env);assert.equal(result.status,201);
 const {image}=await result.json();assert.equal(image.name,'Lime & Navy');assert.ok(f.objects.has(`sponsors/${image.id}.png`));
 const listed=await (await handleSponsors(req(),f.env)).json();assert.deepEqual(listed.images,[image]);assert.ok(!JSON.stringify(listed).includes('private'));assert.ok(!JSON.stringify(listed).includes(hash));
 const publicImage=await handleSponsors(req('GET',{id:image.id}),f.env);assert.equal(publicImage.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()),png);
 assert.ok(f.objects.has('payments/private.png'));assert.match(f.state,/"a":9/);
 assert.equal((await handleSponsors(req('GET',{id:'../payments/private.png'}),f.env)).status,400);
 assert.equal((await handleSponsors(req('GET',{id:crypto.randomUUID()}),f.env)).status,404);
});
test('concurrent additions append separate images and removal only withdraws its public listing',async()=>{
 const f=fixture();const responses=await Promise.all([handleSponsors(req('POST',{pin,name:'Sponsor One'}),f.env),handleSponsors(req('POST',{pin,name:'Sponsor Two'}),f.env)]);
 const images=await Promise.all(responses.map(async r=>(await r.json()).image));assert.equal(f.rows.size,2);assert.notEqual(images[0].id,images[1].id);
 assert.equal((await handleSponsors(req('DELETE',{id:images[0].id}),f.env)).status,401);assert.equal(f.rows.size,2);
 assert.equal((await handleSponsors(req('DELETE',{id:images[0].id,pin}),f.env)).status,200);assert.equal(f.rows.size,1);
 assert.ok(f.objects.has(`sponsors/${images[0].id}.png`));assert.ok(f.objects.has('payments/private.png'));
 assert.equal((await handleSponsors(req('GET',{id:images[0].id}),f.env)).status,404);
 assert.equal((await handleSponsors(req('GET',{id:images[1].id}),f.env)).status,200);
});
test('invalid types, malformed images, large dimensions and length mismatches never publish',async()=>{
 const f=fixture();
 for(const [options,status] of [[{type:'image/svg+xml'},415],[{body:'not an image'},415],[{body:new Uint8Array(2*1024*1024+1)},415],[{length:png.length+1},415],[{length:png.length-1},415],[{body:png.subarray(0,-1)},415],[{name:'Private\nname'},400],[{name:'x'.repeat(101)},400]])assert.equal((await handleSponsors(req('POST',{pin,...options}),f.env)).status,status);
 const enormous=Buffer.from(png);enormous.writeUInt32BE(25000,16);enormous.writeUInt32BE(25000,20);assert.equal((await handleSponsors(req('POST',{pin,body:enormous}),f.env)).status,415);
 assert.equal(f.rows.size,0);assert.equal(f.objects.size,1);
});
test('missing storage and failed database saves remain retryable without exposing unlisted objects',async()=>{
 const f=fixture();assert.equal((await handleSponsors(req('POST',{pin}),{DB:f.env.DB})).status,503);
 assert.equal((await (await handleSponsors(req(),{DB:f.env.DB})).json()).enabled,false);
 f.setFailInsert(true);assert.equal((await handleSponsors(req('POST',{pin}),f.env)).status,500);assert.equal(f.rows.size,0);
 const key=[...f.objects.keys()].find(key=>key.startsWith('sponsors/'));const id=key.slice(9,-4);
 assert.equal((await handleSponsors(req('GET',{id}),f.env)).status,404);
 f.setFailInsert(false);assert.equal((await handleSponsors(req('POST',{pin}),f.env)).status,201);assert.equal(f.rows.size,1);
});
test('large sponsor PNGs stream through the same-origin boundary without an app size cap',async()=>{
 const f=fixture();const next=request=>handleSponsors(request,f.env);
 assert.equal((await protectedRequest(req('POST',{pin,origin:'https://other.test'}),f.env.DB,next)).status,403);
 const text=Buffer.alloc(12*1024*1024,65);
 text.write('tEXtFixture\0');
 const size=Buffer.alloc(4), checksum=Buffer.alloc(4);
 size.writeUInt32BE(text.length-4);checksum.writeUInt32BE(crc32(text));
 const large=Buffer.concat([png.subarray(0,-12),size,text,checksum,png.subarray(-12)]);
 const stream=new ReadableStream({start(controller){
  for(const chunk of [large.subarray(0,8),large.subarray(8,-6),large.subarray(-6)])controller.enqueue(chunk);
  controller.close();
 }});
 const response=await protectedRequest(req('POST',{pin,origin:'https://test',body:stream,length:large.length}),f.env.DB,next);
 assert.equal(response.status,201);
 const {image}=await response.json();
 assert.deepEqual(f.objects.get(`sponsors/${image.id}.png`).bytes,large);
 assert.equal(f.rows.size,1);
 for(const endpoint of ['payment-proof','payment-settings']){
  const receipt=new Request('https://test/api/'+endpoint,{method:'POST',headers:{'content-type':'image/png'},body:large});
  assert.equal((await protectedRequest(receipt,f.env.DB,()=>{throw new Error('Payment upload must stay bounded');})).status,413);
 }
});
