"use client";
import { useEffect, useState } from "react";
import { tournamentStartTime, type TournamentState } from "../../lib/tournament";

export function useCountdownSeconds(target: number | null) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (target === null) return;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (current < target) timer = setTimeout(tick, Math.min(1000, target - current));
    };
    let timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, [target]);
  return target === null || now === null ? null : Math.max(0, Math.ceil((target - now) / 1000));
}

export function CountdownClock({ remaining, label, className = "countdown-clock" }: { remaining: number | null; label: string; className?: string }) {
  const values = remaining === null ? ["—", "—", "—", "—"] : [Math.floor(remaining / 86400), Math.floor(remaining / 3600) % 24, Math.floor(remaining / 60) % 60, remaining % 60].map(value => String(value).padStart(2, "0"));
  const labels = ["Days", "Hours", "Minutes", "Seconds"];
  return <div className={className} role="timer" aria-label={label}>{values.map((value, index) => <div key={labels[index]}><strong>{value}</strong><span>{labels[index]}</span></div>)}</div>;
}

export function TournamentCountdown({ state }: { state: TournamentState }) {
  const start = tournamentStartTime(state);
  const scheduled = Number.isFinite(start);
  const remaining = useCountdownSeconds(scheduled ? start : null);
  return <section className="card tournament-countdown"><p className="eyebrow">See you on court</p><h2>{state.tournamentName}</h2>{state.venue?.trim() && <p className="event-venue">{state.venue}</p>}<p className="countdown-title">{!scheduled ? "Tournament schedule coming soon" : remaining === 0 ? "Starting soon" : "The first serve is getting closer"}</p>{scheduled && <><p>Scheduled start: {new Intl.DateTimeFormat("en-PH", { dateStyle: "full", timeStyle: "short", timeZone: "Asia/Manila" }).format(start)} · Philippine time</p><CountdownClock remaining={remaining} label="Time until scheduled tournament start" /></>}<p>{remaining === 0 ? "The committee is preparing the courts. Live scores and standings will appear here when the tournament begins." : "Live scores, matchups, and standings will appear here once the tournament goes live."}</p><small>This page updates automatically.</small></section>;
}
