"use client";
import { apiFetch as fetch } from "../../lib/client-request";


import { useEffect, useRef, useState } from "react";
import { Bell } from "@phosphor-icons/react/dist/csr/Bell";
import { X } from "@phosphor-icons/react/dist/csr/X";
import { staffNotificationText } from "../../lib/staff-events";
import { pollFailure, POLL_TIMEOUT_MS, STAFF_POLL_MS } from "../../lib/sync-status";
import type { CourtHelpRequest, StaffNotification } from "../../lib/tournament";
import { DESK_CHIMES, useCourtChimes } from "./use-court-chimes";

type Props = { organizerPin: string; umpirePin: string; gameDayVisible: boolean; onStatus: (help: Record<string, CourtHelpRequest>) => void; onClearHelp: (court: number) => void; busyCourt: number | null; onSessionExpired?: (expired: boolean) => void };

/** Poll staff-only signals without replacing unsaved setup fields or queued umpire scores. */
export function StaffCourtUpdates({ organizerPin, umpirePin, gameDayVisible, onStatus, onClearHelp, busyCourt, onSessionExpired }: Props) {
  const [alerts, setAlerts] = useState<StaffNotification[]>([]);
  const [warning, setWarning] = useState("");
  const { status: soundStatus, toggle: toggleSound, play } = useCourtChimes(DESK_CHIMES);
  const onGameDay = useRef(gameDayVisible);
  useEffect(() => { onGameDay.current = gameDayVisible; }, [gameDayVisible]);
  useEffect(() => {
    let stopped = false, inFlight = false;
    let retry = { failures: 0, retryAt: 0 };
    let seen: Set<string> | null = null;
    const controller = new AbortController();
    const refresh = async () => {
      if (stopped || inFlight || document.visibilityState === "hidden" || Date.now() < retry.retryAt) return;
      inFlight = true;
      let retryAfter: string | null = null;
      try {
        const response = await fetch("/api/state?staffUpdates=1", {
          headers: organizerPin ? { "x-organizer-pin": organizerPin } : { "x-umpire-pin": umpirePin },
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(POLL_TIMEOUT_MS)]), cache: "no-store"
        });
        if (stopped) return;
        if (response.status === 401 || response.status === 403) {
          stopped = true;
          if (organizerPin === "session") onSessionExpired?.(true);
          else setWarning("Sign in again to receive court alerts.");
          return;
        }
        if (response.status === 429 || response.status === 503) retryAfter = response.headers.get("Retry-After");
        if (!response.ok) throw new Error("Staff updates unavailable");
        const data = await response.json() as { courtHelp: Record<string, CourtHelpRequest>; notifications: StaffNotification[] };
        if (stopped) return;
        if (!data.courtHelp || !Array.isArray(data.notifications)) throw new Error("Invalid staff update");
        retry = { failures: 0, retryAt: 0 };
        onStatus(data.courtHelp);
        setWarning("");
        if (organizerPin) {
          const newAlerts = seen ? data.notifications.filter(event => !seen!.has(event.id)) : Object.values(data.courtHelp).map(help => ({ id: help.id, kind: "help_requested" as const, court: help.court, createdAt: help.requestedAt }));
          if (seen && onGameDay.current) {
            if (newAlerts.some(event => event.kind === "help_requested" && data.courtHelp[event.court])) play("court-needs-help");
            if (newAlerts.some(event => event.kind === "court_released" && event.gameComplete)) play("game-finished");
          }
          seen = new Set(data.notifications.map(event => event.id));
          setAlerts(current => [...new Map([...current, ...newAlerts].map(event => [event.id, event])).values()].filter(event => event.kind !== "help_requested" || Boolean(data.courtHelp[event.court])).slice(-8));
        }
      } catch {
        if (!stopped) {
          const failure = pollFailure(retry.failures, Date.now(), retryAfter);
          retry = failure;
          if (failure.unavailable || !navigator.onLine) setWarning("Court alerts are reconnecting…");
        }
      }
      finally { inFlight = false; }
    };
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), STAFF_POLL_MS);
    const resume = () => { if (document.visibilityState !== "hidden") void refresh(); };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => { stopped = true; controller.abort(); clearTimeout(initial); clearInterval(timer); document.removeEventListener("visibilitychange", resume); window.removeEventListener("online", resume); };
  }, [organizerPin, umpirePin, onStatus, onSessionExpired, play]);
  const latest = [...alerts].reverse().find(event => event.kind === "help_requested") ?? alerts.at(-1);
  return <>{warning && <p className="staff-updates-warning" role="status">{warning}</p>}{organizerPin && (gameDayVisible || alerts.length > 0) && <aside className="staff-notifications" aria-label="Organizer court notifications">
    {gameDayVisible && <header><span><Bell size={20} aria-hidden="true" />Game Day sounds</span><button type="button" className="ghost" aria-pressed={soundStatus === "on"} onClick={() => void toggleSound()}>{soundStatus === "on" ? "Disable court chimes" : soundStatus === "loading" ? "Cancel loading court chimes" : "Enable court chimes"}</button></header>}
    {gameDayVisible && soundStatus === "unavailable" && <p className="staff-updates-warning" role="status">Sound is unavailable. Court updates still appear on screen.</p>}
    {latest && <details className="staff-alerts-panel"><summary aria-label={`Court updates: ${alerts.length}. ${staffNotificationText(latest)}`}><Bell size={20} aria-hidden="true" /><span role="status">{alerts.length} court updates · {staffNotificationText(latest)}</span></summary><header><span>Court updates</span><button type="button" className="ghost" onClick={() => setAlerts([])}>Dismiss all</button></header><div className="staff-notification-list" aria-live="polite" aria-relevant="additions">{[...alerts].reverse().map(event => <article className={`staff-notification ${event.kind === "help_requested" ? "needs-help" : ""}`} key={event.id}><div><strong>{staffNotificationText(event)}</strong>{event.matchLabel && <p>{event.matchLabel}</p>}<small>{new Date(event.createdAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}</small>{event.kind === "help_requested" && <button type="button" className="secondary" disabled={busyCourt !== null} onClick={() => onClearHelp(event.court)}>{busyCourt === event.court ? "Updating…" : "Clear help request"}</button>}</div><button type="button" className="notification-dismiss" aria-label={`Dismiss ${staffNotificationText(event)}`} onClick={() => setAlerts(current => current.filter(item => item.id !== event.id))}><X size={20} aria-hidden="true" /></button></article>)}</div></details>}
  </aside>}</>;
}
