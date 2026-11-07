"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- Exiting must reload the document and discard its demo transport. */
import { useEffect, useRef, useState } from "react";
import Home from "../page";
import { installDemoTransport } from "../../lib/client-request";

export default function DemoPage() {
  const [pin,setPin] = useState("");
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  const [expiresAt,setExpiresAt] = useState(0);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => { stop.current?.(); }, []);
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(() => { stop.current?.(); stop.current=null;setExpiresAt(0);setMessage("Demo session expired. Sign in to start a fresh demo."); },Math.max(0,expiresAt-Date.now()));
    return () => clearTimeout(timer);
  },[expiresAt]);
  async function start(event: React.FormEvent) {
    event.preventDefault(); if(busy)return;setBusy(true);setMessage("");
    try {
      // This is the only live API call made by the demo page. The real PIN is not retained.
      const response = await globalThis.fetch("/api/demo",{method:"POST",headers:{"x-organizer-pin":pin}});
      const grant = await response.json();
      if(!response.ok || !grant.authorized)throw new Error(grant.error||"Organizer access is required.");
      setPin("");
      const {createDemoRuntime} = await import("../../lib/demo-runtime");
      const sample = await globalThis.fetch("/demo-receipt.png");
      const runtime = await createDemoRuntime(grant.expiresAt,sample.ok?new Uint8Array(await sample.arrayBuffer()):undefined);
      stop.current = installDemoTransport(runtime);setExpiresAt(grant.expiresAt);
    } catch(error){setMessage(error instanceof Error?error.message:"Unable to start the demo.");}
    finally{setBusy(false);}
  }
  if(!expiresAt)return <main className="clubhouse-site demo-entry"><section className="card gate"><h1>Organizer demo</h1><p>Practice with fictional players, scores and payment images. Changes stay in this tab and disappear when you reload or leave. Sessions last 30 minutes.</p><form onSubmit={event=>void start(event)}><label>Organizer PIN<input type="password" inputMode="numeric" autoComplete="off" value={pin} maxLength={10} onChange={event=>setPin(event.target.value.replace(/\D/g,""))} required /></label><button type="submit" className="primary" disabled={busy||pin.length<4}>{busy?"Starting…":"Start demo"}</button></form>{message&&<p role="alert">{message}</p>}<a href="/">Return to the tournament</a></section></main>;
  return <div className="demo-session"><aside className="demo-banner" aria-label="Demo session"><div><strong>Demo mode</strong><span>Fictional data. Changes stay in this tab; reload resets them. Never enter real payment or contact details.</span></div><button type="button" className="secondary" onClick={()=>{if(confirm("Discard all demo changes and start a fresh session?"))window.location.reload();}}>Reset demo</button><a href="/">Exit demo</a><details><summary>Practice guide</summary><p>Use Prepare to test registration and screenshots. Switch the phase to Live for court dispatch and scoring. All demo match PINs start as 4317; existing registration PINs are 12345678. Demo staff PIN is 98765432. Exported receipt links are temporary and only work while this demo tab stays open. Use Projector in this tab; separate court windows are unavailable.</p></details></aside><Home demo /></div>;
}
