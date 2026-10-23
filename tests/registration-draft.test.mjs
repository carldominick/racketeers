import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const dir=await mkdtemp(path.join(tmpdir(),'registration-draft-'));
await build({entryPoints:['lib/registration-draft.ts'],outfile:path.join(dir,'draft.mjs'),bundle:true,platform:'node',format:'esm'});
const {partnerFields,withPartnerFields,registrationForSubmission,chooseSecondEntryPartner,secondEntrySource,entryDetailsError}=await import(pathToFileURL(path.join(dir,'draft.mjs')));
test.after(()=>rm(dir,{recursive:true,force:true}));

function primary(){return {
 name:'Miguel Santos',divisionId:'level-g',club:'Harbor Badminton',facebookProfile:'https://www.facebook.com/miguel.santos',phone:'09123456789',
 shirtSize:'M',playerLevel:'',desiredLevel:'',teamName:'',partnerName:'Paolo Reyes',partnerClub:'Metro Badminton',
 partnerFacebookProfile:'https://www.facebook.com/paolo.reyes',partnerPhone:'09123456788',partnerShirtSize:'L',partnerDesiredLevel:'',partnerId:'paolo-first',partnerEntryCount:1,
};}
function different(){return {...primary(),divisionId:'level-f',partnerName:'Enzo Garcia',partnerClub:'Eastside Badminton',
 partnerFacebookProfile:'https://www.facebook.com/enzo.garcia',partnerPhone:'09123456787',partnerShirtSize:'S',
 partnerId:undefined,secondShirt:'black',partnerSecondShirt:'black',samePartner:false};}

test('singles submission excludes hidden partner data while the original doubles draft remains reusable',()=>{
 const original=Object.freeze(primary());
 const singlesDraft={...original,divisionId:'singles'};
 const singles=registrationForSubmission(singlesDraft,'singles');
 assert.equal(entryDetailsError(singles,'singles'),null);
 assert.equal(singles.partnerName,'');assert.equal(singles.partnerShirtSize,'');assert.equal(singles.partnerDesiredLevel,'');
 assert.equal(singles.samePartner,false);
 for(const key of ['partnerId','partnerEntryCount','partnerClub','partnerFacebookProfile','partnerPhone','partnerSecondShirt'])assert.equal(singles[key],undefined,key);
 const payload=JSON.parse(JSON.stringify(singles));
 assert.equal(payload.partnerId,undefined);assert.equal(payload.partnerPhone,undefined);assert.equal(payload.name,original.name);
 const backToDoubles=registrationForSubmission({...singlesDraft,divisionId:'level-f'},'doubles');
 assert.deepEqual(partnerFields(backToDoubles),partnerFields(original));
 assert.equal(backToDoubles.partnerId,original.partnerId);assert.equal(entryDetailsError(backToDoubles,'doubles'),null);
 assert.equal(original.divisionId,'level-g');assert.equal(original.partnerName,'Paolo Reyes');
 assert.notEqual(backToDoubles,original);
});

test('same and different second-entry branches keep separate identities, contacts, shirt sizes and first-entry details',()=>{
 const first=Object.freeze(primary());const separate=Object.freeze(different());
 const same=chooseSecondEntryPartner(separate,'same',first,'doubles');
 assert.equal(same.samePartner,true);assert.equal(same.partnerName,'Paolo Reyes');assert.equal(same.partnerClub,'Metro Badminton');
 assert.equal(same.partnerFacebookProfile,first.partnerFacebookProfile);assert.equal(same.partnerPhone,first.partnerPhone);
 assert.equal(same.partnerShirtSize,'L');assert.equal(same.partnerSecondShirt,'black');assert.equal(same.secondShirt,'black');
 assert.equal(entryDetailsError(same,'doubles'),null);
 const back=chooseSecondEntryPartner(separate,'different',first,'doubles');
 assert.equal(back.samePartner,false);assert.equal(back.partnerName,'Enzo Garcia');
 assert.equal(back.partnerFacebookProfile,separate.partnerFacebookProfile);assert.equal(back.partnerPhone,separate.partnerPhone);
 assert.equal(back.partnerClub,separate.partnerClub);assert.equal(back.partnerShirtSize,'S');assert.equal(back.partnerSecondShirt,'black');
 assert.deepEqual(first,primary());assert.deepEqual(separate,different());assert.notEqual(back,separate);
 const refreshed=chooseSecondEntryPartner(separate,'same',{...first,partnerName:'Paolo R. Reyes',partnerPhone:'09123456786'},'doubles');
 assert.equal(refreshed.partnerName,'Paolo R. Reyes');assert.equal(refreshed.partnerPhone,'09123456786');
});

test('a missing partner choice or first-entry singles never silently reuses a hidden partner',()=>{
 const first=Object.freeze(primary());const separate=Object.freeze(different());
 for(const [choice,mode] of [[null,'doubles'],['same','singles'],['same',undefined]]){
  const projected=chooseSecondEntryPartner(separate,choice,first,mode);
  assert.equal(projected.samePartner,false);assert.equal(projected.partnerName,'');assert.equal(projected.partnerPhone,'');
  assert.equal(projected.partnerClub,'');assert.equal(projected.partnerId,undefined);
  assert.match(entryDetailsError(projected,'doubles'),/Partner.*full name/);
 }
 const selectedDifferent=chooseSecondEntryPartner(separate,'different',first,'singles');
 assert.equal(selectedDifferent.partnerName,'Enzo Garcia');assert.equal(entryDetailsError(selectedDifferent,'doubles'),null);
 assert.equal(separate.partnerName,'Enzo Garcia');assert.equal(first.partnerName,'Paolo Reyes');
});

test('validation blocks incomplete active details but ignores the inactive second-entry branch',()=>{
 const first=primary();const invalid={...different(),partnerPhone:'123',partnerClub:''};
 assert.match(entryDetailsError(chooseSecondEntryPartner(invalid,'different',first,'doubles'),'doubles'),/Enzo Garcia: Enter a club/);
 assert.match(entryDetailsError({...invalid,partnerClub:'Eastside'},'doubles'),/phone\/mobile/);
 assert.equal(entryDetailsError(chooseSecondEntryPartner(invalid,'same',first,'doubles'),'doubles'),null);
 assert.equal(entryDetailsError(registrationForSubmission(invalid,'singles'),'singles'),null);
 assert.match(entryDetailsError({...first,divisionId:''},'doubles'),/Choose a division/);
 assert.match(entryDetailsError(first,undefined),/Choose a division/);
 assert.match(entryDetailsError({...first,name:''},'doubles'),/Player 1/);
 assert.match(entryDetailsError({...first,club:''},'doubles'),/Miguel Santos: Enter a club/);
 assert.match(entryDetailsError({...first,facebookProfile:'not-a-link'},'doubles'),/Miguel Santos: Enter a valid Facebook/);
 assert.match(entryDetailsError({...first,phone:'12'},'doubles'),/Miguel Santos: Enter a valid phone/);
 assert.match(entryDetailsError({...first,partnerName:''},'team'),/Partner.*full name/);
});

test('restoring partner snapshots preserves non-partner fields and supports immutable partial shirt edits',()=>{
 const original=Object.freeze(primary());const saved=Object.freeze(partnerFields(different()));
 const restored=withPartnerFields(original,saved,false);
 assert.equal(restored.name,original.name);assert.equal(restored.divisionId,original.divisionId);assert.equal(restored.shirtSize,original.shirtSize);
 assert.deepEqual(partnerFields(restored),saved);assert.equal(restored.samePartner,false);
 const sizeChanged=withPartnerFields(restored,{partnerShirtSize:'XL'},false);
 assert.equal(sizeChanged.partnerName,'Enzo Garcia');assert.equal(sizeChanged.partnerPhone,saved.partnerPhone);assert.equal(sizeChanged.partnerShirtSize,'XL');
 assert.equal(restored.partnerShirtSize,'S');assert.equal(original.partnerShirtSize,'L');
 const empty=partnerFields({});
 assert.equal(empty.partnerName,'');assert.equal(empty.partnerPhone,'');assert.equal(empty.partnerClub,'');assert.equal(empty.partnerShirtSize,'');
});

test('second-entry owner projection preserves Player 1 and reverses all participating Player 2 details immutably',()=>{
 const first=Object.freeze({...primary(),desiredLevel:'Intermediate',partnerDesiredLevel:'Advanced'});
 const own=secondEntrySource(first,'primary');
 assert.deepEqual(own,first);assert.notEqual(own,first);
 const partner=secondEntrySource(first,'partner');
 assert.equal(partner.name,'Paolo Reyes');assert.equal(partner.club,'Metro Badminton');
 assert.equal(partner.facebookProfile,first.partnerFacebookProfile);assert.equal(partner.phone,first.partnerPhone);
 assert.equal(partner.shirtSize,'L');assert.equal(partner.desiredLevel,'Advanced');
 assert.equal(partner.partnerName,'Miguel Santos');assert.equal(partner.partnerClub,'Harbor Badminton');
 assert.equal(partner.partnerFacebookProfile,first.facebookProfile);assert.equal(partner.partnerPhone,first.phone);
 assert.equal(partner.partnerShirtSize,'M');assert.equal(partner.partnerDesiredLevel,'Intermediate');
 assert.equal(partner.divisionId,first.divisionId);assert.equal(partner.teamName,first.teamName);
 assert.notEqual(partner,first);assert.equal(first.name,'Miguel Santos');assert.equal(first.partnerName,'Paolo Reyes');
 assert.equal(first.shirtSize,'M');assert.equal(first.partnerShirtSize,'L');
});

test('Player 2 second entry reuses Player 1 as Same partner or keeps a separate Different partner draft',()=>{
 const first=Object.freeze(primary());
 const source=secondEntrySource(first,'partner');
 const separate=Object.freeze({...different(),name:source.name,club:source.club,facebookProfile:source.facebookProfile,phone:source.phone,shirtSize:source.shirtSize});
 const same=chooseSecondEntryPartner(separate,'same',source,'doubles');
 assert.equal(same.name,'Paolo Reyes');assert.equal(same.club,'Metro Badminton');
 assert.equal(same.facebookProfile,first.partnerFacebookProfile);assert.equal(same.phone,first.partnerPhone);assert.equal(same.shirtSize,'L');
 assert.equal(same.partnerName,'Miguel Santos');assert.equal(same.partnerClub,'Harbor Badminton');
 assert.equal(same.partnerFacebookProfile,first.facebookProfile);assert.equal(same.partnerPhone,first.phone);
 assert.equal(same.partnerShirtSize,'M');assert.equal(same.partnerSecondShirt,'black');assert.equal(same.samePartner,true);
 assert.equal(entryDetailsError(same,'doubles'),null);
 const differentPartner=chooseSecondEntryPartner(separate,'different',source,'doubles');
 assert.equal(differentPartner.name,'Paolo Reyes');assert.equal(differentPartner.club,'Metro Badminton');
 assert.equal(differentPartner.facebookProfile,first.partnerFacebookProfile);assert.equal(differentPartner.phone,first.partnerPhone);
 assert.equal(differentPartner.partnerName,'Enzo Garcia');assert.equal(differentPartner.partnerClub,'Eastside Badminton');
 assert.equal(differentPartner.partnerFacebookProfile,separate.partnerFacebookProfile);assert.equal(differentPartner.partnerPhone,separate.partnerPhone);
 assert.equal(differentPartner.partnerShirtSize,'S');assert.equal(differentPartner.samePartner,false);
 assert.equal(entryDetailsError(differentPartner,'doubles'),null);
 assert.equal(separate.partnerName,'Enzo Garcia');assert.equal(separate.partnerShirtSize,'S');assert.deepEqual(first,primary());
});

test('second-entry owner projection reflects edited first-entry details without mutating prior projections',()=>{
 const first=Object.freeze(primary());
 const before=secondEntrySource(first,'partner');
 const edited={...first,name:'Miguel S. Santos',club:'Harbor Rackets',facebookProfile:'https://facebook.com/miguel.santos.updated',phone:'09123456781',shirtSize:'XL',partnerName:'Paolo R. Reyes',partnerClub:'Metro Rackets',partnerFacebookProfile:'https://facebook.com/paolo.reyes.updated',partnerPhone:'09123456782',partnerShirtSize:'2XL'};
 const after=secondEntrySource(edited,'partner');
 assert.equal(after.name,edited.partnerName);assert.equal(after.club,edited.partnerClub);
 assert.equal(after.facebookProfile,edited.partnerFacebookProfile);assert.equal(after.phone,edited.partnerPhone);assert.equal(after.shirtSize,'2XL');
 assert.equal(after.partnerName,edited.name);assert.equal(after.partnerClub,edited.club);
 assert.equal(after.partnerFacebookProfile,edited.facebookProfile);assert.equal(after.partnerPhone,edited.phone);assert.equal(after.partnerShirtSize,'XL');
 assert.equal(before.name,'Paolo Reyes');assert.equal(before.partnerName,'Miguel Santos');assert.equal(before.shirtSize,'L');assert.equal(before.partnerShirtSize,'M');
 assert.deepEqual(first,primary());
 const current=secondEntrySource(edited,'primary');
 assert.deepEqual(current,edited);assert.notEqual(current,edited);
 const same=chooseSecondEntryPartner({...different(),name:after.name,club:after.club,facebookProfile:after.facebookProfile,phone:after.phone},'same',after,'doubles');
 assert.equal(same.name,'Paolo R. Reyes');assert.equal(same.partnerName,'Miguel S. Santos');
 assert.equal(same.partnerFacebookProfile,edited.facebookProfile);assert.equal(same.partnerPhone,edited.phone);assert.equal(same.partnerShirtSize,'XL');
});

test('Player 2 entering singles remains the selected owner and excludes hidden partner details from submission',()=>{
 const first=Object.freeze(primary());const source=secondEntrySource(first,'partner');
 const draft={...different(),owner:'partner',divisionId:'singles',name:source.name,club:source.club,facebookProfile:source.facebookProfile,phone:source.phone,shirtSize:source.shirtSize};
 const submitted=registrationForSubmission(draft,'singles');
 assert.equal(submitted.owner,'partner');assert.equal(submitted.name,'Paolo Reyes');assert.equal(submitted.club,'Metro Badminton');
 assert.equal(submitted.facebookProfile,first.partnerFacebookProfile);assert.equal(submitted.phone,first.partnerPhone);assert.equal(submitted.shirtSize,'L');
 assert.equal(submitted.partnerName,'');assert.equal(submitted.partnerPhone,undefined);assert.equal(submitted.partnerShirtSize,'');assert.equal(submitted.samePartner,false);
 assert.equal(entryDetailsError(submitted,'singles'),null);
 assert.equal(draft.partnerName,'Enzo Garcia');assert.deepEqual(first,primary());
});
