/** Isolated design preview. Mock data is never part of the production Worker. */
import {defineConfig} from 'vite';
import {gameDayFixture} from './preview/game-day-fixture';
import {projectorFixture} from './preview/projector-fixture';
import {gameDayAction,type GameDayAction} from './lib/game-day';
import react from '@vitejs/plugin-react';
import {appendStaffNotification,recordCourtCompletions} from './lib/staff-events';
import {courtInUseAfterScore,initialTournament,contactError,hydrateTournament} from './lib/tournament';
let savedEntries: Record<string, unknown>[] = [];
const previewPin = '00000000';
const sponsors = new Map<string, { id: string; name: string; bytes: Buffer }>();
let revision=1;
let state: ReturnType<typeof initialTournament>=process.env.RACKETEERS_PREVIEW_COURTS === '1' ? projectorFixture() : gameDayFixture();
export default defineConfig({root:'preview',publicDir:'../public',server:{host:'0.0.0.0',allowedHosts:['terminal.local'],fs:{allow:['..']}},plugins:[react(),{name:'isolated-design-data',enforce:'pre',transform(code,id){
 if(!id.split('?')[0].endsWith('/app/page.tsx'))return;
 const role="new URLSearchParams(location.search).get('role')";
 code=code.replace('const [unlocked, setUnlocked] = useState(false)',`const [unlocked, setUnlocked] = useState(${role} === 'organizer' || ${role} === 'projector')`);
 return code.replace('useState<Tab>("setup")',`useState<Tab>(${role} === 'organizer' ? 'scores' : 'setup')`).replace('const [umpirePin, setUmpirePin] = useState("")',`const [umpirePin, setUmpirePin] = useState(${role} === 'umpire' ? '4317' : '')`).replace('const [selectedMatch, setSelectedMatch] = useState("")',`const [selectedMatch, setSelectedMatch] = useState(${role} === 'umpire' ? 'demo-match' : '')`).replace('const [umpireUnlocked, setUmpireUnlocked] = useState(false)',`const [umpireUnlocked, setUmpireUnlocked] = useState(${role} === 'umpire')`).replace('const [organizerPin, setOrganizerPin] = useState("")',`const [organizerPin, setOrganizerPin] = useState(${role} === 'organizer' || ${role} === 'projector' ? 'demo-only' : '')`).replace('useState<View>("register")',`useState<View>(${role} === 'organizer' ? 'organizer' : ${role} === 'umpire' ? 'umpire' : ${role} === 'projector' ? 'projector' : ${role} === 'spectator' ? 'spectator' : 'register')`).replace('useState(false);\n  const [sync',`useState(${role} === 'organizer' || ${role} === 'projector');\n  const [sync`).replace('const [umpireAccessPin, setUmpireAccessPin] = useState("")',`const [umpireAccessPin, setUmpireAccessPin] = useState(${role} === 'umpire' ? 'demo-only' : '')`);
 },configureServer(server){server.middlewares.use('/api/',async(req,res)=>{
 res.setHeader('content-type','application/json');
 if(req.url?.startsWith('/sponsors')) {
  const id = new URL(req.url, 'http://preview').searchParams.get('image');
  if(req.method==='GET') {
   if(id){const image=sponsors.get(id);if(!image){res.statusCode=404;res.end('{}');return;}res.setHeader('content-type','image/png');res.end(image.bytes);return;}
   res.end(JSON.stringify({enabled:true,images:[...sponsors.values()].map(({id,name})=>({id,name,url:`/api/sponsors?image=${id}`}))}));return;
  }
  if(req.headers['x-organizer-pin']!=='demo-only'){res.statusCode=401;res.end(JSON.stringify({error:'Preview organizer access required.'}));return;}
  if(req.method==='DELETE' && id){sponsors.delete(id);res.end(JSON.stringify({ok:true}));return;}
  if(req.method==='POST') {
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
   const bytes=Buffer.concat(chunks);if(bytes.length>2*1024*1024 || req.headers['content-type']!=='image/png'){res.statusCode=415;res.end(JSON.stringify({error:'Choose a PNG image of 2 MB or less.'}));return;}
   const image={id:crypto.randomUUID(),name:decodeURIComponent(String(req.headers['x-sponsor-name']||'Sponsor')),bytes};sponsors.set(image.id,image);res.statusCode=201;res.end(JSON.stringify({image:{id:image.id,name:image.name,url:`/api/sponsors?image=${image.id}`}}));return;
  }
  res.statusCode=405;res.end('{}');return;
 }
 if(req.method==='GET' && req.url?.includes('staffUpdates')){res.end(JSON.stringify({courtHelp:state.courtHelp??{},notifications:req.headers['x-organizer-pin']?state.staffNotifications??[]:[],revision}));return;}
 if(req.method==='GET'){res.end(JSON.stringify(req.url?.startsWith('/state')?{state,revision,organizer:Boolean(req.headers['x-organizer-pin'])}:req.url?.includes('capabilities')?{enabled:false}:{}));return;}
 let body = ''; for await (const chunk of req) body += chunk;
 let data; try { data = JSON.parse(body); } catch { res.statusCode=400;res.end(JSON.stringify({error:'Invalid request.'}));return; }
 if(req.method==='PUT'){state=recordCourtCompletions(state,hydrateTournament({...data.state,courtHelp:state.courtHelp,staffNotifications:state.staffNotifications})) as typeof state;revision++;res.end(JSON.stringify({state,revision}));return;}
 if(req.method==='PATCH'){const match=state.matches.find(m=>m.id===data.matchId);if(!match){res.statusCode=404;res.end('{}');return;}if(match.hold||match.forfeit){res.statusCode=409;res.end(JSON.stringify({error:'This game is locked by the organizer.',gameLocked:true}));return;}state=recordCourtCompletions(state,{...state,matches:state.matches.map(m=>m.id===match.id?{...m,sets:data.sets,status:'live',courtInUse:courtInUseAfterScore(match,data.sets)}:m)}) as typeof state;revision++;res.end(JSON.stringify({state,revision}));return;}
 if(data.action==='updateProjectorSettings'){if(data.expectedRevision!==revision){res.statusCode=409;res.end(JSON.stringify({error:'Tournament changed. Review your settings and save again.'}));return;}state=hydrateTournament({...state,projector:data.projector});revision++;res.end(JSON.stringify({state,revision}));return;}
 if(data.action==='courtHelp'){const court=req.headers['x-organizer-pin']?data.court:state.matches.find(m=>m.id===data.matchId)?.court;if(!court){res.statusCode=400;res.end(JSON.stringify({error:'Assign a court first.'}));return;}const help={...(state.courtHelp??{})};if(data.help)help[court]={id:crypto.randomUUID(),court,requestedAt:new Date().toISOString()};else delete help[court];state=appendStaffNotification({...state,courtHelp:help},{kind:data.help?'help_requested':'help_cleared',court}) as typeof state;revision++;res.end(JSON.stringify({courtHelp:help,revision}));return;}
 if(['dispatchGame','releaseGameCourt','holdGame','resumeGame','forfeitGame','clearForfeit'].includes(data.action)){if(data.expectedRevision!==revision){res.statusCode=409;res.end(JSON.stringify({error:'Court or game data changed.',state,revision}));return;}const result=gameDayAction(state,data.action as GameDayAction,data.matchId,data);if(!result.state){res.statusCode=409;res.end(JSON.stringify({error:result.error,state,revision}));return;}state=recordCourtCompletions(state,result.state);revision++;res.end(JSON.stringify({state,revision}));return;}
 if(data.action==='verifyMatch' && data.pin==='4317'){res.end(JSON.stringify({match:state.matches[0]}));return;}
 if(data.action === 'registerPlayer' || data.action === 'updateRegistration') {
  const draft = data.registration;
  const error = !draft?.name?.trim() || !draft?.club?.trim() ? 'Enter the required player details.' : contactError(draft.facebookProfile, draft.phone);
  if(error) {res.statusCode=400;res.end(JSON.stringify({error}));return;}
  savedEntries = [{...draft,id:'PREVIEW-ENTRY-1',entryCount:draft.secondEntry?2:1},...(draft.secondEntry?[{...draft,...draft.secondEntry,id:'PREVIEW-ENTRY-2',name:draft.name,partnerName:draft.secondEntry.samePartner?draft.partnerName:draft.secondEntry.partnerName,entryCount:2}]:[])];
  res.end(JSON.stringify({registration:savedEntries[0],registrations:savedEntries,editPin:previewPin}));return;
 }
 if(data.action === 'lookupRegistration' && data.pin === previewPin && savedEntries.length) {res.end(JSON.stringify({registration:savedEntries.find(r=>r.id===data.registrationId)||savedEntries[0],registrations:savedEntries}));return;}
 res.statusCode=400;res.end(JSON.stringify({error:'Use the live site for staff access. Preview registrations use demo PIN 00000000.'}));
 });}}]});
