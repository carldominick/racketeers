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

test.after(() => rm(dir, { recursive: true, force: true }));
