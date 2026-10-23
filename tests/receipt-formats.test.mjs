import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=await mkdtemp(path.join(tmpdir(),'receipt-formats-'));
for(const name of ['receipt-details','receipt-image']) await build({entryPoints:[`lib/${name}.ts`],outfile:path.join(dir,`${name}.mjs`),bundle:true,platform:'node',format:'esm'});
const {extractReceipt,combineReceiptReadings,validReceipt}=await import(pathToFileURL(path.join(dir,'receipt-details.mjs')));
const {enhanceReceiptPixels,prepareReceiptImage}=await import(pathToFileURL(path.join(dir,'receipt-image.mjs')));
test.after(()=>rm(dir,{recursive:true,force:true}));

// Fictional, representative layouts: these are not claimed to be real app screenshots.
const fixtures=[
 ['GCash','GCash\nSuccessfully sent!\nAmount Sent\nPHP 1,250.00\nService Fee\nPHP 15.00\nTotal Amount\nPHP 1,265.00\nRef. No.\n0012 345 678901\nOct 22, 2026 10:45 AM','0012 345 678901'],
 ['Maya','Maya\nPHP 1,250.00\nYou sent money\nTo GCash\nTransaction ID\n000000123ABC\nTransaction date\n22 October 2026, 10:45 AM\nService fee\nPHP 0.00','000000123ABC'],
 ['MariBank','MariBank\nTransfer successful\nRecipient Bank: GCash\nTransfer Amount PHP 1,250.00\nTransaction No.: 000123456789\nDate & Time\n22 Oct 2026 10:45','000123456789'],
 ['BPI','BPI\nTransfer successful\nTo: GCash\nPHP 1,250.00\nService charge PHP 15.00\nConfirmation No.\n000123456ABC\nTransaction Date: October 22, 2026','000123456ABC'],
];
for(const [provider,text,reference] of fixtures) test(`${provider} layout reads amount, reference and date without selecting the receiving wallet`,()=>{
 const result=extractReceipt(text);
 assert.deepEqual(result.details,{amount:'1250.00',reference,provider,date:'2026-10-22'});
 assert.deepEqual(result.warnings,[]);assert.equal(validReceipt(result.details),true);
});

test('reference labels tolerate punctuation, bank aliases and numeric groups across lines',()=>{
 for(const label of ['Ref.No.','Ref #','Reference Number:','Transaction Reference No.','Confirmation Number:','Trace ID:']) {
  assert.equal(extractReceipt(`${label}\n000123456789`).details.reference,'000123456789',label);
 }
 assert.equal(extractReceipt('Ref. No.\n0012\n3456\n7890').details.reference,'0012 3456 7890');
 assert.equal(extractReceipt('Reference\nNumber\n000123456789').details.reference,'000123456789');
 assert.equal(extractReceipt('Reference No.\nTransaction date\n22 October 2026').details.reference,'');
});

test('dates support month names, ISO and unambiguous numeric formats without timezone shifts',()=>{
 for(const value of ['Oct 22, 2026, 11:59 PM','Oct22,2026 10:01 AM','22 October 2026 00:01','22-Oct-2026','2026/10/22','10/22/2026','22/10/2026','22nd October 2026']) {
  assert.equal(extractReceipt(`Date: ${value}`).details.date,'2026-10-22',value);
 }
 assert.equal(extractReceipt('Date: Sept. 3, 2026').details.date,'2026-09-03');
 assert.equal(extractReceipt('Date: Feb 29, 2024').details.date,'2024-02-29');
 for(const value of ['2026-02-30','Feb 29, 2026','10/11/2026','Due date: Oct 22, 2026','Due Date\nOct 22, 2026']) {
  assert.equal(extractReceipt(value).details.date,'',value);
 }
 const result=extractReceipt('Date: Oct 22, 2026\nDue date: Nov 4, 2026');
 assert.equal(result.details.date,'2026-10-22');
 assert.equal(extractReceipt('Transaction date: Oct 22, 2026\nTransaction date: Oct 23, 2026').details.date,'');
});

test('provider selection never defaults to the receiving wallet or guesses between issuers',()=>{
 for(const text of ['To: GCash','Recipient bank\nGCash','Recipient\nBank\nGCash','Recipient: Maya','BPI\nMariBank\nAmount 100.00']) assert.equal(extractReceipt(text).details.provider,'',text);
 assert.equal(extractReceipt('Bank of the Philippine Islands\nTo GCash').details.provider,'BPI');
 assert.equal(extractReceipt('SeaBank\nTo GCash').details.provider,'SeaBank');
 assert.equal(extractReceipt('Sent via MariBank\nRecipient Maya').details.provider,'MariBank');
});

test('fee, total and balance cannot override the transferred amount or become unlabeled candidates',()=>{
 const result=extractReceipt('Maya\nP 1,250.00\nYou sent money\nFee\nPHP\n15.00\nTotal\nPHP\n1265.00\nBalance\nPHP\n9000.00');
 assert.equal(result.details.amount,'1250.00');
 assert.equal(extractReceipt('Fee\nPHP\n15.00\nBalance\nPHP\n9000.00').details.amount,'');
 assert.equal(extractReceipt('Phone 09123456789\nAccount 001234567890').details.amount,'');
 assert.equal(extractReceipt('Amount\nPHP\n1250.00').details.amount,'1250.00');
 assert.equal(extractReceipt('PHP 1250.00\nPHP 2000.00').details.amount,'');
 assert.equal(extractReceipt('Total Amount PHP 1265.00\nService fee PHP 15.00').details.amount,'');
});

test('BPI transaction reference outranks a distinct confirmation number without hiding the distinction',()=>{
 const result=extractReceipt('Transfer successful!\nTuesday, Sep 29 2026; 09:48 AM\nConfirmation No. 0000001234567\nTransaction Ref. No. 654321\nSent via BPI\nTransfer to\nGCash/G-Xchange\nTransfer amount\nPHP 1900.00');
 assert.deepEqual(result.details,{amount:'1900.00',reference:'654321',provider:'BPI',date:'2026-09-29'});assert.match(result.warnings.join(' '),/also has a confirmation number/);
});

test('source and destination bank sections retain their context across intervening account lines',()=>{
 const result=extractReceipt('Transferred\nTo\nA masked recipient\n********1234\nG-Xchange, Inc (GCash)\nFrom\nA masked sender\n********5678\nGoTyme Bank\nAmount $3,800.00\nFee £0.00\nTotal $3,800.00');
 assert.equal(result.details.provider,'GoTyme');assert.equal(result.details.amount,'3800.00');assert.equal(result.details.reference,'');assert.equal(result.details.date,'');assert.match(result.warnings.join(' '),/Confirm the amount is in PHP/);
});

test('GCash references can share the footer row with their payment date',()=>{
 const result=extractReceipt('Sent via GCash\nAmount 1900.00\nRef No. 0001 234 567890 Oct 17,2026 3:17 PM');
 assert.equal(result.details.reference,'0001 234 567890');assert.equal(result.details.date,'2026-10-17');
});

test('a processing Maya wallet debit is not a completed transfer, a payment amount or a phone-clock date',()=>{
 const result=extractReceipt('9:55\n- P1,910.00\nxv Processing\nSource\nMy Wallet\nDestination\nG-Xchange\nInc. / GCash\nMasked recipient\nPurpose\nPayment for tournament\nTransaction details\nTransaction fee P10.00\nReference ID 00000b123456\nMaya');
 assert.equal(result.details.provider,'Maya');assert.equal(result.details.amount,'');assert.equal(result.details.date,'');assert.equal(result.details.reference,'00000b123456');assert.match(result.warnings.join(' '),/pending or processing/);assert.match(result.warnings.join(' '),/total debit/);
 assert.doesNotMatch(extractReceipt('MariBank\nProcessing Time Realtime\nAmount 1900.00').warnings.join(' '),/pending or processing/);
});

test('OCR passes fill missing details, preserve zeroes and leave conflicting fields blank',()=>{
 const first=extractReceipt('Maya\nAmount 1250.00\nRef No. 001234567890');
 const second=extractReceipt('Maya\nPHP 1,250.00\nRef.No.: 0012 3456 7890\nOct 22, 2026');
 const result=combineReceiptReadings([first,second]);
 assert.equal(result.details.date,'2026-10-22');assert.equal(result.details.reference.replaceAll(' ',''),'001234567890');assert.deepEqual(result.warnings,[]);
 const conflict=combineReceiptReadings([first,extractReceipt('Maya\nAmount 1750.00\nRef No. 009234567890')]);
 assert.equal(conflict.details.amount,'');assert.equal(conflict.details.reference,'');assert.match(conflict.warnings.join(' '),/ambiguous/);
 const ambiguous=combineReceiptReadings([extractReceipt('Amount 1250.00\nAmount 2000.00'),second]);
 assert.equal(ambiguous.details.amount,'');
});

test('retry image normalization improves dark backgrounds without changing the uploaded blob',async()=>{
 const original=new Blob(['test']);assert.equal(await prepareReceiptImage(original),original); // Non-browser fallback.
 const pixels=new Uint8ClampedArray([0,0,0,255,0,0,0,255,255,255,255,255]);
 enhanceReceiptPixels(pixels);assert.deepEqual([...pixels],[255,255,255,255,255,255,255,255,0,0,0,255]);
 const light=new Uint8ClampedArray([255,255,255,255,255,255,255,255,0,0,0,255]);
 enhanceReceiptPixels(light);assert.deepEqual([...light],[255,255,255,255,255,255,255,255,0,0,0,255]);
});

test('browser retry preparation bounds canvas size, releases decoded images and keeps the original on failure',async()=>{
 const savedBitmap=globalThis.createImageBitmap,savedDocument=globalThis.document;
 let closed=0,canvas;
 const original=new Blob(['original']),enhanced=new Blob(['enhanced']);
 const context={fillRect(){},drawImage(){},getImageData:()=>({data:new Uint8ClampedArray([255,255,255,255])}),putImageData(){}};
 globalThis.createImageBitmap=async()=>({width:2000,height:2000,close(){closed++;}});
 globalThis.document={createElement:()=>canvas={getContext:()=>context,toBlob:callback=>callback(enhanced)}};
 try {
  assert.equal(await prepareReceiptImage(original),enhanced);assert.ok(canvas.width*canvas.height<=6_000_000);assert.ok(canvas.width<=3000&&canvas.height<=3000);assert.equal(closed,1);
  globalThis.document={createElement:()=>({getContext:()=>null})};
  assert.equal(await prepareReceiptImage(original),original);assert.equal(closed,2);
 } finally {if(savedBitmap===undefined)delete globalThis.createImageBitmap;else globalThis.createImageBitmap=savedBitmap;if(savedDocument===undefined)delete globalThis.document;else globalThis.document=savedDocument;}
});
