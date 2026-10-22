import assert from "node:assert/strict";
import test from "node:test";
import {readFile, readdir} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
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
  bindings:{INITIAL_ORGANIZER_PIN:'12345678'},
});
test.after(()=>runtime.dispose());
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
});
