import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const require = createRequire(import.meta.url);
const dir = await mkdtemp(path.join(tmpdir(), 'match-card-print-'));
await build({entryPoints:['app/components/print-match-card.tsx'], outfile:path.join(dir,'card.mjs'), bundle:true, platform:'node', format:'esm', jsx:'automatic', plugins:[{name:'shared-react',setup(build){build.onResolve({filter:/^react($|\/)/},args=>({path:require.resolve(args.path),external:true}));}}]});
const {PrintMatchCard, PrintMatchCards} = await import(pathToFileURL(path.join(dir, 'card.mjs')));
after(() => rm(dir, {recursive:true,force:true}));

const division = {id:'d',name:'Level D/E',mode:'doubles',entries:[{id:'a',name:'Alex / Sam',players:['Alex','Sam']},{id:'b',name:'Chris / Pat',players:['Chris','Pat']}]};
const match = {id:'m',divisionId:'d',stage:'gold',label:'Championship final',entryAId:'a',entryBId:'b',format:'best_of_3_21',scoring:{mode:'capped_win_by_two',target:21,cap:30},court:884,pin:'91928374',scheduledAt:'2026-11-29T03:00:00Z',sets:[{a:27,b:25,complete:true},{a:26,b:24,complete:true}],status:'finished',validated:true};
const state = {tournamentName:'Racketeers X Fruitas Badminton Tournament',divisions:[division],matches:[match]};
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));

test('assigned or completed games print blank court, PIN, and final score cells', () => {
  const html = render(PrintMatchCard, {state,match});
  assert.doesNotMatch(html, /91928374|884/);
  assert.match(html, /Court #:/); assert.match(html, /Umpire PIN:/);
  assert.match(html, /data-field="court"><\/span>/); assert.match(html, /data-field="umpire-pin"><\/span>/);
  const cells = [...html.matchAll(/<td[^>]*>(.*?)<\/td>/gs)];
  assert.equal(cells.length,6); assert.ok(cells.every(cell => cell[1] === ''));
  assert.doesNotMatch(html, /\b27\b|\b25\b|\b26\b|\b24\b/);
  assert.equal((html.match(/type="checkbox"/g)||[]).length,2); assert.doesNotMatch(html,/ checked=""/);
});

test('doubles provide four individual named signature lines and the match scoring rules', () => {
  const html = render(PrintMatchCard, {state,match});
  for (const name of ['Alex','Sam','Chris','Pat']) assert.ok(html.includes(`<span>${name}:</span>`));
  assert.equal((html.match(/aria-label="Player \d, side [AB], signature"/g)||[]).length,4);
  assert.match(html,/Best of 3 · First to 21 · Win by 2 · Cap 30/);
  assert.match(html,/Leave unused sets blank/); assert.doesNotMatch(html,/tally-side|MANUAL UMPIRE SCORECARD/);
});

test('singles and sudden-death formats print one final-score row with two signatures', () => {
  const singleDivision = {...division,mode:'singles',entries:division.entries.map(entry => ({...entry,name:entry.players[0],players:[entry.players[0]]}))};
  const singleMatch = {...match,format:'single_31',scoring:{mode:'first_to_target',target:31,cap:35}};
  const singleState = {...state,divisions:[singleDivision],matches:[singleMatch]};
  const html = render(PrintMatchCard,{state:singleState,match:singleMatch});
  assert.equal((html.match(/<td /g)||[]).length,2);
  assert.equal((html.match(/aria-label="Player \d, side [AB], signature"/g)||[]).length,2);
  assert.match(html,/Single set · First to 31/); assert.doesNotMatch(html,/Win by 2|Cap 35|Leave unused sets/);
  assert.match(html,/PLAYER A/); assert.match(html,/PLAYER B/);
});

test('unresolved knockout entrants retain separate blank player signature lines', () => {
  const unresolved = {...match,entryAId:null,entryBId:null};
  const html = render(PrintMatchCard,{state:{...state,matches:[unresolved]},match:unresolved});
  assert.equal((html.match(/aria-label="Player \d, side [AB], signature"/g)||[]).length,4);
  assert.equal((html.match(/<span>Player 1:<\/span>/g)||[]).length,2);
  assert.equal((html.match(/<span>Player 2:<\/span>/g)||[]).length,2);
  assert.match(html,/<th scope="col">Pair A<\/th>/); assert.match(html,/<th scope="col">Pair B<\/th>/);
});

test('long names remain in the matchup and signatures with clear pair labels in the score table', () => {
  const longDivision = {...division,entries:[{...division.entries[0],name:'Alexandra Marie Taboada / Samantha Rose Fernandez',players:['Alexandra Marie Taboada','Samantha Rose Fernandez']},{...division.entries[1],name:'Christopher James Ramirez / Patricia Anne Gonzales',players:['Christopher James Ramirez','Patricia Anne Gonzales']}]};
  const html = render(PrintMatchCard,{state:{...state,divisions:[longDivision]},match});
  for (const entry of longDivision.entries) {
    assert.ok(html.includes(`<h2>${entry.name}</h2>`));
    for (const name of entry.players) assert.ok(html.includes(`<span>${name}:</span>`));
  }
  assert.match(html,/<th scope="col">Pair A<\/th>/); assert.match(html,/<th scope="col">Pair B<\/th>/);
  assert.equal((html.match(/aria-label="Player \d, side [AB], signature"/g)||[]).length,4);
});

test('bulk printing keeps every game, schedule order, and the same stable game numbers as the desk', () => {
  const batchState = {...state,matches:[{...match,id:'late',scheduledAt:'2026-11-29T05:00:00Z'},{...match,id:'early',scheduledAt:'2026-11-29T03:00:00Z'},{...match,id:'unscheduled',scheduledAt:null}]};
  const html = render(PrintMatchCards,{state:batchState});
  const numbers = [...html.matchAll(/aria-label="Game (\d) match card"/g)].map(item => item[1]);
  assert.deepEqual(numbers,['2','1','3']);
  assert.equal((html.match(/data-field="umpire-pin"/g)||[]).length,3);
  const selected = render(PrintMatchCards,{state:batchState,matchId:'late'});
  assert.equal((selected.match(/class="print-match-card"/g)||[]).length,1);
  assert.match(selected,/Game 1 match card/);
});
