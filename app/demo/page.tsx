"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- Exiting must reload the document and discard its demo transport. */
import { useEffect, useRef, useState } from "react";
import Home from "../page";
import { installDemoTransport } from "../../lib/client-request";
import { UmpireDashboard } from "../components/umpire-dashboard";
import { PrintMatchCards } from "../components/print-match-card";
import type { TournamentState } from "../../lib/tournament";

export default function DemoPage() {
  const [pin,setPin] = useState("");
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  const [expiresAt,setExpiresAt] = useState(0);
  const [print, setPrint] = useState<{ state: TournamentState; matchId: string; number?: number }>();
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => { stop.current?.(); }, []);
  useEffect(() => {
    if (!print) return;
    const done = () => setPrint(undefined);
    window.addEventListener("afterprint", done, { once: true });
    const timer = setTimeout(() => window.print(), 120);
    return () => { clearTimeout(timer); window.removeEventListener("afterprint", done); };
  }, [print]);
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(() => { stop.current?.(); stop.current=null;setExpiresAt(0);setMessage("Demo session expired. Sign in to start a fresh demo."); },Math.max(0,expiresAt-Date.now()));
    return () => clearTimeout(timer);
  },[expiresAt]);
  async function start(event: React.FormEvent) {
    event.preventDefault(); if(busy)return;setBusy(true);setMessage("");
    try {
      // This is the only live API call made by the demo page. The real PIN is not retained.
      const response = await globalThis.fetch("/api/demo",{method:"POST",headers:{"x-organizer-pin":pin || 'session'}});
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
  if(!expiresAt)return <main className="clubhouse-site demo-entry"><section className="card gate"><h1>Organizer demo</h1><p>Practice with fictional players, scores and payment images. Changes stay in this tab and disappear when you reload or leave. Sessions last 30 minutes.</p><p>With a named organizer account, sign in on the tournament page first, then start this demo with the PIN field blank.</p><form onSubmit={event=>void start(event)}><label>Legacy organizer PIN (only before accounts are activated)<input type="password" inputMode="numeric" autoComplete="off" value={pin} maxLength={10} onChange={event=>setPin(event.target.value.replace(/\D/g,""))} /></label><button type="submit" className="primary" disabled={busy||Boolean(pin&&pin.length<4)}>{busy?"Starting…":"Start demo"}</button></form>{message&&<p role="alert">{message}</p>}<a href="/">Return to the tournament</a></section></main>;
  return <div className="demo-session"><aside className="demo-banner" aria-label="Demo session"><div><strong>Demo mode</strong><span>Fictional data. Changes stay in this tab. Reload to reset.</span></div><button type="button" className="secondary" onClick={()=>{if(confirm("Discard all demo changes and start a fresh session?"))window.location.reload();}}>Reset demo</button><a href="/">Exit demo</a><details><summary>Practice guide</summary><p>Open Run tournament → Umpire roster and enable personal umpire access. Add umpires, then sign in to the practice umpire consoles below using the generated demo PINs. Start duty and assign a court to each umpire. Switch to Live and use Game Day Desk to dispatch games. Existing demo registration PINs are 12345678.</p></details></aside>
    <Home demo />
    <main className="clubhouse-site content" aria-label="Practice umpire devices"><h2>Practice umpire devices</h2><p>These two consoles share this demo tournament so you can practice a handoff.</p><div className="umpire-roster-courts">{["First", "Second"].map(seat => <section aria-label={seat + " practice umpire"} key={seat}><h3>{seat} umpire device</h3><UmpireDashboard demoSeat={seat} onPrint={(match, division, number) => setPrint({ matchId: match.id, number, state: { tournamentName: "Racketeers practice tournament", divisions: division ? [division] : [], matches: [match] } as TournamentState })} /></section>)}</div>
      {print && <PrintMatchCards state={print.state} matchId={print.matchId} number={print.number} />}
    </main>
  </div>;
}
