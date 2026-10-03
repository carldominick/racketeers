"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { ArrowDown } from "@phosphor-icons/react/dist/csr/ArrowDown";
import { MAX_SLIDE_SECONDS, MIN_SLIDE_SECONDS, normalizeProjectorSettings, PROJECTOR_SLIDES, type ProjectorSettings as Settings, type ProjectorSlideId } from "../../lib/projector-settings";
import type { TournamentState } from "../../lib/tournament";
import { Projector } from "./projector";

export function ProjectorSettings({ state, onSave, onPreviewChange }: { state: TournamentState; onSave: (settings: Settings) => Promise<void>; onPreviewChange: (open: boolean) => void }) {
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const settings = draft ?? normalizeProjectorSettings(state.projector);
  const update = (patch: Partial<Settings>) => { setDraft({ ...settings, ...patch }); setMessage(""); };
  const updateSlide = (id: ProjectorSlideId, patch: Partial<Settings["slides"][number]>) => update({ slides: settings.slides.map(slide => slide.id === id ? { ...slide, ...patch } : slide) });
  const move = (index: number, direction: number) => {
    const slides = [...settings.slides];
    [slides[index], slides[index + direction]] = [slides[index + direction], slides[index]];
    update({ slides });
  };
  const save = async () => {
    if (!settings.slides.some(slide => slide.enabled)) { setFailed(true); setMessage("Choose at least one projector slide."); return; }
    setSaving(true); setMessage(""); setFailed(false);
    try { await onSave(settings); setDraft(null); setMessage("Projector settings saved."); }
    catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "Unable to save. Your settings are kept here; please retry."); }
    finally { setSaving(false); }
  };
  useEffect(() => {
    if (!preview) return;
    const element = dialog.current;
    const trigger = previewButton.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.querySelector<HTMLButtonElement>("button")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.fullscreenElement) { event.preventDefault(); setPreview(false); onPreviewChange(false); }
      if (event.key !== "Tab") return;
      const buttons = Array.from(element?.querySelectorAll<HTMLElement>("button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex='0']") ?? []);
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); document.body.style.overflow = previousOverflow; trigger?.focus(); };
  }, [preview, onPreviewChange]);
  return <>
    <section className="projector-settings" inert={preview}>
      <div className="section-head"><div><p className="eyebrow">Public display</p><h2>Projector settings</h2><p>Choose what spectators see and how long each page stays on screen.</p></div></div>
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset disabled={saving}><legend className="sr-only">Projector slideshow settings</legend>
          <div className="projector-settings-layout">
            <div><div className="projector-setting-head" aria-hidden="true"><span>Order</span><span>Show</span><span>Slide</span><span>Seconds per page</span></div>
              <ol className="projector-setting-list">{settings.slides.map((slide, index) => {
                const label = PROJECTOR_SLIDES.find(item => item.id === slide.id)!.label;
                return <li key={slide.id}><div className="projector-order"><button type="button" className="ghost" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={18} aria-hidden="true" /></button><button type="button" className="ghost" aria-label={`Move ${label} down`} disabled={index === settings.slides.length - 1} onClick={() => move(index, 1)}><ArrowDown size={18} aria-hidden="true" /></button></div><input type="checkbox" aria-label={`Show ${label}`} checked={slide.enabled} onChange={event => updateSlide(slide.id, { enabled: event.target.checked })} /><strong>{label}</strong><label className="projector-duration"><span className="sr-only">{label} seconds per page</span><input type="number" inputMode="numeric" min={MIN_SLIDE_SECONDS} max={MAX_SLIDE_SECONDS} step={1} required value={Number.isFinite(slide.seconds) ? slide.seconds : ""} onChange={event => updateSlide(slide.id, { seconds: event.target.valueAsNumber })} /><span>sec</span></label></li>;
              })}</ol><p className="projector-settings-help">Timing applies to each page when a slide has multiple pages. Choose {MIN_SLIDE_SECONDS}–{MAX_SLIDE_SECONDS} seconds.</p></div>
            <div className="projector-display-details"><h3>Court overview details</h3>{([
              ["showPlayers", "Player names"], ["showScores", "Live scores"], ["showGameInfo", "Division & game number"], ["showAvailableCourts", "Available courts"],
            ] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={settings[key]} onChange={event => update({ [key]: event.target.checked })} />{label}</label>)}<div className="projector-auto-advance"><label><input type="checkbox" checked={settings.autoAdvance} onChange={event => update({ autoAdvance: event.target.checked })} />Auto-advance</label><p>Automatically move to the next page when its time expires.</p></div><p className="projector-settings-help">Court slides use the same light or dark theme as the rest of the slideshow.</p></div>
          </div>
          <div className="projector-settings-actions"><button type="submit" className="primary">{saving ? "Saving…" : "Save projector settings"}</button><button type="button" className="ghost" ref={previewButton} onClick={() => { setPreview(true); onPreviewChange(true); }}>Preview slideshow</button>{draft && <span>Unsaved settings</span>}</div>
        </fieldset>
      </form>
      {message && <p className={failed ? "error" : "projector-settings-message"} role={failed ? "alert" : "status"}>{message}</p>}
    </section>
    {preview && <div className="modal-backdrop projector-preview-backdrop"><section ref={dialog} className="projector-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="projector-preview-title"><div className="projector-preview-heading"><h2 id="projector-preview-title">Slideshow preview</h2><button type="button" className="ghost" onClick={() => { setPreview(false); onPreviewChange(false); }}>Close preview</button></div><Projector state={{ ...state, projector: normalizeProjectorSettings(settings) }} /></section></div>}
  </>;
}
