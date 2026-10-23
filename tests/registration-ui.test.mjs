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
await build({jsx:'automatic',stdin:{contents:(await readFile('app/page.tsx','utf8'))+'\nexport { PublicRegistration, RegistrationSecondEntryOwner, TournamentCountdown, UmpireScorecard, ReceiptBatchReview };\nexport {ReceiptReview} from "./components/receipt-review";',resolveDir:path.resolve('app'),loader:'tsx'},outfile:path.join(dir,'page.mjs'),bundle:true,platform:'node',format:'esm',plugins:[{name:'shared-react',setup(build){build.onResolve({filter:/^react($|\/)/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
const {default:Home,PublicRegistration,RegistrationSecondEntryOwner,TournamentCountdown,UmpireScorecard,ReceiptBatchReview,ReceiptReview}=await import(pathToFileURL(path.join(dir,'page.mjs')));
const state={status:'registration',divisions:[{id:'d',name:'Open Doubles',mode:'doubles'}],registrations:[{id:'one',name:'Alex',facebookProfile:'https://facebook.com/alex.test',phone:'09123456789',divisionId:'d',partnerId:'two',club:'Cebu Club',shirtSize:'L',desiredLevel:'Intermediate'},{id:'two',name:'Sam',facebookProfile:'https://facebook.com/sam.test',phone:'09123456780',divisionId:'d',partnerId:'one',club:'Rackets',shirtSize:'S',desiredLevel:'Advanced'}]};
test('opening page shows registration without a PIN dialog and offers staff access',()=>{
 const html=renderToStaticMarkup(React.createElement(Home));
 assert.match(html,/Connecting/);assert.doesNotMatch(html,/>● Synced</);
 assert.doesNotMatch(html,/role="dialog"/);assert.match(html,/class="active">Registration/);
 const nav=html.match(/<nav class="view-switch"[^>]*>(.*?)<\/nav>/s)[1];
 assert.match(nav,/>Staff access</);assert.match(nav,/>Registration</);assert.match(nav,/>Spectator</);assert.doesNotMatch(nav,/>Organizer<|>Umpire<|>Projector</);
});
test('public and organizer registration share required player fields and preserve event documents',()=>{
 for(const organizerPin of ['', 'test-only']){
  const html=renderToStaticMarkup(React.createElement(PublicRegistration,{state,organizerPin,onSaved(){}}));
  assert.equal((html.match(/<label>Club \/ group/g)||[]).length,2);
  assert.equal((html.match(/Facebook profile link/g)||[]).length,2);assert.equal((html.match(/Phone \/ mobile number/g)||[]).length,2);
  assert.doesNotMatch(html,/Registered level|Allowed registration levels/);assert.match(html,/Player 1/);assert.match(html,/Player 2 \/ Partner/);
  assert.match(html,/Submit Registration/);assert.match(html,/Upload payment photo/);
  assert.match(html,/<aside class="clubhouse-sidebar"/);assert.match(html,/aria-label="Tournament documents"/);
  assert.match(html,/Tournament rules &amp; regulations/);assert.match(html,/Disclaimer &amp; waiver/);
 }
});

test('division selection and player details occupy the same first step of a visible three-step flow',()=>{
 const html=renderToStaticMarkup(React.createElement(PublicRegistration,{state,onSaved(){}}));
 assert.match(html,/Division &amp; players/);assert.match(html,/Entries &amp; shirts/);assert.match(html,/Review &amp; payment/);
 const progress=html.match(/<ol([^>]*class="registration-steps"[^>]*)>(.*?)<\/ol>/s);
 assert.ok(progress);assert.doesNotMatch(progress[1],/\bhidden\b/);assert.equal((progress[2].match(/<li\b/g)||[]).length,3);
 const firstStep=html.slice(html.indexOf('registration-entry-basics'),html.indexOf('guided-entry-review'));
 assert.match(firstStep,/Open Doubles/);assert.match(firstStep,/Full name/);assert.match(firstStep,/Partner/);
 assert.match(firstStep,/<fieldset[^>]*class="registration-division-options"[^>]*>/);
 assert.match(firstStep,/<legend>Choose (?:your |a )?division<\/legend>/);
 assert.doesNotMatch(firstStep,/<input(?=[^>]*type="radio")(?=[^>]*checked="")[^>]*>/);
 assert.match(html,/<option value="" selected="">Choose size<\/option>/);
});

test('later-linked second entry requires an explicit partner choice before showing new partner fields',()=>{
 const html=renderToStaticMarkup(React.createElement(PublicRegistration,{state,organizerPin:'test-only',initialRegistration:state.registrations[0],onSaved(){}}));
 assert.match(html,/Second entry linked to/);assert.match(html,/Same partner/);assert.match(html,/Different partner/);
 const choices=html.match(/<fieldset[^>]*class="registration-partner-choices"[^>]*>(.*?)<\/fieldset>/s);
 assert.ok(choices);assert.equal((choices[1].match(/type="radio"/g)||[]).length,2);assert.doesNotMatch(choices[1],/\bchecked=/);
 assert.match(html,/<button[^>]*class="primary"[^>]*disabled=""[^>]*>Continue to entries &amp; shirts/);
 assert.match(html,/Sam/);assert.match(html,/value="https:\/\/facebook.com\/alex.test"/);
 assert.doesNotMatch(html,/<input[^>]*value="(?:Sam|Rackets|09123456780|https:\/\/facebook.com\/sam.test)"/);
 assert.equal((html.match(/<label>Club \/ group/g)||[]).length,1);
 assert.equal((html.match(/Facebook profile link/g)||[]).length,1);
 assert.match(html,/<option value="black">Black shirt<\/option>/);
 assert.match(html,/<option value="tournament"[^>]*>Second tournament shirt<\/option>/);
});

test('singles registration exposes only the participating player fields',()=>{
 const singleState={...state,divisions:[...state.divisions,{id:'single',name:'Open Singles',mode:'singles'}]};
 const html=renderToStaticMarkup(React.createElement(PublicRegistration,{state:singleState,initialDivisionId:'single',onSaved(){}}));
 assert.equal((html.match(/<label>Club \/ group/g)||[]).length,1);
 assert.equal((html.match(/Facebook profile link/g)||[]).length,1);
 assert.doesNotMatch(html,/<legend>Player 2 \/ Partner<\/legend>/);
 assert.match(html,/Open Singles/);assert.match(html,/Disclaimer &amp; waiver/);
});

const secondEntryOwnerHtml=(overrides={})=>renderToStaticMarkup(React.createElement(RegistrationSecondEntryOwner,{name:'second-entry-owner',choice:null,primaryName:'Miguel Santos',partnerName:'Paolo Reyes',canChoosePartner:true,busy:false,onChoose(){},...overrides}));
const ownerRadios=html=>[...html.matchAll(/<input\b(?=[^>]*type="radio")[^>]*>/g)].map(match=>match[0]);

test('second-entry owner choice uses named native radio labels and requires an explicit selection',()=>{
 const html=secondEntryOwnerHtml();const radios=ownerRadios(html);
 assert.match(html,/<fieldset\b[^>]*>[\s\S]*?<legend>Who is entering again\?<\/legend>/);
 assert.equal(radios.length,2);assert.ok(radios.every(radio=>/name="second-entry-owner"/.test(radio)));
 assert.ok(radios.every(radio=>!(/\bchecked=/.test(radio))));
 const labels=[...html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)].map(match=>match[1]);
 assert.ok(labels.some(label=>/value="primary"/.test(label)&&/Miguel Santos/.test(label)&&/Player 1/.test(label)));
 assert.ok(labels.some(label=>/value="partner"/.test(label)&&/Paolo Reyes/.test(label)&&/Player 2/.test(label)));
});

test('choosing Player 2 marks only that named owner as selected',()=>{
 const html=secondEntryOwnerHtml({choice:'partner'});const radios=ownerRadios(html);
 assert.equal(radios.length,2);
 assert.match(radios.find(radio=>/value="partner"/.test(radio)),/\bchecked=""/);
 assert.doesNotMatch(radios.find(radio=>/value="primary"/.test(radio)),/\bchecked=/);
 assert.match(html,/Paolo Reyes/);assert.match(html,/Miguel Santos/);
});

test('singles first entry offers only its participating player and saving disables the entire owner group',()=>{
 const singles=secondEntryOwnerHtml({canChoosePartner:false,choice:'primary'});const radios=ownerRadios(singles);
 assert.equal(radios.length,1);assert.match(radios[0],/value="primary"/);assert.match(radios[0],/\bchecked=""/);
 assert.match(singles,/Miguel Santos/);assert.doesNotMatch(singles,/Paolo Reyes|Player 2/);
 const busy=secondEntryOwnerHtml({busy:true,choice:'partner'});
 assert.match(busy,/<fieldset\b[^>]*\bdisabled=""/);assert.equal(ownerRadios(busy).length,2);
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

test('a stale umpire scorecard displays awarded forfeiture sets with all score controls locked',()=>{
 const forfeit={winnerId:'b',points:15,reason:'no_show',recordedAt:new Date().toISOString()};
 const html=consoleHtml({...umpireMatch,format:'best_of_3_21',forfeit,sets:[{a:8,b:7,complete:false}]});
 assert.match(html,/Set 1 · 0–15 · Complete/);assert.match(html,/Set 2 · 0–15 · Complete/);assert.doesNotMatch(html,/Set 3/);
 assert.match(html,/Forfeiture recorded · Scores locked/);assert.doesNotMatch(html,/Unlock Set|>Complete Set/);
 for(const side of ['Alex / Sam','Chris / Pat'])for(const action of ['Add','Subtract'])assert.match(html,new RegExp(`<button[^>]*disabled=""[^>]*aria-label="${action} one point (?:to|from) ${side}, set 2"`));
});


test('batch OCR offers all-division scanning and opt-in rereading, with no automatic payment confirmation',()=>{
 const html=renderToStaticMarkup(React.createElement(ReceiptBatchReview,{registrations:state.registrations,pin:'private-test-value'}));
 assert.match(html,/Read all payment screenshots/);assert.match(html,/across all divisions/);assert.match(html,/Tesseract.js on this device/);
 assert.match(html,/Also read screenshots with saved details/);assert.doesNotMatch(html,/<input[^>]*checked/);
 assert.match(html,/no payment is confirmed automatically/);assert.doesNotMatch(html,/private-test-value/);
 const locked=renderToStaticMarkup(React.createElement(ReceiptBatchReview,{registrations:state.registrations,pin:'test',locked:true}));
 assert.match(locked,/<button[^>]*disabled=""[^>]*>Read all payment screenshots/);
});

test('a staged batch result retains its editable OCR fields, screenshot preview action and explicit review save',()=>{
 const reading={record:{groupId:'g',revision:0,proofVersion:'photo-v1',details:null,stale:false,reviewedAt:null,duplicateReference:false},details:{amount:'1250.00',reference:'001234567890',provider:'GCash',date:''},warnings:['Check every field']};
 const html=renderToStaticMarkup(React.createElement(ReceiptReview,{registrationId:'one',pin:'private-test-value',initialReading:reading}));
 assert.match(html,/Unsaved changes/);assert.match(html,/value="001234567890"/);assert.match(html,/value="1250.00"/);
 assert.match(html,/View screenshot for review/);assert.match(html,/Check every field/);assert.match(html,/<button[^>]*class="primary"[^>]*>Save reviewed details/);
 assert.doesNotMatch(html,/private-test-value/);assert.match(html,/Confirm payment received separately/);
});
