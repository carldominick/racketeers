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
await build({jsx:'automatic',stdin:{contents:(await readFile('app/page.tsx','utf8'))+'\nexport { PublicRegistration, TournamentCountdown };',resolveDir:path.resolve('app'),loader:'tsx'},outfile:path.join(dir,'page.mjs'),bundle:true,platform:'node',format:'esm',plugins:[{name:'shared-react',setup(build){build.onResolve({filter:/^react($|\/)/},args=>({path:require.resolve(args.path),external:true}));}}]});
const {default:Home,PublicRegistration,TournamentCountdown}=await import(pathToFileURL(path.join(dir,'page.mjs')));
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
