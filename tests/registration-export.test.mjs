import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';

const dir = await mkdtemp(path.join(tmpdir(), 'registration-export-'));
await build({ entryPoints: ['lib/registration-export.ts'], outfile: path.join(dir, 'export.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { buildRegistrationWorkbook, registrationSheetCsv } = await import(pathToFileURL(path.join(dir, 'export.mjs')));
await build({ entryPoints: ['lib/registration-export-data.ts'], outfile: path.join(dir, 'data.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { prepareRegistrationExport } = await import(pathToFileURL(path.join(dir, 'data.mjs')));
const sheets = [
  { name: 'Open division', rows: [{ name: '=2+2', id: 'player-1', phone: '091234', facebookProfile: 'https://facebook.com/test', club: 'Racketeers', partnerName: 'Partner', divisionName: 'Open division', shirtSize: 'M', paid: true, paymentProofUrl: 'https://test/api/payment-proof?share=signed' }] },
  { name: 'Open division', rows: [{ name: 'Second', id: 'player-2', divisionName: 'Open division', paid: false }] },
];

test('Excel export contains a unique worksheet per division and linked proof cells', () => {
  const archive = unzipSync(buildRegistrationWorkbook(sheets));
  const workbook = new TextDecoder().decode(archive['xl/workbook.xml']);
  assert.match(workbook, /name="Open division"/);
  assert.match(workbook, /name="Open division \(2\)"/);
  assert.equal(Object.keys(archive).filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).length, 2);
  assert.match(new TextDecoder().decode(archive['xl/worksheets/sheet1.xml']), /View payment proof/);
  assert.match(new TextDecoder().decode(archive['xl/worksheets/_rels/sheet1.xml.rels']), /Target="https:\/\/test\/api\/payment-proof\?share=signed"/);
});

test('CSV export includes validation fields and neutralizes spreadsheet formulas', () => {
  const csv = registrationSheetCsv(sheets[0]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /"Player name","Registration ID","Phone \/ mobile","Facebook profile","Club \/ group","Partner","Division","Shirt size","Payment status","Payment proof"/);
  assert.match(csv, /"'=2\+2"/);
  assert.match(csv, /"https:\/\/test\/api\/payment-proof\?share=signed"/);
});

test('review exports preserve leading zeros, status, shared group and stale-image warnings as text',()=>{
 const sheet={name:'Open',rows:[{name:'Alex',id:'a',divisionName:'Open',paid:false,receiptGroupId:'shared-group',receipt:{amount:'1900.00',reference:'0012345678901',provider:'=unsafe',date:'2026-10-23',transferStatus:'pending'},reviewStatus:'Screenshot changed - re-review',reviewedAt:'2026-10-23',duplicateReference:true,proofVersion:'photo-2'}]};
 const csv=registrationSheetCsv(sheet);for(const text of ['0012345678901','shared-group','Screenshot changed - re-review','pending','Check duplicate','photo-2'])assert.ok(csv.includes(text));assert.ok(csv.includes("'=unsafe"));
 const xml=new TextDecoder().decode(unzipSync(buildRegistrationWorkbook([sheet]))['xl/worksheets/sheet1.xml']);assert.match(xml,/t="inlineStr"><is><t xml:space="preserve">0012345678901/);assert.ok(xml.includes('1900.00'));assert.ok(xml.includes('Screenshot changed - re-review'));
});

test.after(() => rm(dir, { recursive: true, force: true }));
test('no-shirt entries export their choice rather than a retained size in both formats',()=>{
 const sheet={name:'Open',rows:[{name:'Alex',id:'no-shirt',divisionName:'Open',shirtSize:'XL',secondShirt:'none',paid:false}]};
 assert.match(registrationSheetCsv(sheet),/"Open","No shirt","Pending"/);
 const xml=new TextDecoder().decode(unzipSync(buildRegistrationWorkbook([sheet]))['xl/worksheets/sheet1.xml']);
 assert.match(xml,/No shirt/);assert.doesNotMatch(xml,/>XL</);
});

const roster = { divisions:[{id:'open',name:'Open doubles'},{id:'mixed',name:'Mixed doubles'}], registrations:[
 {id:'miguel',name:'Miguel Santos',divisionId:'open',paymentGroupId:'group',partnerId:'elena',paid:false},
 {id:'elena',name:'Elena Cruz',divisionId:'open',paymentGroupId:'group',partnerId:'miguel',paid:false},
 {id:'rafael',name:'Rafael Navarro',divisionId:'mixed',paid:false},
] };
test('offline or unsaved exports include every visible division without network requests or false missing-proof claims',async()=>{
 const result=await prepareRegistrationExport({state:roster,divisionId:'all',pin:'fictional',includePaymentData:false,request:()=>{throw Error('Unexpected request');}});
 assert.equal(result.sheets.length,2);assert.equal(result.sheets.flatMap(s=>s.rows).length,3);assert.match(result.warning,/entries currently shown/);
 const csv=registrationSheetCsv({name:'All',rows:result.sheets.flatMap(s=>s.rows)});for(const name of ['Miguel Santos','Elena Cruz','Rafael Navarro','Open doubles','Mixed doubles'])assert.ok(csv.includes(name));
 const archive=unzipSync(buildRegistrationWorkbook(result.sheets));const xml=new TextDecoder().decode(archive['xl/worksheets/sheet1.xml']);assert.match(xml,/Payment proof unavailable/);assert.doesNotMatch(xml,/No payment proof uploaded/);assert.match(csv,/Unavailable - check/);
});
test('receipt service failure still produces a filtered roster with an explicit unavailable status',async()=>{
 const result=await prepareRegistrationExport({state:roster,divisionId:'mixed',pin:'fictional',includePaymentData:true,request:async()=>Response.json({error:'Unavailable'},{status:503})});
 assert.deepEqual(result.sheets.map(s=>s.rows.map(r=>r.id)),[['rafael']]);assert.match(result.warning,/could not be loaded/);assert.match(result.sheets[0].rows[0].reviewStatus,/Unavailable/);
});
test('connected exports retain authorized signed links, shared reviewed fields and missing screenshot status',async()=>{
 let calls=0;
 const result=await prepareRegistrationExport({state:roster,divisionId:'all',pin:'fictional',includePaymentData:true,request:async(url,options)=>{
  calls++;assert.equal(options.headers['x-organizer-pin'],'fictional');
  if(url.includes('export-links'))return Response.json({links:{miguel:'https://example.invalid/signed',elena:'https://example.invalid/signed'}});
  if(url.includes('rafael'))return Response.json({},{status:404});
  return Response.json({groupId:'group',details:{amount:'1250.00',reference:'001234',provider:'Bank',date:'2026-11-07'},revision:1,proofVersion:'v1',stale:false,reviewedAt:'2026-11-07',linkedRegistrationIds:['miguel','elena']});
 }});
 assert.equal(calls,3);assert.equal(result.warning,'');assert.equal(result.sheets[0].rows[1].receipt.reference,'001234');assert.equal(result.sheets[0].rows[0].paymentProofUrl,'https://example.invalid/signed');assert.equal(result.sheets[1].rows[0].reviewStatus,'No screenshot');
});
test('expired organizer access remains an error rather than silently exporting failed authorization as missing proof',async()=>{
 for(const status of [401,403])await assert.rejects(prepareRegistrationExport({state:roster,divisionId:'all',pin:'fictional',includePaymentData:true,request:async()=>Response.json({},{status})}),/access expired/);
 await assert.rejects(prepareRegistrationExport({state:roster,divisionId:'removed',pin:'fictional',includePaymentData:false}),/no divisions/);
});
