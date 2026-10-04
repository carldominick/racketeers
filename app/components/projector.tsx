"use client";
/* eslint-disable @next/next/no-img-element -- Sponsor images use the dedicated public image endpoint. */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { displayName, matchScoreText, distributeEntriesToPools, standingsFor, subBracketName, type TournamentState } from "../../lib/tournament";
import { paginateCourts, paginateRows, projectorCourts } from "../../lib/projector";
import { normalizeProjectorSettings, type ProjectorSlideId } from "../../lib/projector-settings";
import { ProjectorCourts } from "./projector-courts";
import { CornersOut } from "@phosphor-icons/react/dist/csr/CornersOut";
import { NextGameNotice } from "./next-game-notice";
import { projectorViewport } from "../../lib/projector-viewport";
import "./projector-resolution.css";
import { useSponsorImages } from "./sponsor-images";
import type { SponsorImage } from "../../lib/sponsors";

type Section = { id: string; kind: ProjectorSlideId; title: string; image?: SponsorImage; headers: string[]; rows: { id: string; cells: ReactNode[] }[] };
export function Projector({ state, onFullscreenChange, sponsorImages }: { state: TournamentState; onFullscreenChange?: (value: boolean) => void; sponsorImages?: SponsorImage[] }) {
  const sponsorData = useSponsorImages(sponsorImages === undefined);
  const sponsors = sponsorImages ?? sponsorData.library.images;
  const root = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const fullscreenButton = useRef<HTMLButtonElement>(null);
  const wasFullscreen = useRef(false);
  const [height, setHeight] = useState(600);
  const [viewport, setViewport] = useState(() => projectorViewport(1920, 600));
  const [pages, setPages] = useState<{ section: number; start: number; end: number; scale: number }[]>([]);
  const [slide, setSlide] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const settings = useMemo(() => normalizeProjectorSettings(state.projector), [state.projector]);
  const allCourts = useMemo(() => projectorCourts(state), [state]);
  const courts = useMemo(() => allCourts.filter(court => settings.showAvailableCourts || court.status !== "available"), [allCourts, settings.showAvailableCourts]);
  const enterFullscreen = async () => {
    setFullscreen(true); onFullscreenChange?.(true);
    try { await root.current?.requestFullscreen(); } catch { /* Keep a navigation-free projection mode when native fullscreen is unavailable. */ }
  };
  useEffect(() => {
    if (fullscreen) root.current?.focus({ preventScroll: true });
    else if (wasFullscreen.current) fullscreenButton.current?.focus({ preventScroll: true });
    wasFullscreen.current = fullscreen;
  }, [fullscreen]);
  useEffect(() => {
    const changed = () => { const active = document.fullscreenElement === root.current; setFullscreen(active); onFullscreenChange?.(active); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !document.fullscreenElement) { setFullscreen(false); onFullscreenChange?.(false); } };
    document.addEventListener("fullscreenchange", changed); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("fullscreenchange", changed); document.removeEventListener("keydown", escape); onFullscreenChange?.(false); };
  }, [onFullscreenChange]);
  const sections = useMemo(() => {
    const result: Section[] = [{ id: "courts", kind: "courts", title: "Courts right now", headers: [], rows: courts.map(court => ({ id: String(court.court), cells: [] })) }];
    const entries = new Map(state.divisions.flatMap(d => d.entries.map(e => [e.id, e] as const)));
    for (const [id, title] of [["live", "Live matchups"], ["upcoming", "Upcoming matchups"], ["finished", "Results"]] as const) {
      const matches = state.matches.filter(m => !m.hold && (id === "live" ? m.status === "live" : id === "finished" ? m.status === "finished" || m.validated : m.status !== "live" && m.status !== "finished" && !m.validated));
      if (matches.length) result.push({ id, kind: id, title, headers: ["Game / court", "Matchup", "Score"], rows: matches.map(m => ({ id: m.id, cells: [<><strong>{m.label}</strong><small>{state.divisions.find(d => d.id === m.divisionId)?.name} · {m.court ? `Court ${m.court}` : "Court TBD"}</small></>, <><strong>{displayName(entries.get(m.entryAId || ""))}</strong><small>vs</small><strong>{displayName(entries.get(m.entryBId || ""))}</strong></>, m.forfeit ? <><strong>Forfeit · {displayName(entries.get(m.forfeit.winnerId))} wins</strong><small>{m.validated ? "Validated" : "Awaiting validation"}</small><small>{matchScoreText(m)}</small></> : matchScoreText(m)] })) });
    }
    for (const division of state.divisions) {
      const pools = distributeEntriesToPools(division);
      for (let pool = 0; pool < Math.max(1, pools.length); pool++) {
        const rows = standingsFor(state, division.id, pools.length > 1 ? pool : undefined);
        result.push({ id: `${division.id}:${pool}`, kind: "standings", title: `${division.name}${pools.length > 1 ? ` · ${subBracketName(pool)}` : ""} — Standings`, headers: ["#", "Entry", "P", "W", "L", "PF", "PA", "Diff"], rows: rows.map((r, i) => ({ id: r.entryId, cells: [i + 1, <strong key="name">{r.name}</strong>, r.played, r.wins, r.losses, r.pointsFor, r.pointsAgainst, r.difference > 0 ? `+${r.difference}` : r.difference] })) });
      }
    }
    for (const image of sponsors) result.push({ id: `sponsor:${image.id}`, kind: "sponsors", title: "Thank you to our sponsors", image, headers: [], rows: [] });
    return settings.slides.filter(slide => slide.enabled).flatMap(slide => result.filter(section => section.kind === slide.id));
  }, [state, courts, settings.slides, sponsors]);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      const preview = !fullscreen && el.closest<HTMLElement>(".projector-preview-dialog");
      const bottom = preview ? preview.getBoundingClientRect().bottom - parseFloat(getComputedStyle(preview).paddingBottom) : window.innerHeight;
      const available = fullscreen ? el.clientHeight : Math.max(100, bottom - el.getBoundingClientRect().top - 16);
      setHeight(available);
      const next = projectorViewport(el.clientWidth, available);
      setViewport(current => current.width === next.width && current.height === next.height && current.scale === next.scale ? current : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    const topbar = document.querySelector(".topbar");
    if (topbar) observer.observe(topbar);
    const preview = el.closest(".projector-preview-dialog");
    if (preview) observer.observe(preview);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [fullscreen]);
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    let active = true;
    const measure = () => {
      if (!active) return;
      // Pagination uses logical CSS pixels; the stage transform applies only once.
      const measuredHeight = (element: Element | null) => (element?.getBoundingClientRect().height ?? 0) / viewport.scale;
      const outerHeight = (element: Element | null) => element ? measuredHeight(element) + parseFloat(getComputedStyle(element).marginTop) + parseFloat(getComputedStyle(element).marginBottom) : 0;
      const style = getComputedStyle(el);
      const available = Math.max(1, viewport.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
      const controls = outerHeight(el.querySelector(".projector-controls")) + outerHeight(el.querySelector(".next-game-notice"));
      const footer = outerHeight(el.querySelector("footer"));
      const bodyHeight = Math.max(1, available - controls - footer);
      const next = sections.flatMap((content, section) => {
        const sample = el.querySelectorAll<HTMLElement>(".projector-measure-section")[section];
        if (!sample) return [];
        const header = measuredHeight(sample.querySelector("header"));
        if (content.kind === "sponsors") return [{ section, start: 0, end: 0, scale: Math.min(1, bodyHeight / Math.max(1, measuredHeight(sample))) }];
        if (content.kind === "courts") {
          const grid = sample.querySelector<HTMLElement>(".projector-court-grid");
          if (!grid) return [{ section, start: 0, end: 0, scale: 1 }];
          const columns = getComputedStyle(grid).gridTemplateColumns.split(" ").length;
          const gap = parseFloat(getComputedStyle(grid).rowGap) || 0;
          const heights = Array.from(grid.querySelectorAll(".projector-court"), measuredHeight);
          return paginateCourts(heights, columns, Math.max(1, bodyHeight - header - 4), gap).map(page => {
            const rows = Array.from({ length: Math.ceil((page.end - page.start) / columns) }, (_, row) => Math.max(...heights.slice(page.start + row * columns, Math.min(page.end, page.start + (row + 1) * columns))));
            const used = header + rows.reduce((sum, value) => sum + value, 0) + Math.max(0, rows.length - 1) * gap;
            return { section, ...page, scale: Math.min(1, bodyHeight / Math.max(1, used + 4)) };
          });
        }
        const reserved = header + measuredHeight(sample.querySelector("thead")) + 2;
        const heights = Array.from(sample.querySelectorAll("tbody tr"), measuredHeight);
        return paginateRows(heights, Math.max(1, bodyHeight - reserved)).map(page => ({ section, ...page, scale: Math.min(1, bodyHeight / Math.max(1, reserved + heights.slice(page.start, page.end).reduce((sum, h) => sum + h, 0))) }));
      });
      setPages(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    document.fonts.ready.then(measure);
    return () => { active = false; observer.disconnect(); };
  }, [sections, viewport, fullscreen]);
  const index = slide % Math.max(1, pages.length);
  const page = pages[index];
  const section = page && sections[page.section];
  const seconds = settings.slides.find(item => item.id === section?.kind)?.seconds ?? 15;
  const pageKey = section ? `${section.id}:${page.start}` : "empty";
  useEffect(() => {
    if (!settings.autoAdvance || !section) return;
    const timer = setTimeout(() => setSlide(current => current + 1), seconds * 1000);
    return () => clearTimeout(timer);
  }, [slide, pageKey, seconds, settings.autoAdvance, Boolean(section)]); // eslint-disable-line react-hooks/exhaustive-deps
  const table = (s: Section, start = 0, end = s.rows.length) => <table className={s.headers.length === 3 ? "projector-match-table" : "projector-standings-table"}><thead><tr>{s.headers.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{s.rows.slice(start, end).map(row => <tr key={row.id}>{row.cells.map((cell, i) => <td key={i}>{cell}</td>)}</tr>)}</tbody></table>;
  const content = (s: Section, start = 0, end = s.rows.length) => s.kind === "courts" ? <ProjectorCourts courts={courts.slice(start, end)} allCourts={allCourts} settings={settings} tournamentName={state.tournamentName} /> : <><header><p>{state.tournamentName}</p><h2>{s.title}</h2></header>{s.image ? <figure className="projector-sponsor"><img src={s.image.url} alt={s.image.name} style={{ height: Math.max(80, viewport.height - 300) }} /><figcaption>{s.image.name}</figcaption></figure> : s.rows.length ? table(s, start, end) : <p className="projector-empty">No entries yet.</p>}</>;
  return <section ref={root} tabIndex={-1} className={`auto-projector ${fullscreen ? "projection-mode" : ""}`} style={{ height }} aria-label="Automatic tournament slideshow">
    <div ref={stage} className={`projector-stage ${viewport.scaled ? "projector-scaled" : ""}`} style={{ width: viewport.width, height: viewport.height, transform: `scale(${viewport.scale})` }}>
    {!fullscreen && <div className="projector-controls"><button ref={fullscreenButton} type="button" className="ghost" onClick={() => void enterFullscreen()}><CornersOut size={20} aria-hidden="true" />Enter fullscreen</button></div>}
    <NextGameNotice state={state} />
    <div className="projector-measure" aria-hidden="true">{sections.map(s => <section className="projector-measure-section" key={s.id}>{content(s)}</section>)}</div>
    {section ? <section className={`projector-page ${section.kind === "courts" ? "projector-courts-page" : ""}`}><div style={{ transform: `scale(${page.scale})`, transformOrigin: "center" }}>{content(section, page.start, page.end)}</div></section> : <p className="projector-empty">No slides to display.</p>}
    <footer><span>{section?.rows.length ? `${page.start + 1}–${page.end} of ${section.rows.length} · ` : ""}Slide {index + 1} / {Math.max(1, pages.length)}</span><span>{settings.autoAdvance ? `Automatically advances every ${seconds} seconds` : "Auto-advance paused"}</span><div className="slide-progress"><i key={`${slide}:${pageKey}:${seconds}`} style={{ animationDuration: `${seconds}s`, animationPlayState: settings.autoAdvance ? "running" : "paused" }} /></div></footer>
    </div>
  </section>;
}
