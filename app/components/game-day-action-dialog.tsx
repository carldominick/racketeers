"use client";
import { useEffect, useRef, useState } from "react";
import { displayName, type Match, type TournamentState } from "../../lib/tournament";
import { bracketLabel, gameNumber, type GameDayAction } from "../../lib/game-day";

export type DeskAction = "holdGame" | "forfeitGame" | "clearForfeit";
export type DeskActionHandler = (action: GameDayAction, id: string, details?: { court?: number; reason?: string; forfeitingEntryId?: string }) => Promise<string | null>;

export function GameDayActionDialog({ state, match, action, busy, onAction, onClose }: { state: TournamentState; match: Match; action: DeskAction; busy: boolean; onAction: DeskActionHandler; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  const [reason, setReason] = useState("");
  const [forfeitingEntryId, setForfeitingEntryId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const waiting = busy || submitting;
  const waitingRef = useRef(waiting);
  const closeRef = useRef(onClose);
  useEffect(() => { waitingRef.current = waiting; closeRef.current = onClose; }, [waiting, onClose]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const controls = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? []).filter(element => element.getClientRects().length);
    panel.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !waitingRef.current) closeRef.current();
      if (event.key !== "Tab") return;
      const items = controls(), first = items[0], last = items.at(-1);
      if (!items.length) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", key); if (previous?.isConnected) previous.focus(); else document.querySelector<HTMLElement>(".desk-queue h3")?.focus(); };
  }, []);
  const entries = state.divisions.find(d => d.id === match.divisionId)?.entries ?? [];
  const name = (id: string | null) => displayName(entries.find(e => e.id === id));
  const winnerId = forfeitingEntryId === match.entryAId ? match.entryBId : match.entryAId;
  const validChoice = Boolean(forfeitingEntryId && [match.entryAId, match.entryBId].includes(forfeitingEntryId));
  const title = action === "holdGame" ? "Place game on hold" : action === "clearForfeit" ? "Clear forfeiture" : "Record no-show forfeiture";
  const submit = async () => {
    setSubmitting(true); setError("");
    try {
      const message = await onAction(action, match.id, { reason, forfeitingEntryId });
      if (message) setError(message); else onClose();
    } catch { setError("Unable to save. Your selection is kept; please retry."); }
    finally { setSubmitting(false); }
  };
  return <div className="modal-backdrop desk-editor-backdrop"><section ref={panel} tabIndex={-1} className="desk-action-dialog" role="dialog" aria-modal="true" aria-labelledby="desk-action-title" aria-describedby="desk-action-summary">
    <h2 id="desk-action-title">{title}</h2>
    <p id="desk-action-summary"><strong>Game {gameNumber(state, match)} · {bracketLabel(state, match)}</strong><br />{name(match.entryAId)} vs {name(match.entryBId)}</p>
    {action === "holdGame" ? <><p>This game will leave the ready queue and release its reserved court. Return it to the queue when the players are ready.</p><label>Organizer note (optional)<textarea value={reason} maxLength={160} rows={3} disabled={waiting} onChange={event => setReason(event.target.value)} /><small>Visible to organizers only.</small></label></> : action === "clearForfeit" ? <p>The forfeiture will be removed. Recorded points will be kept. Assign an available court before resuming play.</p> : <>
      <fieldset disabled={waiting}><legend>Which entry did not show up?</legend>{[match.entryAId, match.entryBId].map((id, index) => <label className="desk-forfeit-choice" key={index}><input type="radio" name="forfeiting-entry" value={id ?? ""} checked={forfeitingEntryId === id} onChange={() => setForfeitingEntryId(id ?? "")} /><span>{name(id)}</span></label>)}</fieldset>
      {validChoice && <p className="desk-forfeit-outcome"><strong>{name(winnerId)}</strong> will win by forfeiture.</p>}
      <p>This applies to the whole entry, including both players in doubles. Actual points are kept; no points are added. The result requires organizer validation before it counts in standings or advances players.</p>
    </>}
    {error && <p role="alert" className="desk-dialog-error">{error}</p>}
    <div className="desk-dialog-actions"><button type="button" className="secondary" disabled={waiting} onClick={onClose}>Cancel</button><button type="button" className={action === "forfeitGame" ? "desk-danger" : "primary"} disabled={waiting || action === "forfeitGame" && !validChoice} onClick={() => void submit()}>{submitting ? "Saving…" : action === "holdGame" ? "Place on hold" : action === "clearForfeit" ? "Clear forfeiture" : "Confirm forfeiture"}</button></div>
  </section></div>;
}
