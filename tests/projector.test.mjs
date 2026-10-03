import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
const dir = await mkdtemp(path.join(tmpdir(), 'projector-'));
await build({entryPoints:['lib/projector.ts'],outfile:path.join(dir,'logic.mjs'),bundle:true,platform:'node',format:'esm'});
const {paginateRows}=await import(pathToFileURL(path.join(dir,'logic.mjs')));
const {paginateCourts,projectorCourts}=await import(pathToFileURL(path.join(dir,'logic.mjs')));
await build({entryPoints:['lib/tournament.ts'],outfile:path.join(dir,'tournament.mjs'),bundle:true,platform:'node',format:'esm'});
await build({entryPoints:['lib/projector-settings.ts'],outfile:path.join(dir,'settings.mjs'),bundle:true,platform:'node',format:'esm'});
const {initialTournament,hydrateTournament,makeEntry}=await import(pathToFileURL(path.join(dir,'tournament.mjs')));
const {normalizeProjectorSettings}=await import(pathToFileURL(path.join(dir,'settings.mjs')));
const require=createRequire(import.meta.url);
await build({entryPoints:['app/components/projector-courts.tsx'],outfile:path.join(dir,'courts.mjs'),bundle:true,platform:'node',format:'esm',plugins:[{name:'portable-shared-react',setup(build){build.onResolve({filter:/^react(?:\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
const {ProjectorCourts}=await import(pathToFileURL(path.join(dir,'courts.mjs')));
test('projector pages cover every row once for growing and shrinking lists and screen sizes',()=>{
 for(const count of [0,1,4,17,64,128])for(const available of [150,400,850]){
  const heights=Array.from({length:count},(_,i)=>i%3===0?90:48);
  const pages=paginateRows(heights,available);
  assert.deepEqual(pages.flatMap(p=>Array.from({length:p.end-p.start},(_,i)=>p.start+i)),Array.from({length:count},(_,i)=>i));
  for(const p of pages)assert.ok(heights.slice(p.start,p.end).reduce((a,b)=>a+b,0)<=available);
 }
});
test('long rows are kept whole and empty sections have one page',()=>{
 assert.deepEqual(paginateRows([50,300,50],150),[{start:0,end:1},{start:1,end:2},{start:2,end:3}]);
 assert.deepEqual(paginateRows([],150),[{start:0,end:0}]);
 assert.deepEqual(paginateRows([50,50],100),[{start:0,end:2}]);
});

test('court grid pagination preserves every court and keeps each measured row whole',()=>{
 for(const count of [0,1,4,12,24,64])for(const columns of [1,2,3,6])for(const available of [160,400,850]){
  const heights=Array.from({length:count},(_,i)=>i%4===0?330:270);
  const pages=paginateCourts(heights,columns,available,16);
  assert.deepEqual(pages.flatMap(p=>Array.from({length:p.end-p.start},(_,i)=>p.start+i)),Array.from({length:count},(_,i)=>i));
  for(const p of pages){assert.equal(p.start%columns,0);assert.ok(p.end===count||p.end%columns===0);}
 }
 assert.deepEqual(paginateCourts(Array(12).fill(280),6,600),[{start:0,end:12}]);
 assert.deepEqual(paginateCourts([100,100,100,100],2,210,16),[{start:0,end:2},{start:2,end:4}]);
});

test('court overview distinguishes physical occupation, reservations, plans and released sets',()=>{
 const state=initialTournament();state.courts=12;state.status='live';
 const d=state.divisions[0];d.registrationManaged=false;d.entries=[makeEntry(0,'doubles'),makeEntry(1,'doubles')];d.entries[0].players=['Miguel Santos','Paolo Reyes'];
 const game=(court,extra={})=>({id:`court-${court}`,divisionId:d.id,entryAId:d.entries[0].id,entryBId:d.entries[1].id,stage:'regular',round:1,label:'Sample match',format:'single_31',pin:'7319',court,scheduledAt:null,status:'ready',validated:false,sets:[{a:18,b:16,complete:false}],...extra});
 state.matches=[game(1,{status:'live',courtInUse:true}),game(2),game(3,{dispatchedAt:'2026-10-03T01:00:00Z',courtInUse:false}),game(4,{status:'finished',sets:[{a:31,b:28,complete:true}]}),game(5,{status:'live',courtInUse:false,dispatchedAt:'2026-10-03T01:00:00Z',format:'best_of_3_21',sets:[{a:21,b:18,complete:true}]}),game(6,{status:'live',courtInUse:true,format:'best_of_3_21',sets:[{a:21,b:18,complete:true},{a:4,b:6,complete:false}]})];
 const courts=projectorCourts(state);
 assert.equal(courts.length,12);assert.deepEqual(courts.map(c=>c.status),['in_play','available','reserved','available','available','in_play',...Array(6).fill('available')]);
 assert.deepEqual(courts[0].game.playersA,['Miguel Santos','Paolo Reyes']);assert.equal(courts[0].game.number,1);
 assert.equal(courts[5].game.setNumber,2);assert.equal(courts[5].game.scoreB,6);assert.equal(courts[1].game,undefined);
 assert.ok(!JSON.stringify(courts).includes('7319'));
});

test('legacy states receive safe defaults and preferences normalize order, duplicates and duration bounds',()=>{
 const state=initialTournament();delete state.projector;
 const hydrated=hydrateTournament(state);assert.equal(hydrated.version,5);assert.equal(hydrated.projector.slides[0].id,'courts');assert.equal(hydrated.projector.slides[0].seconds,30);
 const preferences=normalizeProjectorSettings({slides:[{id:'standings',enabled:false,seconds:999},{id:'courts',enabled:true,seconds:0},{id:'courts',seconds:23},{id:'live',seconds:NaN},{id:'private',seconds:20}],showPlayers:false,autoAdvance:false,secret:'hidden'});
 assert.deepEqual(preferences.slides.map(s=>s.id),['standings','courts','live','upcoming','finished']);assert.equal(preferences.slides[0].seconds,300);assert.equal(preferences.slides[1].seconds,5);assert.equal(preferences.slides[2].seconds,20);
 assert.equal(preferences.autoAdvance,false);assert.equal(preferences.showPlayers,false);assert.equal(preferences.showScores,true);assert.equal(preferences.secret,undefined);
 assert.deepEqual(normalizeProjectorSettings(preferences),preferences);
});

test('public court rendering never exposes private fields and honors name, score and metadata choices',()=>{
 const settings=normalizeProjectorSettings();
 const courts=[{court:1,status:'in_play',game:{number:7,division:'Level E',playersA:['Miguel Santos','Paolo Reyes'],playersB:['Adrian Cruz','Nico Garcia'],scoreA:18,scoreB:16,setNumber:1,multipleSets:false}},{court:2,status:'reserved',game:{number:8,division:'Level F',playersA:['Bea Mendoza','Carla Flores'],playersB:['Dani Ramos','Ella Aquino'],scoreA:0,scoreB:0,setNumber:1,multipleSets:false}},{court:3,status:'available'}];
 // Extra private properties are deliberately not part of the renderer's contract.
 courts[0].pin='7319';courts[0].phone='09123456789';
 const html=renderToStaticMarkup(React.createElement(ProjectorCourts,{courts,allCourts:courts,settings,tournamentName:'Racketeers'}));
 assert.match(html,/Miguel Santos/);assert.match(html,/Awaiting players/);assert.match(html,/No game assigned/);assert.equal((html.match(/<article /g)||[]).length,3);assert.ok(!html.includes('7319'));assert.ok(!html.includes('09123456789'));assert.ok(!html.includes('>0</b>'));
 const hidden=renderToStaticMarkup(React.createElement(ProjectorCourts,{courts,allCourts:courts,settings:{...settings,showPlayers:false,showScores:false,showGameInfo:false},tournamentName:'Racketeers'}));
 assert.ok(!hidden.includes('Miguel Santos'));assert.ok(!hidden.includes('Level E'));assert.ok(!hidden.includes('Side A score'));assert.match(hidden,/Side A/);assert.match(hidden,/Awaiting players/);
});
test.after(()=>rm(dir,{recursive:true,force:true}));
