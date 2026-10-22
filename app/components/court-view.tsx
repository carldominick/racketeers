"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowsOut } from "@phosphor-icons/react/dist/csr/ArrowsOut";
import { ArrowClockwise } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { Minus } from "@phosphor-icons/react/dist/csr/Minus";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import type { CourtViewSnapshot } from "../../lib/court-view";
import { CourtVenue } from "./court-venue";

export function CourtView() {
  const [snapshot, setSnapshot] = useState<CourtViewSnapshot | null>(null);
  const [selected, setSelected] = useState(1);
  const [connected, setConnected] = useState(false);
  const [receivedAt, setReceivedAt] = useState(0);
  const [now, setNow] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [flat, setFlat] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [message, setMessage] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const onFallback = useCallback(() => setFlat(true), []);
  useEffect(() => {
    const query = matchMedia("(max-width: 900px)");
    const resize = () => { if (query.matches) setFlat(true); };
    resize(); query.addEventListener("change",resize);
    return () => query.removeEventListener("change",resize);
  }, []);
  useEffect(() => {
    let active = true, pending = false, staffReceived = 0;
    let bus: BroadcastChannel | null = null;
    const accept = (value: CourtViewSnapshot) => {
      if (!active) return;
      setSnapshot(value); setReceivedAt(Date.now()); setConnected(true);
    };
    const clearPrivatePreview = () => setSnapshot(current => current && current.phase !== "live" && current.phase !== "completed" ? { ...current, courts: [] } : current);
    const nonce = location.hash.slice(1);
    if (/^[a-f\d-]{36}$/i.test(nonce) && typeof BroadcastChannel !== "undefined") {
      bus = new BroadcastChannel(`racketeers-courts-${nonce}`);
      bus.onmessage = event => {
        if (event.data?.type === "snapshot" && Array.isArray(event.data.snapshot?.courts)) {
          staffReceived = Date.now(); accept(event.data.snapshot);
        } else if (event.data?.type === "disconnected") { staffReceived = 0; clearPrivatePreview(); setConnected(false); }
      };
    }
    const controller = new AbortController();
    const poll = async () => {
      if (pending || document.hidden) return;
      pending = true; bus?.postMessage({ type: "refresh" });
      try {
        const response = await fetch("/api/courts", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (Date.now() - staffReceived > 6000) accept(data);
      } catch { if (active && Date.now() - staffReceived > 6000) setConnected(false); }
      finally { pending = false; }
    };
    const refresh = () => {
      setNow(Date.now());
      if(staffReceived && Date.now()-staffReceived>6000){staffReceived=0;clearPrivatePreview();}
      void poll();
    };
    const visibility = () => { if (!document.hidden) refresh(); };
    void poll();
    const timer = setInterval(refresh, 2000);
    document.addEventListener("visibilitychange", visibility);
    return () => { active = false; clearInterval(timer); controller.abort(); bus?.close(); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  useEffect(() => {
    const change = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);
  const courts = snapshot?.courts || [];
  const court = courts.find(c => c.court === selected) || courts[0];
  const stale = !connected || now - receivedAt > 8000;
  const enterFullscreen = async () => {
    try { await root.current?.requestFullscreen(); setMessage(""); }
    catch { setMessage("Fullscreen is unavailable here. Maximize this window for the dedicated court view."); }
  };
  return <div className={`court-window ${snapshot?.theme || "light"}`} ref={root}>
    <header className="court-window-toolbar"><div><p>{snapshot?.name || "Racketeers"}</p><h1>Court view</h1></div><div className="court-window-counts">{(["in_play", "reserved", "available"] as const).map(status => <span key={status} className={`court-status ${status}`}>{courts.filter(c => c.status === status).length} {status.replace("_", " ")}</span>)}</div><span className={stale ? "court-connection stale" : "court-connection"} role="status">{stale ? receivedAt ? "Reconnecting · showing last update" : "Connecting…" : "Live · Updated just now"}</span>{!fullscreen && <button className="primary" onClick={() => void enterFullscreen()}><ArrowsOut size={20} aria-hidden="true" />Enter fullscreen</button>}</header>
    {message && <p role="status" className="court-window-message">{message}</p>}
    {!courts.length ? <div className="court-window-empty"><h2>{snapshot ? "Court information is not published yet" : "Loading courts…"}</h2><p>Open this window from the organizer’s Game day desk to preview courts before the tournament goes live.</p></div> : <>
      <CourtVenue courts={courts} selected={court?.court || 1} onSelect={setSelected} theme={snapshot?.theme || "light"} flat={flat} rotation={rotation} zoom={zoom} onFallback={onFallback} />
      <footer className="court-window-scoreboard"><div><h2>Court {String(court?.court).padStart(2,"0")}</h2><span className={`court-status ${court?.status}`}>{court?.status.replace("_", " ")}</span></div>{court?.game ? <div className="court-selected-match"><div>{court.game.playersA.map((name,i) => <strong key={i}>{name}</strong>)}</div><div><b>{court.status === "reserved" ? "– : –" : `${court.game.scoreA} – ${court.game.scoreB}`}</b><small>{court.game.division} · Game {court.game.number} · Set {court.game.setNumber}</small></div><div>{court.game.playersB.map((name,i) => <strong key={i}>{name}</strong>)}</div></div> : <p>No game assigned</p>}<div className="court-view-tools"><button aria-label="Rotate venue left" disabled={flat} onClick={() => setRotation(r => r - Math.PI/8)}>Rotate left</button><button aria-label="Rotate venue right" disabled={flat} onClick={() => setRotation(r => r + Math.PI/8)}>Rotate right</button><button aria-label="Zoom out" disabled={flat || zoom <= .7} onClick={() => setZoom(z => Math.max(.7,z-.15))}><Minus size={20} /></button><button aria-label="Zoom in" disabled={flat || zoom >= 1.8} onClick={() => setZoom(z => Math.min(1.8,z+.15))}><Plus size={20} /></button><button disabled={flat} onClick={() => { setRotation(0); setZoom(1); }}><ArrowClockwise size={18} />Reset view</button><button aria-pressed={flat} onClick={() => setFlat(f => !f)}>{flat ? "3D view" : "2D list"}</button></div></footer>
    </>}
    <div className="court-window-note"><span>Illustrative player positions · Select a court to inspect its game</span><span>Assignments stay in the main desk · Esc exits fullscreen</span></div>
  </div>;
}
