import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const dir=await mkdtemp(path.join(tmpdir(),'registration-draft-'));
await build({entryPoints:['lib/registration-draft.ts'],outfile:path.join(dir,'draft.mjs'),bundle:true,platform:'node',format:'esm'});
const {partnerFields,withPartnerFields,registrationForSubmission,chooseSecondEntryPartner,entryDetailsError}=await import(pathToFileURL(path.join(dir,'draft.mjs')));
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
 assert.equal(empty.partnerName,'');assert.equal(empty.partnerPhone,'');assert.equal(empty.partnerClub,'');assert.equal(empty.partnerShirtSize,'M');
});
