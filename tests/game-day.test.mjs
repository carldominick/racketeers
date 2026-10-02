import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(path.join(tmpdir(),'game-day-'));
for(const [file,source] of [['logic','lib/tournament.ts'],['desk','lib/game-day.ts'],['events','lib/staff-events.ts']]) await build({entryPoints:[source],outfile:path.join(dir,`${file}.mjs`),bundle:true,platform:'node',format:'esm'});
const logic=await import(pathToFileURL(path.join(dir,'logic.mjs')));
const desk=await import(pathToFileURL(path.join(dir,'desk.mjs')));
const events=await import(pathToFileURL(path.join(dir,'events.mjs')));
function fixture(){
 const divisions=['A','B','C','D'].map(name=>({...logic.makeDivision(name,'doubles'),id:name,entries:Array.from({length:8},(_,i)=>({id:`${name}${i}`,name:`${name} pair ${i}`,players:[`${name} player ${i}a`,`${name} player ${i}b`]}))}));
 const matches=divisions.flatMap(d=>Array.from({length:4},(_,i)=>({id:`${d.id}-m${i}`,divisionId:d.id,stage:'regular',round:1,label:`Game ${i+1}`,entryAId:`${d.id}${i*2}`,entryBId:`${d.id}${i*2+1}`,sets:[{a:0,b:0,complete:false}],status:'ready',court:null,validated:false,pin:`${d.id.charCodeAt(0)}${10+i}`,format:'single_31',scoring:{mode:'first_to_target',target:31,cap:31},subBracket:0,scheduledAt:null})));
 return {...logic.initialTournament(),status:'live',divisions,matches,gameDay:{evenRotation:true,restMinutes:15,nearCapEnabled:true,nearCapPoints:5}};
}
test('round robin dispatch visits every bracket before its second turn',()=>{
 let state=fixture();const order=[];
 for(let i=0;i<8;i++){
  const next=desk.gameQueue(state).ready[0];order.push(next.divisionId);
  const dispatched=desk.dispatchGame(state,next.id,1,Date.now()+i);assert.ok(dispatched.state);state=dispatched.state;
  state={...state,matches:state.matches.map(m=>m.id===next.id?{...m,court:null,status:'finished',validated:true}:m)};
 }
 assert.deepEqual(order,['A','B','C','D','A','B','C','D']);
});
test('rotation distinguishes two pools in the same division',()=>{
 const state=fixture();state.matches[1].subBracket=1;state.matches[2].subBracket=1;
 const keys=desk.gameQueue(state).ready.slice(0,5).map(desk.bracketKey);
 assert.deepEqual(keys,['A:0','A:1','B:0','C:0','D:0']);
});
test('busy brackets are skipped and restored, repeated refresh never consumes a turn',()=>{
 const state=fixture();for(const m of state.matches.filter(m=>m.divisionId==='A')) m.entryAId='A0';
 state.matches[0]={...state.matches[0],status:'live',court:1,courtInUse:true};
 const queue=desk.gameQueue(state);assert.equal(queue.ready[0].divisionId,'B');assert.ok(queue.waiting.every(m=>m.divisionId==='A'));assert.deepEqual(desk.gameQueue(state).ready,queue.ready);
 const restored={...state,matches:state.matches.map(m=>m.id===state.matches[0].id?{...m,status:'finished',validated:true}:m)};
 assert.equal(desk.gameQueue(restored).ready[0].divisionId,'A');
});
test('two free courts reserve distinct games and busy players cannot be dispatched twice',()=>{
 let state=fixture();let result=desk.dispatchGame(state,'A-m0',1);state=result.state;
 assert.equal(state.matches[0].status,'ready');assert.equal(state.matches[0].sets[0].a,0);assert.equal(desk.courtOccupant(state,1).id,'A-m0');
 assert.match(desk.dispatchGame(state,'B-m0',1).error,/already/);
 result=desk.dispatchGame(state,'B-m0',2);assert.ok(result.state);state=result.state;
 state.matches.find(m=>m.id==='C-m0').entryAId='A0';
 // Missing entries in the wrong division are ineligible, too.
 assert.ok(desk.dispatchGame(state,'C-m0',3).error);
 assert.equal(desk.gameQueue(state).ready.some(m=>m.id==='A-m0'),false);
});
test('rest uses recorded completion, expires predictably, and finished courts are available before validation',()=>{
 const state=fixture(),now=Date.now();state.matches[0]={...state.matches[0],status:'finished',court:1,completedAt:new Date(now-5*60000).toISOString(),sets:[{a:31,b:20,complete:true}]};
 state.matches[1].entryAId='A0';
 assert.equal(desk.courtOccupant(state,1),undefined);
 assert.equal(desk.gameEligibility(state,state.matches[1],now).reason,'Players resting');
 assert.equal(desk.gameEligibility(state,state.matches[1],now+10*60000).ready,true);
});
test('shared player identity blocks a second-division entry while its game is live',()=>{
 const state=fixture();state.registrations=[{id:'r1',personId:'same-person'},{id:'r2',personId:'same-person'}];
 state.divisions[0].entries[0].registrationIds=['r1'];state.divisions[1].entries[0].registrationIds=['r2'];
 state.matches[0]={...state.matches[0],status:'live',court:1,courtInUse:true};
 assert.match(desk.gameEligibility(state,state.matches.find(m=>m.id==='B-m0')).reason,/Players busy/);
});
test('automatic championship players stay blocked until all required earlier results are validated',()=>{
 const state=fixture();state.matches.push({...state.matches[0],id:'final',stage:'gold',round:3});
 assert.match(desk.gameEligibility(state,state.matches.at(-1)).reason,/validated/);
 state.matches=state.matches.map(m=>m.id==='final'?m:m.divisionId==='A'?{...m,validated:true}:m);
 assert.equal(desk.gameEligibility(state,state.matches.at(-1)).ready,true);
});
test('near-cap uses a first-to target or capped stage limit and respects the off setting',()=>{
 const state=fixture();const m=state.matches[0];Object.assign(m,{status:'live',court:1,courtInUse:true,sets:[{a:26,b:22,complete:false}]});
 assert.equal(desk.nearCapSignal(state,m).remaining,5);
 m.scoring={mode:'capped_win_by_two',target:31,cap:35};assert.equal(desk.nearCapSignal(state,m),null);
 m.sets=[{a:30,b:29,complete:false}];assert.equal(desk.nearCapSignal(state,m).remaining,5);
 state.gameDay.nearCapEnabled=false;assert.equal(desk.nearCapSignal(state,m),null);
});
test('multi-set warning occurs only when a near-cap side can finish the whole match',()=>{
 const state=fixture(),m=state.matches[0];Object.assign(m,{status:'live',court:1,format:'best_of_3_21',scoring:{mode:'first_to_target',target:21,cap:21},sets:[{a:16,b:15,complete:false}]});
 assert.equal(desk.nearCapSignal(state,m),null);
 m.sets=[{a:21,b:10,complete:true},{a:15,b:18,complete:false}];assert.equal(desk.nearCapSignal(state,m),null);
 m.sets[1].a=16;assert.equal(desk.nearCapSignal(state,m).setNumber,2);
});
test('threshold event is emitted once across polling, corrections and repeated saves; reset permits a new warning',()=>{
 const previous=fixture();Object.assign(previous.matches[0],{status:'live',court:1,sets:[{a:25,b:20,complete:false}]});
 let next={...previous,matches:previous.matches.map((m,i)=>i?m:{...m,sets:[{a:26,b:20,complete:false}]})};
 next=events.recordCourtCompletions(previous,next);assert.equal(next.staffNotifications.filter(n=>n.kind==='near_cap').length,1);
 assert.equal(events.recordCourtCompletions(next,next).staffNotifications.length,1);
 const corrected={...next,matches:next.matches.map((m,i)=>i?m:{...m,sets:[{a:25,b:20,complete:false}]})};
 const warnedAgain=events.recordCourtCompletions(corrected,{...corrected,matches:corrected.matches.map((m,i)=>i?m:{...m,sets:[{a:26,b:20,complete:false}]})});assert.equal(warnedAgain.staffNotifications.length,1);
 const reset={...warnedAgain,matches:warnedAgain.matches.map((m,i)=>i?m:{...m,status:'ready',nearCapNotified:false,sets:[{a:0,b:0,complete:false}]})};
 const restarted={...reset,matches:reset.matches.map((m,i)=>i?m:{...m,status:'live',sets:[{a:26,b:20,complete:false}]})};
 assert.equal(events.recordCourtCompletions(reset,restarted).staffNotifications.filter(n=>n.kind==='near_cap').length,2);
});
test('completion timestamps are not retroactively assigned to historical games',()=>{
 const state=fixture();state.matches[0]={...state.matches[0],status:'finished',sets:[{a:31,b:10,complete:true}]};
 assert.equal(events.recordCourtCompletions(state,state).matches[0].completedAt,undefined);
});
test('public next-player callouts map different pending games to simultaneous court warnings',()=>{
 const state=fixture();Object.assign(state.matches[0],{status:'live',court:1,sets:[{a:26,b:20,complete:false}]});Object.assign(state.matches[4],{status:'live',court:2,sets:[{a:26,b:20,complete:false}]});
 const calls=desk.nextGameCalls(state);assert.equal(calls.length,2);assert.notEqual(calls[0].next.id,calls[1].next.id);
});
test.after(()=>rm(dir,{recursive:true,force:true}));
