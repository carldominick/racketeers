/** Disposable preview fixture. Never imported by the production Worker. */
import { initialTournament, makeDivision, type Entry, type Match, type TournamentState } from '../lib/tournament';
export function gameDayFixture(): TournamentState {
 const names=[['Alex / Sam','Chris / Pat','Jesse / Kim','Noah / Eli','Marco / Enzo','Luis / Nico','Finn / Reese','Quinn / Sky','Jules / Remy'],['Riley / Morgan','Taylor / Casey','Avery / Parker','Jordan / Blake','Devon / River'],['Jamie / Lee','Robin / Drew','Theo / Miles','Leo / Dean']];
 const divisions=['Level D/E','Level F','Invitational'].map((name,di)=>({...makeDivision(name,'doubles'),id:`preview-division-${di}`,subBracketCount:di===0?2:1,entries:names[di].map((name,i)=>({id:`preview-entry-${di}-${i}`,name,players:name.split(' / '),poolOverride:di===0&&[2,3,6,7].includes(i)?1:0} as Entry))}));
 const game=(n:number,di:number,a:number|null,b:number|null,pool=0):Match=>({id:n===1?'demo-match':`preview-game-${n}`,divisionId:divisions[di].id,stage:'regular',round:1,label:`Group Game ${n}`,entryAId:a===null?null:divisions[di].entries[a].id,entryBId:b===null?null:divisions[di].entries[b].id,sets:[{a:0,b:0,complete:false}],status:'ready',court:null,scheduledAt:null,validated:false,pin:['','4317','1122','2975','8642','5824','6389','7136','9461','1548','3792','8214','4659'][n],format:'single_31',scoring:{mode:'first_to_target',target:31,cap:31},subBracket:pool});
 const matches=[game(1,0,0,1),game(2,0,4,5),game(3,1,0,1),game(4,2,0,1),game(5,0,2,3,1),game(6,1,2,3),game(7,0,4,5),game(8,2,2,3),game(9,0,6,7,1),game(10,0,0,8),game(11,2,null,null),game(12,1,0,4)];
 Object.assign(matches[0],{status:'live',court:1,courtInUse:true,sets:[{a:18,b:16,complete:false}]});
 Object.assign(matches[1],{status:'finished',validated:true,sets:[{a:31,b:18,complete:true}]});
 Object.assign(matches[2],{status:'finished',court:2,completedAt:new Date(Date.now()-5*60000).toISOString(),sets:[{a:31,b:28,complete:true}]});
 Object.assign(matches[3],{status:'live',court:4,courtInUse:true,sets:[{a:14,b:16,complete:false}]});
 Object.assign(matches[10],{stage:'semifinal',round:2,label:'Semifinal · Winner Game 4 vs Winner Game 8'});
 return {...initialTournament(),status:'live',tournamentName:'Racketeers X Fruitas Badminton Tournament',venue:'Metro Sports Center, Cebu City',startDate:'2026-11-29',endDate:'2026-11-29',divisions,matches,registrations:[],courtHelp:{4:{id:'preview-help',court:4,requestedAt:new Date().toISOString()}},gameDay:{evenRotation:true,restMinutes:15,nearCapEnabled:true,nearCapPoints:5,nextBracketKey:'preview-division-0:1'}};
}
