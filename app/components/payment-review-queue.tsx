"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TournamentState } from "../../lib/tournament";
import { loadPaymentQueue, paymentExceptions, PAYMENT_FILTERS, type PaymentFilter, type PaymentQueueItem } from "../../lib/payment-review-queue";
import { ReceiptReview } from "./receipt-review";
import { RegistrationCharges } from "./registration-charges";

export function PaymentReviewQueue({ state, pin }: { state: TournamentState; pin: string }) {
  const [items, setItems] = useState<PaymentQueueItem[]>([]);
  const [filter, setFilter] = useState<PaymentFilter>("all");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Refresh to check uploaded screenshots and reviewed details across all divisions.");
  const [stale, setStale] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const pendingReviews = useRef(new Set<string>());
  const pendingChanged = useCallback((id: string, pending: boolean) => {
    if (pending) pendingReviews.current.add(id); else pendingReviews.current.delete(id);
  }, []);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const changed = () => { setStale(true); };
    window.addEventListener("receipt-details-saved", changed);
    return () => { window.removeEventListener("receipt-details-saved", changed); controller.current?.abort(); };
  }, []);
  const refresh = async () => {
    if (busy) return;
    if (pendingReviews.current.size) { setMessage("Save or reload your unsaved reviews and finish any reading before refreshing. Switching filters or closing a review keeps your fields."); return; }
    const abort = new AbortController(); controller.current = abort; setBusy(true);
    try { const next = await loadPaymentQueue(state.registrations, pin, abort.signal); if (!abort.signal.aborted) { setItems(next); setStale(false); setMessage(`${next.length} payment groups checked. Filters use saved reviews; open a group to read or correct its screenshot.`); } }
    catch (error) { if (!abort.signal.aborted) setMessage(error instanceof Error ? error.message : "Refresh failed. Previous results are retained."); }
    finally { if (!abort.signal.aborted) setBusy(false); }
  };
  const visible = items.filter(item => (filter === "all" || paymentExceptions(item, state.divisions, state.registrations).includes(filter)) && state.registrations.some(player => item.ids.includes(player.id) && `${player.name} ${player.id}`.toLowerCase().includes(search.toLowerCase())));
  return <section className="card payment-review-queue"><h2>Payment review desk</h2><p>Check exceptions, compare the screenshot with the fields, then save the review. Confirm payment received separately on each covered player’s card after checking your account.</p><div className="action-row"><button type="button" disabled={busy} onClick={() => void refresh()}>{busy ? "Checking payments…" : "Refresh payment queue"}</button><label>Show<select value={filter} onChange={event => setFilter(event.target.value as PaymentFilter)}>{Object.entries(PAYMENT_FILTERS).map(([key, label]) => <option key={key} value={key}>{label} ({key === "all" ? items.length : items.filter(item => paymentExceptions(item, state.divisions, state.registrations).includes(key as PaymentFilter)).length})</option>)}</select></label><label>Find player<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label></div><p role="status">{message}{stale && " Reviews changed. Refresh the queue to update these counts."}</p>
    {items.map(item => { const people = state.registrations.filter(player => item.ids.includes(player.id)); const issues = paymentExceptions(item, state.divisions, state.registrations); return <article key={item.registrationId} hidden={!visible.includes(item)}><h3>{people.map(player => player.name).join(" / ")}</h3><p>{issues.map(key => PAYMENT_FILTERS[key]).join(" · ") || "Reviewed details available"}</p><p>Coverage: {people.map(player => `${player.name} (${state.divisions.find(division => division.id === player.divisionId)?.name || "Division"}, ${player.paid ? "payment confirmed" : "unconfirmed"})`).join("; ")}</p>{item.record ? <><button type="button" aria-expanded={selected === item.registrationId} onClick={() => { setOpened(current => new Set([...current, item.registrationId])); setSelected(selected === item.registrationId ? null : item.registrationId); }}>{selected === item.registrationId ? "Close review" : "Review screenshot and details"}</button>{opened.has(item.registrationId) && <div hidden={selected !== item.registrationId}><RegistrationCharges divisions={state.divisions} people={people} /><ReceiptReview registrationId={item.registrationId} pin={pin} onPendingChange={pendingChanged} /></div>}</> : <p>No screenshot found. Ask the player to upload it using their registration PIN, or review the payment directly with them.</p>}</article>; })}
    {items.length > 0 && !visible.length && <p>No payments match this filter.</p>}
  </section>;
}
