"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- Exiting must reload the document and discard its demo transport. */
import { useEffect, useRef, useState } from "react";
import Home from "../page";
import { installDemoTransport } from "../../lib/client-request";
import { UmpireDashboard } from "../components/umpire-dashboard";
import { CourtView } from "../components/court-view";
import { PrintMatchCards } from "../components/print-match-card";
import type { TournamentState } from "../../lib/tournament";
import { DEMO_RECEIPT_FILES, DEMO_REGISTRATION_PIN } from "../../lib/demo-fixture";

export default function DemoPage() {
  const [pin,setPin] = useState("");
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  const [expiresAt,setExpiresAt] = useState(0);
  const [umpireSeats, setUmpireSeats] = useState<{ name: string; court: number; pin: string }[]>([]);
  const [courtsOpen, setCourtsOpen] = useState(false);
  const [print, setPrint] = useState<{ state: TournamentState; matchId: string; number?: number }>();
  const stop = useRef<(() => void) | null>(null);
  const courtOpener = useRef<HTMLElement | null>(null);
  const backToOrganizer = useRef<HTMLButtonElement>(null);
  useEffect(() => () => { stop.current?.(); }, []);
  useEffect(() => {
    if (courtsOpen) backToOrganizer.current?.focus();
    else if (courtOpener.current) {
      courtOpener.current.focus();
      courtOpener.current = null;
    }
  }, [courtsOpen]);
  useEffect(() => {
    if (!print) return;
    const done = () => setPrint(undefined);
    window.addEventListener("afterprint", done, { once: true });
    const timer = setTimeout(() => window.print(), 120);
    return () => { clearTimeout(timer); window.removeEventListener("afterprint", done); };
  }, [print]);
  useEffect(() => {
    if (!expiresAt) return;
    const timer = setTimeout(() => {
      stop.current?.(); stop.current = null;
      setExpiresAt(0); setUmpireSeats([]); setCourtsOpen(false);
      setMessage("Demo session expired. Sign in to start a fresh demo.");
    }, Math.max(0, expiresAt - Date.now()));
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
      const receipts = await Promise.all(DEMO_RECEIPT_FILES.map(async file => {
        const response = await globalThis.fetch(`/${file}`);
        return response.ok ? new Uint8Array(await response.arrayBuffer()) : undefined;
      }));
      const runtime = await createDemoRuntime(grant.expiresAt, receipts);
      stop.current = installDemoTransport(runtime);
      setUmpireSeats(runtime.umpireSeats);
      setExpiresAt(grant.expiresAt);
    } catch(error){setMessage(error instanceof Error?error.message:"Unable to start the demo.");}
    finally{setBusy(false);}
  }
  if(!expiresAt)return <main className="clubhouse-site demo-entry"><section className="card gate"><h1>Organizer demo</h1><p>Practice with fictional players, scores and payment images. Changes stay in this tab and disappear when you reload or leave. Sessions last 30 minutes.</p><p>With a named organizer account, sign in on the tournament page first, then start this demo with the PIN field blank.</p><form onSubmit={event=>void start(event)}><label>Legacy organizer PIN (only before accounts are activated)<input type="password" inputMode="numeric" autoComplete="off" value={pin} maxLength={10} onChange={event=>setPin(event.target.value.replace(/\D/g,""))} /></label><button type="submit" className="primary" disabled={busy||Boolean(pin&&pin.length<4)}>{busy?"Starting…":"Start demo"}</button></form>{message&&<p role="alert">{message}</p>}<a href="/">Return to the tournament</a></section></main>;
  return <div className="demo-session">
    <aside className="demo-banner" aria-label="Demo session">
      <div><strong>Demo mode</strong><span>Fictional data. Changes stay in this tab. Reload to reset.</span></div>
      {!courtsOpen && <a href="#demo-umpire-devices">Practice umpire devices</a>}
      <button type="button" className="secondary" onClick={() => {
        if (confirm("Discard all demo changes and start a fresh session?")) window.location.reload();
      }}>Reset demo</button>
      <a href="/">Exit demo</a>
      <details><summary>Practice guide</summary>
        <ul>
          <li>Use Prepare to reorder divisions, preview draws, and review sample receipts. Existing practice registration PINs are {DEMO_REGISTRATION_PIN}.</li>
          <li>Sign in on a practice umpire device and start duty. Switch the tournament to Live, then assign a game to the staffed court in Game Day Desk.</li>
          <li>Open Court view from the desk to see assignments and scores. Use the two practice devices to test no-shows, disputes, and umpire handoffs.</li>
        </ul>
      </details>
    </aside>
    {courtsOpen && <section aria-label="Practice court display">
      <div className="demo-court-nav"><button type="button" className="secondary" ref={backToOrganizer} onClick={() => setCourtsOpen(false)}>Back to organizer</button></div>
      <CourtView demo />
    </section>}
    <div hidden={courtsOpen}>
      <Home demo onOpenDemoCourts={() => {
        courtOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setCourtsOpen(true);
        window.scrollTo(0, 0);
      }} />
      <section className="clubhouse-site content" id="demo-umpire-devices" aria-label="Practice umpire devices">
        <h2>Practice umpire devices</h2>
        <p>Both devices use this demo tournament. Enter the practice PIN for the court you want to staff.</p>
        <div className="umpire-roster-courts">{umpireSeats.map(seat => <section aria-label={seat.name + " practice umpire"} key={seat.court}>
          <h3>{seat.name} · Court {seat.court}</h3>
          <p>Practice PIN <strong>{seat.pin}</strong></p>
          <UmpireDashboard demoSeat={String(seat.court)} onPrint={(match, division, number) => setPrint({
            matchId: match.id, number, state: { tournamentName: "Racketeers practice tournament", divisions: division ? [division] : [], matches: [match] } as TournamentState,
          })} />
        </section>)}</div>
        {print && <PrintMatchCards state={print.state} matchId={print.matchId} number={print.number} />}
      </section>
    </div>
  </div>;
}
