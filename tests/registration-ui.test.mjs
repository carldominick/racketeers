import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
const dir=await mkdtemp(path.join(tmpdir(),'registration-ui-'));
await build({jsx:'automatic',stdin:{contents:(await readFile('app/page.tsx','utf8'))+'\nexport { PublicRegistration, TournamentCountdown, UmpireScorecard };',resolveDir:path.resolve('app'),loader:'tsx'},outfile:path.join(dir,'page.mjs'),bundle:true,platform:'node',format:'esm',plugins:[{name:'shared-react',setup(build){build.onResolve({filter:/^react($|\/)/},args=>({path:require.resolve(args.path),external:true}));}}]});
const {default:Home,PublicRegistration,TournamentCountdown,UmpireScorecard}=await import(pathToFileURL(path.join(dir,'page.mjs')));
const state={status:'registration',divisions:[{id:'d',name:'Open Doubles',mode:'doubles'}],registrations:[{id:'one',name:'Alex',facebookProfile:'https://facebook.com/alex.test',phone:'09123456789',divisionId:'d',partnerId:'two',club:'Cebu Club',shirtSize:'L',desiredLevel:'Intermediate'},{id:'two',name:'Sam',facebookProfile:'https://facebook.com/sam.test',phone:'09123456780',divisionId:'d',partnerId:'one',club:'Rackets',shirtSize:'S',desiredLevel:'Advanced'}]};
test('opening page shows registration without a PIN dialog and offers staff access',()=>{
 const html=renderToStaticMarkup(React.createElement(Home));
 assert.doesNotMatch(html,/role="dialog"/);assert.match(html,/class="active">Registration/);
 const nav=html.match(/<nav class="view-switch"[^>]*>(.*?)<\/nav>/s)[1];
 assert.match(nav,/>Staff access</);assert.match(nav,/>Registration</);assert.match(nav,/>Spectator</);assert.doesNotMatch(nav,/>Organizer<|>Umpire<|>Projector</);
});
test('organizer registration dialog uses full player form and required club fields',()=>{
 const html=renderToStaticMarkup(React.createElement(PublicRegistration,{state,organizerPin:'test-only',onSaved(){}}));
 assert.equal((html.match(/<label>Club \/ group/g)||[]).length,2);
 assert.equal((html.match(/Facebook profile link/g)||[]).length,2);assert.equal((html.match(/Phone \/ mobile number/g)||[]).length,2);assert.doesNotMatch(html,/Registered level|Allowed registration levels/);assert.match(html,/Player 1/);assert.match(html,/Player 2 \/ Partner/);assert.match(html,/Submit Registration/);assert.match(html,/Upload payment photo/);
});
test('second-entry form preserves both players and exposes black or tournament shirt choices',()=>{
 const html=renderToStaticMarkup(React.createElement(PublicRegistration,{state,organizerPin:'test-only',initialRegistration:state.registrations[0],onSaved(){}}));
 assert.match(html,/Second entry linked to/);assert.match(html,/Same partner as the first entry/);
 assert.equal((html.match(/<option value="black">Black shirt<\/option>/g)||[]).length,2);
 assert.match(html,/value="https:\/\/facebook.com\/alex.test"/);assert.match(html,/value="https:\/\/facebook.com\/sam.test"/);assert.match(html,/value="09123456780"/);assert.match(html,/value="Sam"/);assert.match(html,/value="Rackets"/);
});
test('spectator countdown shows the scheduled Philippine start and handles missing schedules',()=>{
 const html=renderToStaticMarkup(React.createElement(TournamentCountdown,{state:{...state,tournamentName:'Racketeers',startDate:'2026-10-01',dayStart:'08:30'}}));
 assert.match(html,/Philippine time/);assert.match(html,/Days/);assert.match(html,/Hours/);assert.match(html,/Minutes/);assert.match(html,/Seconds/);assert.match(html,/8:30/);
 const missing=renderToStaticMarkup(React.createElement(TournamentCountdown,{state:{...state,startDate:'',dayStart:''}}));
 assert.match(missing,/schedule coming soon/);assert.doesNotMatch(missing,/NaN|Invalid Date/);
});
test.after(()=>rm(dir,{recursive:true,force:true}));


const umpireFixture = { divisions: [{ id: 'd', name: 'Level D/E', entries: [{id:'a',players:['Alex','Sam']},{id:'b',players:['Chris','Pat']}] }] };
const umpireMatch = { id:'game',divisionId:'d',label:'Group Game 1',entryAId:'a',entryBId:'b',stage:'regular',format:'single_31',court:1,courtInUse:true,status:'live',validated:false,sets:[{a:18,b:16,complete:false}],scoring:{mode:'capped_win_by_two',target:31,cap:35} };
const consoleHtml = (match=umpireMatch,extra={}) => renderToStaticMarkup(React.createElement(UmpireScorecard,{match,state:umpireFixture,sync:'saved',focused:true,helpRequested:false,helpBusy:false,helpMessage:'',onToggleHelp(){},onToggleFocus(){},onPrint(){},onExit(){},onRetry(){},onScoreStep(){},onCompleteSet(){},onUnlockSet(){},...extra}));
test('compact umpire console shows the game heading once and keeps secondary actions in More',()=>{
 const html=consoleHtml();assert.equal((html.match(/Group Game 1/g)||[]).length,1);assert.match(html,/<summary>.*More/s);assert.match(html,/Print manual card/);assert.match(html,/Request help/);assert.match(html,/First to 31 · Win by 2 · Cap 35/);assert.doesNotMatch(html,/>Complete Set 1</);
});
test('winning score stops plus taps, permits subtracting corrections, and exposes Complete Set',()=>{
 const html=consoleHtml({...umpireMatch,sets:[{a:31,b:29,complete:false}]});
 assert.match(html,/<button[^>]*disabled=""[^>]*aria-label="Add one point to Alex \/ Sam, set 1"/);assert.match(html,/<button[^>]*aria-label="Subtract one point from Alex \/ Sam, set 1"/);assert.doesNotMatch(html,/<button[^>]*disabled=""[^>]*aria-label="Subtract one point from Alex \/ Sam, set 1"/);assert.match(html,/>Complete Set 1</);
});
test('completed game clearly awaits validation and can be unlocked; validated scores remain locked',()=>{
 const completed={...umpireMatch,sets:[{a:31,b:29,complete:true}],courtInUse:false};let html=consoleHtml(completed);assert.match(html,/Game complete · Awaiting organizer validation/);assert.match(html,/Unlock Set 1 to edit/);assert.doesNotMatch(html,/>Live<|>LIVE</);assert.match(html,/>Available</);
 html=consoleHtml({...completed,validated:true});assert.match(html,/Result validated · Scores locked/);assert.doesNotMatch(html,/Unlock Set/);
});
test('best-of-three console defaults to the next unfinished set and retains completed results for review',()=>{
 const html=consoleHtml({...umpireMatch,format:'best_of_3_21',scoring:{mode:'capped_win_by_two',target:21,cap:30},sets:[{a:21,b:18,complete:true},{a:9,b:7,complete:false},{a:0,b:0,complete:false}]});assert.match(html,/Set 1 · 21–18 · Complete/);assert.match(html,/<option value="1" selected="">Set 2/);assert.match(html,/aria-label="Alex \/ Sam set 2 score"/);assert.match(html,/aria-label="Chris \/ Pat set 2 score"/);
});
test('offline umpire retains retry and help controls and disables exiting while scores are unsaved',()=>{
 const html=consoleHtml(umpireMatch,{sync:'offline',helpRequested:true});assert.match(html,/Retry save/);assert.match(html,/<button[^>]*disabled=""[^>]*>Exit match</);assert.match(html,/aria-pressed="true"/);assert.match(html,/Cancel help request/);
});
