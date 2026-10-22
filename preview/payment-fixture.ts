/** Disposable local receipts and D1. Never imported by production code. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { handlePaymentProof, type ProofEnvironment } from "../lib/payment-proof-server";
import { handlePaymentDetails } from "../lib/payment-details-server";
import type { TournamentState } from "../lib/tournament";
const digest = async (value: string) => Buffer.from(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))).toString("hex");
export function previewPaymentHandler(getState: () => TournamentState) {
  const db = new DatabaseSync(":memory:");
  const objects = new Map<string,{ bytes:Uint8Array; uploaded:Date; etag:string }>();
  const png=readFileSync(new URL("./receipt-fixture.png",import.meta.url));
  objects.set("payments/groups/PREVIEW-PAYMENT/PREVIEW-PAYMENT.png",{bytes:png,uploaded:new Date(),etag:"initial-preview-receipt"});
  return async (req:IncomingMessage,res:ServerResponse) => {
    const pinHash=await digest("98765432");
    const env:ProofEnvironment={DB:{prepare(sql){
      if(sql.includes("FROM tournament_state"))return {bind:()=>({first:async<T>()=>({payload:JSON.stringify({...getState(),organizerPinHash:pinHash})}) as T,run:async()=>({})}),run:async()=>({})};
      const statement=db.prepare(sql);
      const bound=(...values:unknown[])=>({first:async<T>()=>(statement.get(...values as (string|number)[]) || null) as T|null,run:async()=>({meta:{changes:Number(statement.run(...values as (string|number)[]).changes)}})});
      return {bind:bound,run:bound().run};
    }},PAYMENT_PROOFS:{
      head:async key=>{const value=objects.get(key);return value?{size:value.bytes.length,uploaded:value.uploaded,etag:value.etag}:null;},
      get:async key=>{const value=objects.get(key);return value?{size:value.bytes.length,uploaded:value.uploaded,etag:value.etag,body:new Blob([Uint8Array.from(value.bytes)]).stream()}:null;},
      put:async(key,bytes)=>{objects.set(key,{bytes,uploaded:new Date(),etag:await digest(Buffer.from(bytes).toString("base64"))});},
      delete:async key=>{objects.delete(key);},
    }};
    const headers=new Headers();
    if(req.headers['x-organizer-pin']==='demo-only')headers.set('x-organizer-pin','98765432');
    if(req.headers['content-type'])headers.set('content-type',String(req.headers['content-type']));
    const parts:Buffer[]=[];for await(const chunk of req)parts.push(Buffer.from(chunk));
    const request=new Request(new URL(`/api${req.url}`,"http://preview.test"),{method:req.method,headers,...(!['GET','HEAD'].includes(req.method||'GET')?{body:Buffer.concat(parts)}:{})});
    const response=await (req.url?.startsWith('/payment-details')?handlePaymentDetails(request,env):handlePaymentProof(request,env));
    res.statusCode=response.status;response.headers.forEach((value,key)=>res.setHeader(key,value));res.end(Buffer.from(await response.arrayBuffer()));
  };
}
