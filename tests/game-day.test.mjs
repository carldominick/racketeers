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
test('queue selection combines divisions and Philippine schedule dates before rotating or recommending games',()=>{
 const state={...fixture(),courts:2};
 const byId=id=>state.matches.find(match=>match.id===id);
 byId('A-m0').scheduledAt='2026-11-28T16:00:00.000Z';
 byId('A-m1').scheduledAt='2026-11-28T15:59:00.000Z';
 byId('B-m0').scheduledAt='2026-11-28T16:10:00.000Z';
 byId('C-m0').scheduledAt='2026-11-29T15:59:00.000Z';
 byId('C-m1').scheduledAt='2026-11-29T16:00:00.000Z';
 state.gameDay={...state.gameDay,nextBracketKey:'B:0',queue:{divisionIds:['A','C'],schedule:'2026-11-29'}};
 assert.equal(desk.scheduledGameDate(byId('A-m0').scheduledAt),'2026-11-29');
 assert.deepEqual(desk.gameQueue(state).ready.map(match=>match.id),['C-m0','A-m0']);
 assert.deepEqual(desk.gameQueue(state).rotation.map(item=>item.key),['C:0','A:0']);
 assert.deepEqual(desk.courtRecommendations(state).map(item=>item.match.id),['C-m0','A-m0']);
 assert.match(desk.dispatchGame(state,'B-m0',1).error,/outside the current queue selection/);
 assert.match(desk.dispatchGame(state,'A-m1',1).error,/outside the current queue selection/);
 assert.equal(state.gameDay.nextBracketKey,'B:0');
 const assigned=desk.dispatchGame(state,'C-m0',1).state;
 assert.deepEqual(assigned.gameDay.queue,state.gameDay.queue);
 assert.deepEqual(desk.gameQueue(assigned).ready.map(match=>match.id),['A-m0']);
 const unscheduled={...state,gameDay:{...state.gameDay,queue:{divisionIds:['A'],schedule:'unscheduled'}}};
 assert.deepEqual(desk.gameQueue(unscheduled).ready.map(match=>match.id),['A-m2','A-m3']);
 const paused={...state,gameDay:{...state.gameDay,queue:{divisionIds:[]}}};
 assert.deepEqual(desk.gameQueue(paused).ready,[]);
 assert.deepEqual(desk.courtRecommendations(paused),[]);
});
test('excluded reservations still occupy courts and block overlapping players',()=>{
 const state=fixture();
 state.registrations=[{id:'r1',personId:'same-person'},{id:'r2',personId:'same-person'}];
 state.divisions[0].entries[0].registrationIds=['r1'];
 state.divisions[1].entries[0].registrationIds=['r2'];
 const assigned=desk.dispatchGame(state,'A-m0',1).state;
 const held=desk.gameDayAction(assigned,'holdGame','D-m0').state;
 const scoped={...held,gameDay:{...held.gameDay,queue:{divisionIds:['B']}}};
 assert.equal(desk.courtOccupant(scoped,1).id,'A-m0');
 assert.equal(desk.gameEligibility(scoped,scoped.matches[0],Date.now(),true).ready,true);
 assert.deepEqual(desk.gameQueue(scoped).waiting.map(match=>match.id),['B-m0']);
 assert.deepEqual(desk.gameQueue(scoped).held.map(match=>match.id),['D-m0']);
 assert.equal(desk.courtRecommendations(scoped)[0].court,2);
 assert.ok(desk.courtRecommendations(scoped).every(item=>item.match.divisionId==='B'));
});
test('round robin dispatch visits every bracket before its second turn',()=>{
 let state=fixture();const order=[];
 for(let i=0;i<8;i++){
  const next=desk.gameQueue(state).ready[0];order.push(next.divisionId);
  const dispatched=desk.dispatchGame(state,next.id,1,Date.now()+i);assert.ok(dispatched.state);state=dispatched.state;
  state={...state,matches:state.matches.map(m=>m.id===next.id?{...m,court:null,status:'finished',validated:true}:m)};
 }
 assert.deepEqual(order,['A','B','C','D','A','B','C','D']);
});
test('finishing a game frees its court for an eligible recommendation and starts player rest',()=>{
 const state={...fixture(),courts:1};
 const [game, next, waiting]=state.matches;
 Object.assign(game,{status:'live',court:1,courtInUse:true,sets:[{a:31,b:17,complete:false}]});
 waiting.entryAId=game.entryAId;
 const scored=logic.applyUmpireSets(game,[{a:31,b:17,complete:true}],true);
 const pending=events.recordCourtCompletions(state,{...state,matches:[scored,...state.matches.slice(1)]});
 assert.equal(desk.courtOccupant(pending,1)?.id,game.id);
 assert.equal(desk.isFinished(scored),false);
 assert.deepEqual(desk.courtRecommendations(pending),[]);
 assert.match(desk.gameEligibility(pending,waiting).reason,/Players busy/);
 const completed=events.recordCourtCompletions(pending,{...pending,matches:[logic.completeUmpireGame(scored),...state.matches.slice(1)]});
 assert.equal(desk.courtOccupant(completed,1),undefined);
 assert.deepEqual(desk.courtRecommendations(completed).map(r=>[r.court,r.match.id]),[[1,next.id]]);
 assert.match(desk.gameEligibility(completed,waiting).reason,/Players resting/);
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

function ladderFixture(size, count, bracketFormat = 'round_robin') {
 const division = {...logic.makeDivision('Ladder', 'singles'), registrationManaged:false, playerCount:count, knockoutSize:size, championshipFormat:'ladderized', bracketFormat};
 division.entries = Array.from({length:count}, (_, index) => ({id:'seed-' + index, name:'Player ' + index, players:['Player ' + index]}));
 const state = logic.regenerateMatches({...logic.initialTournament(), status:'live', gameDay:{restMinutes:0}, divisions:[division]});
 return logic.reseedChampionships({...state, matches:state.matches.map(match => match.stage !== 'regular' || !match.entryBId ? match :
  {...match, status:'finished', validated:true, sets:[{a:31,b:12,complete:true}]})});
}

test('each ladder seed is assigned once across supported sizes and entrant counts',()=>{
 for (const size of [2,4,8,16,32,64]) {
  for (let count = 2; count <= size; count++) {
   const state = ladderFixture(size, count, 'single_elimination');
   const firstRound = state.matches.filter(match => match.stage !== 'regular' && match.stage !== 'bronze' && match.round === 1);
   const entrants = firstRound.flatMap(match => [match.entryAId,match.entryBId]).filter(Boolean);
   assert.equal(entrants.length, count, size + ' slots for ' + count);
   assert.equal(new Set(entrants).size, count, 'each qualifier must appear exactly once');
  }
 }
});

test('staff can dispatch every playable ladder round through real and empty byes',()=>{
 for (const [size, count, format] of [[8,5,'round_robin'],[8,6,'round_robin'],[8,5,'single_elimination'],[64,2,'single_elimination']]) {
  let state = ladderFixture(size,count,format);
  const losers = new Set();
  const lastRound = Math.max(...state.matches.map(match => match.round));
  for (let round = 1; round <= lastRound; round++) {
   for (const {id} of state.matches.filter(match => match.stage !== 'regular' && match.stage !== 'bronze' && match.round === round)) {
    const game = state.matches.find(match => match.id === id);
    if (!game.entryAId || !game.entryBId) continue;
    assert.ok(!losers.has(game.entryAId) && !losers.has(game.entryBId));
    const dispatched = desk.gameDayAction(state,'dispatchGame', id,{court:1});
    assert.ok(dispatched.state, dispatched.error);
    const forfeited = desk.gameDayAction(dispatched.state,'forfeitGame',id,{forfeitingEntryId:game.entryBId});
    assert.ok(forfeited.state, forfeited.error);
    state = logic.validateTournamentMatch(forfeited.state,id);
    losers.add(game.entryBId);
   }
  }
  assert.equal(losers.size,count-1);
  assert.ok(logic.medalResults(state,state.divisions[0].id)[0].entryId);
 }
});

test('a known ladder feeder cannot turn an unfinished opposing feeder into a bye',()=>{
 const state = ladderFixture(8,5);
 const semifinal = state.matches.find(match => match.stage === 'semifinal' && Boolean(match.entryAId) !== Boolean(match.entryBId));
 assert.ok(semifinal);
 const gold = state.matches.find(match => match.stage === 'gold');
 assert.ok(![gold.entryAId,gold.entryBId].includes(semifinal.entryAId ?? semifinal.entryBId));
 assert.equal(desk.gameEligibility(state,gold).ready,false);
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
test('court recommendations fill free courts in rotation, skip held games and never share players',()=>{
 const state=fixture();state.courts=4;state.matches[4].entryAId='B2';state.divisions[1].entries[2].players=state.divisions[0].entries[0].players;
 state.matches[8].hold={reason:'Waiting for partner',heldAt:new Date().toISOString()};
 const before=structuredClone(state), recommendations=desk.courtRecommendations(state);
 assert.deepEqual(recommendations.map(r=>[r.court,r.match.id]),[[1,'A-m0'],[2,'B-m2'],[3,'C-m1'],[4,'D-m0']]);
 assert.deepEqual(state,before);assert.deepEqual(desk.courtRecommendations(state),recommendations);
 const occupied=desk.dispatchGame(state,'A-m0',1).state;
 assert.equal(desk.courtRecommendations(occupied)[0].court,2);
 occupied.matches[0]={...occupied.matches[0],sets:[{a:31,b:10,complete:true}],status:'live',courtInUse:false};
 assert.equal(desk.courtRecommendations(occupied).find(item=>item.match.divisionId==='A').court,1);
});

test('a bracket returns to its first court after validation, with a fallback when that court is unavailable',()=>{
 const initial={...fixture(),courts:3};
 initial.gameDay.queue={divisionIds:['A','B']};
 const assigned=desk.dispatchGame(initial,'A-m0',2).state;
 const completed={...assigned,matches:assigned.matches.map((match,index)=>index?match:{
  ...match,status:'finished',dispatchedAt:undefined,sets:[{a:31,b:12,complete:true}],
 })};
 const state=logic.validateTournamentMatch(completed,'A-m0');
 assert.equal(state.matches[0].court,null);
 assert.equal(desk.bracketHomeCourt(state,state.matches[1]),2);
 state.matches[1].court=1;
 state.matches[4].court=2;
 const recommendations=desk.courtRecommendations(state);
 assert.deepEqual(recommendations.map(item=>item.match.id),['B-m0','A-m1','B-m1']);
 assert.equal(recommendations.find(item=>item.match.id==='A-m1').court,2);
 assert.notEqual(recommendations.find(item=>item.match.id==='B-m0').court,2);
 const fallback=desk.courtRecommendations(state,Date.now(),court=>court!==2).find(item=>item.match.id==='A-m1');
 assert.ok(fallback);
 assert.notEqual(fallback.court,2);
 const reassigned=desk.dispatchGame(state,fallback.match.id,fallback.court).state;
 assert.equal(reassigned.matches[1].court,fallback.court);
 assert.equal(desk.bracketHomeCourt(reassigned,reassigned.matches[2]),2);
});

test('separate pools and championship rounds have independent preferred courts',()=>{
 let state={...fixture(),courts:4};
 state.matches[1].subBracket=1;
 state.matches[2].subBracket=1;
 const final={...state.matches[3],id:'A-final',stage:'gold'};
 state.matches[4]={...state.matches[4],status:'finished',validated:true,umpireWorkflow:{phase:'completed',court:4}};
 state=desk.dispatchGame(state,'A-m0',3).state;
 state=desk.dispatchGame(state,'A-m1',2).state;
 assert.equal(desk.bracketHomeCourt(state,state.matches[0]),3);
 assert.equal(desk.bracketHomeCourt(state,state.matches[2]),2);
 assert.equal(desk.bracketHomeCourt(state,state.matches[5]),4);
 assert.equal(desk.bracketHomeCourt(state,final),undefined);
});

test('a reserved game can be held and returned without consuming rotation or restoring its old court',()=>{
 const original=fixture();let state=desk.dispatchGame(original,'A-m0',1).state;const cursor=state.gameDay.nextBracketKey;
 state=desk.gameDayAction(state,'holdGame','A-m0',{reason:'  Waiting for partner  '},1000).state;
 assert.equal(state.matches[0].hold.reason,'Waiting for partner');assert.equal(state.matches[0].court,null);assert.equal(state.matches[0].dispatchedAt,undefined);
 assert.equal(desk.courtOccupant(state,1),undefined);assert.equal(state.gameDay.nextBracketKey,cursor);assert.equal(desk.gameQueue(state).held[0].id,'A-m0');assert.equal(desk.gameQueue(state).ready.some(m=>m.id==='A-m0'),false);
 assert.match(desk.dispatchGame(state,'A-m0',1).error,/hold/);
 assert.equal(logic.adjustMatchScore(state.matches[0],0,'a',1),state.matches[0]);
 state=desk.gameDayAction(state,'resumeGame','A-m0').state;assert.equal(state.matches[0].hold,undefined);assert.equal(state.matches[0].court,null);assert.equal(state.gameDay.nextBracketKey,cursor);
 state.matches[1]={...state.matches[1],status:'live',entryAId:'A0',court:2,courtInUse:true};assert.match(desk.gameEligibility(state,state.matches[0]).reason,/Players busy/);
});

test('holds reject started, scored, completed and validated games',()=>{
 for(const patch of [{status:'live'},{court:1,courtInUse:true},{sets:[{a:1,b:0,complete:false}]},{status:'finished'},{validated:true}]){
  const state=fixture();Object.assign(state.matches[0],patch);assert.ok(desk.gameDayAction(state,'holdGame','A-m0').error);
 }
});

test('no-show forfeits release courts, retain actual points and count only after validation',()=>{
 let state=fixture();state.matches[0]={...state.matches[0],status:'live',court:1,courtInUse:true,sets:[{a:12,b:7,complete:false}]};
 const scores=structuredClone(state.matches[0].sets);
 state=desk.gameDayAction(state,'forfeitGame','A-m0',{forfeitingEntryId:'A0'},1000).state;
 const match=state.matches[0];assert.equal(logic.matchWinner(match),'A1');assert.deepEqual(match.sets,scores);assert.equal(desk.courtOccupant(state,1),undefined);assert.equal(desk.gameQueue(state).ready.some(m=>m.id===match.id),false);
 assert.equal(logic.standingsFor(state,'A').find(r=>r.entryId==='A1').wins,0);
 assert.equal(logic.adjustMatchScore(match,0,'a',1),match);assert.equal(logic.uncompleteMatchSet(match,0),match);
 const validated=logic.validateTournamentMatch(state,match.id);const rows=logic.standingsFor(validated,'A');
 assert.equal(rows.find(r=>r.entryId==='A1').wins,1);assert.equal(rows.find(r=>r.entryId==='A0').losses,1);assert.equal(rows.find(r=>r.entryId==='A1').pointsFor,31);assert.equal(rows.find(r=>r.entryId==='A0').pointsFor,0);assert.equal(rows.find(r=>r.entryId==='A1').difference,31);assert.equal(rows.find(r=>r.entryId==='A0').pointsAgainst,31);
 assert.ok(desk.gameDayAction(validated,'clearForfeit',match.id).error);
 state=logic.unvalidateTournamentMatch(validated,match.id);assert.equal(state.matches[0].status,'finished');
 state=desk.gameDayAction(state,'clearForfeit',match.id).state;assert.equal(state.matches[0].status,'live');assert.equal(state.matches[0].court,null);assert.deepEqual(state.matches[0].sets,scores);assert.equal(logic.matchWinner(state.matches[0]),null);
});

test('unplayed no-shows award winning points without adding rest and require a confirmed forfeiting entry',()=>{
 let state=fixture();assert.ok(desk.gameDayAction(state,'forfeitGame','A-m0',{forfeitingEntryId:'unknown'}).error);
 state.matches[1].entryAId='A1';state=desk.gameDayAction(state,'forfeitGame','A-m0',{forfeitingEntryId:'A0'}).state;
 assert.equal(desk.gameEligibility(state,state.matches[1]).ready,true);
 const hydrated=logic.hydrateTournament(state);assert.deepEqual(hydrated.matches[0].forfeit,state.matches[0].forfeit);
 state=logic.validateTournamentMatch(state,'A-m0');const rows=logic.standingsFor(state,'A');assert.equal(rows.find(r=>r.entryId==='A1').wins,1);assert.equal(rows.find(r=>r.entryId==='A1').pointsFor,31);assert.equal(rows.find(r=>r.entryId==='A0').pointsFor,0);
 assert.match(logic.matchScoreText(state.matches[0]),/Forfeit.*0 – 31/);
 const unresolved=fixture();unresolved.matches[0].entryBId=null;assert.ok(desk.gameDayAction(unresolved,'forfeitGame','A-m0',{forfeitingEntryId:'A0'}).error);
});

test('forfeits award the configured score and two straight sets for best-of-three, in either direction',()=>{
 for(const [format,scoring,points,count] of [
  ['single_31',undefined,31,1],['single_21',undefined,21,1],['best_of_3_21',undefined,21,2],
  ['single_31',{mode:'first_to_target',target:15,cap:15},15,1],
  ['best_of_3_21',{mode:'capped_win_by_two',target:25,cap:30},25,2],
  ['single_21',{mode:'capped_win_by_two',target:1,cap:3},2,1],
 ]) for(const absent of ['A0','A1']){
  let state=fixture();Object.assign(state.matches[0],{format,scoring,sets:[{a:9,b:4,complete:false}]});
  state=desk.gameDayAction(state,'forfeitGame','A-m0',{forfeitingEntryId:absent}).state;
  const match=state.matches[0],winner=absent==='A0'?'A1':'A0';
  assert.equal(match.forfeit.points,points);assert.equal(logic.matchWinner(match),winner);
  const expected=Array.from({length:count},()=>({a:absent==='A0'?0:points,b:absent==='A1'?0:points,complete:true}));
  assert.deepEqual(logic.matchResultSets(match),expected);assert.ok(expected.every(set=>logic.isSetWon(set,match.stage,format,scoring)));
  assert.equal(logic.matchScoreText(match),`Forfeit · ${expected.map(s=>`${s.a} – ${s.b}`).join(' / ')}`);
  const rows=logic.standingsFor(logic.validateTournamentMatch(state,match.id),'A');
  assert.equal(rows.find(r=>r.entryId===winner).pointsFor,points*count);assert.equal(rows.find(r=>r.entryId===absent).pointsFor,0);
  assert.deepEqual(match.sets,[{a:9,b:4,complete:false}]);
 }
});

test('captured awards survive hydration and rule edits; legacy forfeits derive awards without overwriting play',()=>{
 let state=fixture();state.divisions[0].stageScoring={regular:{mode:'first_to_target',target:17,cap:17}};
 state=logic.hydrateTournament(state);state=desk.gameDayAction(state,'forfeitGame','A-m0',{forfeitingEntryId:'A1'}).state;
 assert.equal(state.matches[0].forfeit.points,17);
 state.divisions[0].stageScoring.regular={mode:'first_to_target',target:19,cap:19};state=logic.hydrateTournament(state);
 assert.equal(logic.matchResultSets(state.matches[0])[0].a,17);
 const legacy={...state.matches[0],forfeit:{winnerId:'A0',reason:'no_show',recordedAt:new Date().toISOString()},sets:[{a:5,b:8,complete:false}]};
 assert.deepEqual(logic.matchResultSets(legacy),[{a:19,b:0,complete:true}]);assert.deepEqual(legacy.sets,[{a:5,b:8,complete:false}]);
 assert.deepEqual(logic.matchResultSets({...legacy,forfeit:{...legacy.forfeit,winnerId:'unknown'}}),legacy.sets);
 const cleared=desk.gameDayAction({...state,matches:[legacy]},'clearForfeit',legacy.id).state.matches[0];
 assert.deepEqual(logic.matchResultSets(cleared),legacy.sets);assert.equal(cleared.forfeit,undefined);
});

test('forfeiting a live game emits a single durable court release event',()=>{
 const state=fixture();Object.assign(state.matches[0],{status:'live',court:1,courtInUse:true});
 const next=events.recordCourtCompletions(state,desk.gameDayAction(state,'forfeitGame','A-m0',{forfeitingEntryId:'A0'}).state);
 assert.equal(next.staffNotifications.length,1);assert.equal(next.staffNotifications[0].kind,'court_released');assert.equal(next.staffNotifications[0].gameComplete,true);assert.equal(next.staffNotifications[0].available,true);
 assert.equal(events.recordCourtCompletions(next,next).staffNotifications.length,1);
});

test('automatic championship no-shows require confirmed prior results while manual matchups remain usable',()=>{
 const state=fixture();state.matches.push({...state.matches[0],id:'final',stage:'gold',round:3});
 assert.match(desk.gameDayAction(state,'forfeitGame','final',{forfeitingEntryId:'A0'}).error,/validated/);
 state.divisions[0].manualChampionshipMatchups=true;
 assert.ok(desk.gameDayAction(state,'forfeitGame','final',{forfeitingEntryId:'A0'}).state);
});

test('a provisional opening game gets qualified entrants while held and remains off court until resumed',()=>{
 let state=fixture();state.matches.push({...state.matches[0],id:'final',stage:'gold',round:3,entryAId:null,entryBId:null});
 state=desk.gameDayAction(state,'holdGame','final').state;
 state={...state,matches:state.matches.map(m=>m.divisionId==='A'&&m.stage==='regular'?{...m,status:'finished',validated:true,sets:[{a:31,b:20,complete:true}]}:m)};
 state=logic.reseedChampionships(state);
 const held=state.matches.at(-1);
 assert.ok(held.entryAId && held.entryBId && held.hold);
 assert.equal(desk.gameEligibility(state,held).ready,false);
 state=desk.gameDayAction(state,'resumeGame','final').state;
 const final=state.matches.at(-1);assert.ok(final.entryAId&&final.entryBId);assert.equal(final.hold,undefined);assert.equal(final.court,null);assert.equal(desk.gameEligibility(state,final).ready,true);
});

test('a provisional semifinal hold cannot preserve a nonqualifier in the other semifinal',()=>{
 const entryIds=['A','B','C','D','E'];
 const division={...logic.makeDivision('Qualification','singles'),bracketFormat:'custom',customGroupGameCount:2,
  championshipFormat:'ladderized',knockoutSize:4,entries:entryIds.map(id=>({id,name:id,players:[id]}))};
 let state=logic.regenerateMatches({...logic.initialTournament(),status:'live',gameDay:{restMinutes:0},divisions:[division]});
 const [first,last]=state.matches.filter(game=>game.stage==='regular');
 state.matches=state.matches.map(game=>game.id===first.id?{...game,entryAId:'C',entryBId:'D'}:game.id===last.id?{...game,entryAId:'E',entryBId:'A'}:game);
 const validate=(s,id,a,b)=>logic.validateTournamentMatch({...s,matches:s.matches.map(game=>game.id===id?{...game,sets:[{a,b,complete:true}]}:game)},id);
 const semifinal=s=>s.matches.filter(game=>game.stage==='semifinal');
 state=validate(state,first.id,31,29);
 const [held,other]=semifinal(state);
 const provisional=desk.gameDayAction(state,'holdGame',held.id,{reason:'Fixture hold'}).state;
 const corrected=validate(provisional,last.id,31,10);
 const final=semifinal(corrected);
 assert.deepEqual(final.map(game=>[game.entryAId,game.entryBId]),[['E','D'],['C','B']]);
 assert.equal(final[0].hold.reason,'Fixture hold');
 assert.ok(desk.dispatchGame(corrected,other.id,1).state);
 const stale={...corrected,matches:corrected.matches.map(game=>game.id===other.id?{...game,entryAId:'A'}:game)};
 assert.match(desk.dispatchGame(stale,other.id,1).error,/draw to be reviewed/);
 const assigned=desk.dispatchGame(corrected,other.id,1).state;
 assert.equal(logic.publishedQualificationChanged(assigned,logic.unvalidateTournamentMatch(assigned,last.id)),true);
});

test.after(()=>rm(dir,{recursive:true,force:true}));
