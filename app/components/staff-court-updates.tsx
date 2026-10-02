"use client";

import { useEffect, useState } from "react";
import { Bell } from "@phosphor-icons/react/dist/csr/Bell";
import { X } from "@phosphor-icons/react/dist/csr/X";
import { staffNotificationText } from "../../lib/staff-events";
import type { CourtHelpRequest, StaffNotification } from "../../lib/tournament";

type Props = { organizerPin: string; umpirePin: string; onStatus: (help: Record<string, CourtHelpRequest>) => void; onClearHelp: (court: number) => void; busyCourt: number | null };

/** Poll staff-only signals without replacing unsaved setup fields or queued umpire scores. */
export function StaffCourtUpdates({ organizerPin, umpirePin, onStatus, onClearHelp, busyCourt }: Props) {
  const [alerts, setAlerts] = useState<StaffNotification[]>([]);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let stopped = false, inFlight = false;
    let seen: Set<string> | null = null;
    const controller = new AbortController();
    const refresh = async () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const response = await fetch("/api/state?staffUpdates=1", { headers: organizerPin ? { "x-organizer-pin": organizerPin } : { "x-umpire-pin": umpirePin }, signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Staff updates unavailable");
        const data = await response.json() as { courtHelp: Record<string, CourtHelpRequest>; notifications: StaffNotification[] };
        if (stopped) return;
        onStatus(data.courtHelp);
        setOffline(false);
        if (organizerPin) {
          const newAlerts = seen ? data.notifications.filter(event => !seen!.has(event.id)) : Object.values(data.courtHelp).map(help => ({ id: help.id, kind: "help_requested" as const, court: help.court, createdAt: help.requestedAt }));
          seen = new Set(data.notifications.map(event => event.id));
          setAlerts(current => [...current, ...newAlerts].filter(event => event.kind !== "help_requested" || Boolean(data.courtHelp[event.court])).slice(-8));
        }
      } catch { if (!stopped) setOffline(true); }
      finally { inFlight = false; }
    };
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 1000);
    const resume = () => { if (document.visibilityState !== "hidden") void refresh(); };
    document.addEventListener("visibilitychange", resume);
    return () => { stopped = true; controller.abort(); clearTimeout(initial); clearInterval(timer); document.removeEventListener("visibilitychange", resume); };
  }, [organizerPin, umpirePin, onStatus]);
  return <>{offline && <p className="staff-updates-warning" role="status">Court alerts are reconnecting…</p>}{organizerPin && alerts.length > 0 && <aside className="staff-notifications" aria-label="Organizer court notifications"><header><span><Bell size={20} aria-hidden="true" />Court updates</span><button type="button" className="ghost" onClick={() => setAlerts([])}>Dismiss all</button></header><div className="staff-notification-list" aria-live="polite" aria-relevant="additions">{[...alerts].reverse().map(event => <article className={`staff-notification ${event.kind === "help_requested" ? "needs-help" : ""}`} key={event.id}><div><strong>{staffNotificationText(event)}</strong>{event.matchLabel && <p>{event.matchLabel}</p>}<small>{new Date(event.createdAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}</small>{event.kind === "help_requested" && <button type="button" className="secondary" disabled={busyCourt !== null} onClick={() => onClearHelp(event.court)}>{busyCourt === event.court ? "Updating…" : "Clear help request"}</button>}</div><button type="button" className="notification-dismiss" aria-label={`Dismiss ${staffNotificationText(event)}`} onClick={() => setAlerts(current => current.filter(item => item.id !== event.id))}><X size={20} aria-hidden="true" /></button></article>)}</div></aside>}</>;
}
