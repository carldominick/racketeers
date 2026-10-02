"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { displayName, distributeEntriesToPools, standingsFor, subBracketName, type TournamentState } from "../../lib/tournament";
import { paginateRows } from "../../lib/projector";
import { CornersOut } from "@phosphor-icons/react/dist/csr/CornersOut";
import { CornersIn } from "@phosphor-icons/react/dist/csr/CornersIn";
import { NextGameNotice } from "./next-game-notice";

type Section = { id: string; title: string; headers: string[]; rows: { id: string; cells: ReactNode[] }[] };
export function Projector({ state, onFullscreenChange }: { state: TournamentState; onFullscreenChange?: (value: boolean) => void }) {
  const root = useRef<HTMLElement>(null);
  const [height, setHeight] = useState(600);
  const [pages, setPages] = useState<{ section: number; start: number; end: number; scale: number }[]>([]);
  const [slide, setSlide] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const toggleFullscreen = async () => {
    if (fullscreen) { if (document.fullscreenElement === root.current) await document.exitFullscreen(); setFullscreen(false); onFullscreenChange?.(false); return; }
    setFullscreen(true); onFullscreenChange?.(true);
    try { await root.current?.requestFullscreen(); } catch { /* Keep a navigation-free projection mode when native fullscreen is unavailable. */ }
  };
  useEffect(() => {
    const changed = () => { const active = document.fullscreenElement === root.current; setFullscreen(active); onFullscreenChange?.(active); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !document.fullscreenElement) { setFullscreen(false); onFullscreenChange?.(false); } };
    document.addEventListener("fullscreenchange", changed); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("fullscreenchange", changed); document.removeEventListener("keydown", escape); onFullscreenChange?.(false); };
  }, [onFullscreenChange]);
  const sections = useMemo(() => {
    const result: Section[] = [];
    const entries = new Map(state.divisions.flatMap(d => d.entries.map(e => [e.id, e] as const)));
    for (const [id, title] of [["live", "Live matchups"], ["upcoming", "Upcoming matchups"], ["finished", "Results"]]) {
      const matches = state.matches.filter(m => id === "live" ? m.status === "live" : id === "finished" ? m.status === "finished" || m.validated : m.status !== "live" && m.status !== "finished" && !m.validated);
      if (matches.length) result.push({ id, title, headers: ["Game / court", "Matchup", "Score"], rows: matches.map(m => ({ id: m.id, cells: [<><strong>{m.label}</strong><small>{state.divisions.find(d => d.id === m.divisionId)?.name} · {m.court ? `Court ${m.court}` : "Court TBD"}</small></>, <><strong>{displayName(entries.get(m.entryAId || ""))}</strong><small>vs</small><strong>{displayName(entries.get(m.entryBId || ""))}</strong></>, m.sets.map(s => `${s.a} – ${s.b}`).join(" / ") || "–"] })) });
    }
    for (const division of state.divisions) {
      const pools = distributeEntriesToPools(division);
      for (let pool = 0; pool < Math.max(1, pools.length); pool++) {
        const rows = standingsFor(state, division.id, pools.length > 1 ? pool : undefined);
        result.push({ id: `${division.id}:${pool}`, title: `${division.name}${pools.length > 1 ? ` · ${subBracketName(pool)}` : ""} — Standings`, headers: ["#", "Entry", "P", "W", "L", "PF", "PA", "Diff"], rows: rows.map((r, i) => ({ id: r.entryId, cells: [i + 1, <strong key="name">{r.name}</strong>, r.played, r.wins, r.losses, r.pointsFor, r.pointsAgainst, r.difference > 0 ? `+${r.difference}` : r.difference] })) });
      }
    }
    return result;
  }, [state]);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      const available = Math.max(100, window.innerHeight - el.getBoundingClientRect().top - 16);
      setHeight(available);
      const next = sections.flatMap((_, section) => {
        const sample = el.querySelectorAll<HTMLElement>(".projector-measure-section")[section];
        if (!sample) return [];
        const reserved = (sample.querySelector("header")?.getBoundingClientRect().height || 80) + (sample.querySelector("thead")?.getBoundingClientRect().height || 44) + 64 + (el.querySelector(".projector-controls")?.getBoundingClientRect().height || 44) + (el.querySelector(".next-game-notice")?.getBoundingClientRect().height || 0);
        const heights = Array.from(sample.querySelectorAll("tbody tr"), row => row.getBoundingClientRect().height);
        return paginateRows(heights, Math.max(1, available - reserved)).map(page => ({ section, ...page, scale: Math.min(1, Math.max(1, available - 64) / (reserved - 64 + heights.slice(page.start, page.end).reduce((sum, h) => sum + h, 0) + 2)) }));
      });
      setPages(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    const topbar = document.querySelector(".topbar");
    if (topbar) observer.observe(topbar);
    window.addEventListener("resize", measure);
    document.fonts.ready.then(measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [sections, fullscreen]);
  useEffect(() => { const timer = setInterval(() => setSlide(current => current + 1), 15000); return () => clearInterval(timer); }, []);
  const index = slide % Math.max(1, pages.length);
  const page = pages[index];
  const section = page && sections[page.section];
  const table = (s: Section, start = 0, end = s.rows.length) => <table className={s.headers.length === 3 ? "projector-match-table" : "projector-standings-table"}><thead><tr>{s.headers.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{s.rows.slice(start, end).map(row => <tr key={row.id}>{row.cells.map((cell, i) => <td key={i}>{cell}</td>)}</tr>)}</tbody></table>;
  return <section ref={root} className={`auto-projector ${fullscreen ? "projection-mode" : ""}`} style={{ height }} aria-label="Automatic tournament slideshow">
    <div className="projector-controls"><button type="button" className="ghost" aria-pressed={fullscreen} onClick={() => void toggleFullscreen()}>{fullscreen ? <CornersIn size={20} aria-hidden="true" /> : <CornersOut size={20} aria-hidden="true" />}{fullscreen ? "Exit fullscreen" : "Enter fullscreen"}</button>{fullscreen && <small>Press Escape to exit</small>}</div>
    <NextGameNotice state={state} />
    <div className="projector-measure" aria-hidden="true">{sections.map(s => <section className="projector-measure-section" key={s.id}><header><p>{state.tournamentName}</p><h2>{s.title}</h2></header>{table(s)}</section>)}</div>
    {section ? <section className="projector-page"><div style={{ transform: `scale(${page.scale})`, transformOrigin: "center" }}><header><p>{state.tournamentName}</p><h2>{section.title}</h2></header>{section.rows.length ? table(section, page.start, page.end) : <p className="projector-empty">No entries yet.</p>}</div></section> : <p className="projector-empty">No tournament data yet.</p>}
    <footer><span>{section?.rows.length ? `${page.start + 1}–${page.end} of ${section.rows.length} · ` : ""}Slide {index + 1} / {Math.max(1, pages.length)}</span><span>Automatically advances every 15 seconds</span><div className="slide-progress"><i key={slide} /></div></footer>
  </section>;
}
