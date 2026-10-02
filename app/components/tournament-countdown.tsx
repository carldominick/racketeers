"use client";
import { useEffect, useState } from "react";
import { tournamentStartTime, type TournamentState } from "../../lib/tournament";

export function TournamentCountdown({ state }: { state: TournamentState }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const initial = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, []);
  const start = tournamentStartTime(state);
  const scheduled = Number.isFinite(start);
  const remaining = scheduled && now !== null ? Math.max(0, Math.ceil((start - now) / 1000)) : null;
  const values = remaining === null ? ["—", "—", "—", "—"] : [Math.floor(remaining / 86400), Math.floor(remaining / 3600) % 24, Math.floor(remaining / 60) % 60, remaining % 60].map(value => String(value).padStart(2, "0"));
  const labels = ["Days", "Hours", "Minutes", "Seconds"];
  return <section className="card tournament-countdown"><p className="eyebrow">See you on court</p><h2>{state.tournamentName}</h2>{state.venue?.trim() && <p className="event-venue">{state.venue}</p>}<p className="countdown-title">{!scheduled ? "Tournament schedule coming soon" : remaining === 0 ? "Starting soon" : "The first serve is getting closer"}</p>{scheduled && <><p>Scheduled start: {new Intl.DateTimeFormat("en-PH", { dateStyle: "full", timeStyle: "short", timeZone: "Asia/Manila" }).format(start)} · Philippine time</p><div className="countdown-clock" role="timer" aria-label="Time until scheduled tournament start">{values.map((value, index) => <div key={labels[index]}><strong>{value}</strong><span>{labels[index]}</span></div>)}</div></>}<p>{remaining === 0 ? "The committee is preparing the courts. Live scores and standings will appear here when the tournament begins." : "Live scores, matchups, and standings will appear here once the tournament goes live."}</p><small>This page updates automatically.</small></section>;
}
