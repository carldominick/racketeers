"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "@phosphor-icons/react/dist/csr/Bell";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { DotsThree } from "@phosphor-icons/react/dist/csr/DotsThree";
import { apiFetch } from "../../lib/client-request";
import { adjustMatchScore, completeMatchSet, displayName, matchScoreText, matchWinner, scoringRule, uncompleteMatchSet, type Division, type Match, type SetScore, type TournamentState } from "../../lib/tournament";
import { workflowText, type WorkflowInput } from "../../lib/umpire-workflow";
import type { UmpireSummary } from "../../lib/umpire-types";
import { UmpireScorecard } from "./umpire-scorecard";
import { ASSIGNMENT_CHIMES, useCourtChimes } from "./use-court-chimes";
import "./umpire-workflow.css";

type Snapshot = { authenticated: boolean; name: string; court?: number; onDuty: boolean; tournamentName: string; phase: TournamentState["status"]; match?: Match; gameNumber?: number; division?: Division; help: boolean };

export async function umpireRequest(body?: WorkflowInput, organizerPin?: string, demoSeat?: string) {
  const response = await apiFetch("/api/umpires", {
    method: body ? "POST" : "GET", cache: "no-store",
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(organizerPin ? { "x-organizer-pin": organizerPin } : {}), ...(demoSeat ? { "x-demo-umpire-seat": demoSeat } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json() as Partial<Snapshot> & { error?: string; roster?: UmpireSummary[]; personalAccessConfigured?: boolean; pin?: string };
  if (!response.ok) throw new Error(data.error || "Unable to connect to umpire access.");
  return data;
}

export function ScoreCorrection({ match, busy, onSave, button = "Save correction" }: { match: Match; busy: boolean; onSave: (sets: SetScore[], reason: string, clear: boolean) => void; button?: string }) {
  const count = match.format === "best_of_3_21" ? 3 : 1;
  const [sets, setSets] = useState(() => Array.from({ length: count }, (_, i) => match.sets[i] ?? { a: 0, b: 0, complete: false }));
  const [reason, setReason] = useState("");
  const [clear, setClear] = useState(false);
  const ruling = button === "Finalize by ruling";
  return <form className="umpire-workflow-form" onSubmit={event => { event.preventDefault(); onSave(sets, reason, clear); }}>
    {sets.map((set, index) => <fieldset key={index}><legend>Set {index + 1}</legend>
      {(["a", "b"] as const).map(side => <label key={side}>Team {side.toUpperCase()}<input type="number" inputMode="numeric" min={0} max={199} required value={set[side]} onChange={event => { const value = Number(event.target.value); setSets(current => current.map((item, i) => i === index ? { ...item, [side]: value } : item)); }} /></label>)}
      <label><input type="checkbox" checked={set.complete} onChange={event => { const complete = event.target.checked; setSets(current => current.map((item, i) => i === index ? { ...item, complete } : item)); }} /> Set complete</label>
    </fieldset>)}
    <label>Reason<input required maxLength={300} value={reason} onChange={event => setReason(event.target.value)} /></label>
    {ruling && !match.umpireWorkflow?.releasedAt && <label><input type="checkbox" checked={clear} onChange={event => setClear(event.target.checked)} /> Court is clear</label>}
    <button className="primary" disabled={busy || !reason.trim() || ruling && !match.umpireWorkflow?.releasedAt && !clear}>{button}</button>
  </form>;
}

function ConfirmResult({ busy, onAction }: { busy: boolean; onAction: (action: WorkflowInput) => void }) {
  const [a, setA] = useState(false);
  const [b, setB] = useState(false);
  const [clear, setClear] = useState(false);
  const [side, setSide] = useState("a");
  const [reason, setReason] = useState("Incorrect recorded score");
  const [note, setNote] = useState("");
  return <div className="stack">
    <fieldset className="umpire-workflow-form" disabled={busy}><legend>Confirm the final score with both teams</legend>
      <label><input type="checkbox" checked={a} onChange={event => setA(event.target.checked)} /> Team A has confirmed the final score</label>
      <label><input type="checkbox" checked={b} onChange={event => setB(event.target.checked)} /> Team B has confirmed the final score</label>
      <label><input type="checkbox" checked={clear} onChange={event => setClear(event.target.checked)} /> Players have cleared the court</label>
      <button type="button" className="primary" disabled={!a || !b || !clear} onClick={() => onAction({ action: "submit", a, b, clear })}>Submit final score</button>
    </fieldset>
    <details><summary>Report score dispute</summary><form className="umpire-workflow-form" onSubmit={event => { event.preventDefault(); onAction({ action: "reportDispute", side, reason, note }); }}>
      <label>Disputing team<select value={side} onChange={event => setSide(event.target.value)}><option value="a">Team A</option><option value="b">Team B</option><option value="both">Both teams</option></select></label>
      <label>Reason<select value={reason} onChange={event => setReason(event.target.value)}>{["Incorrect recorded score", "Disagreement over a point", "Incorrect outcome", "Other disagreement"].map(item => <option key={item}>{item}</option>)}</select></label>
      <label>Notes (optional)<textarea maxLength={600} value={note} onChange={event => setNote(event.target.value)} /></label>
      <button className="secondary" disabled={busy}>Report score dispute</button>
    </form></details>
  </div>;
}

export function UmpireDashboard({ onPrint, demoSeat, onFocusChange, onScorePending }: { onPrint?: (match: Match, division?: Division, gameNumber?: number) => void; demoSeat?: string; onFocusChange?: (focused: boolean) => void; onScorePending?: (pending: boolean) => void }) {
  const [data, setData] = useState<Snapshot>();
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");
  const [connection, setConnection] = useState<"connecting" | "online" | "offline">("connecting");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [focused, setFocused] = useState(true);
  const { status: soundStatus, toggle: toggleSound, play } = useCourtChimes(ASSIGNMENT_CHIMES);
  const lastAssignment = useRef<string | null>(null);
  const saving = useRef(false);
  const pending = useRef<{ match: Match; operation: string } | null>(null);
  const failed = useRef<typeof pending.current>(null);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sync, setSync] = useState<"saved" | "saving" | "offline">("saved");
  const current = useRef<Snapshot | undefined>(undefined);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const token = ++sequence.current;
    try {
      const snapshot = await umpireRequest(undefined, undefined, demoSeat) as Snapshot;
      if (token === sequence.current) setConnection("online");
      if (token !== sequence.current || saving.current || inFlight.current || pending.current) return;
      current.current = snapshot;
      setData(snapshot);
    } catch {
      if (token === sequence.current) setConnection("offline");
    }
  }, [demoSeat]);
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const poll = setInterval(() => void refresh(), 2000);
    window.addEventListener("online", refresh);
    return () => { clearTimeout(first); clearInterval(poll); window.removeEventListener("online", refresh); };
  }, [refresh]);
  useEffect(() => {
    if (sync === "saved") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [sync]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const flow = data?.match?.umpireWorkflow;
  useEffect(() => {
    onFocusChange?.(focused && flow?.phase === "playing");
    return () => onFocusChange?.(false);
  }, [focused, flow?.phase, onFocusChange]);
  useEffect(() => {
    onScorePending?.(sync !== "saved");
    return () => onScorePending?.(false);
  }, [sync, onScorePending]);
  const delivery = flow?.phase === "assigned" ? `${flow.assignedAt}:${data?.match?.id}` : "";
  const signedIn = data?.authenticated === true;
  useEffect(() => {
    const previous = lastAssignment.current;
    lastAssignment.current = signedIn ? delivery : null;
    if (previous !== null && delivery && previous !== delivery) play("umpire-assignment");
  }, [delivery, play, signedIn]);

  async function action(body: WorkflowInput) {
    if (saving.current || pending.current || inFlight.current) return;
    saving.current = true;
    ++sequence.current;
    setBusy(true);
    setMessage("");
    const match = current.current?.match;
    try {
      await umpireRequest({ matchId: match?.id, version: match?.umpireWorkflow?.version, ...body }, undefined, demoSeat);
      setPin("");
      setNote("");
      if (body.action === "submit") setMessage("Final score submitted. Court released.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save."); }
    finally { saving.current = false; setBusy(false); await refresh(); }
  }

  async function flush() {
    const queued = failed.current ?? pending.current;
    const match = current.current?.match;
    if (!queued || !match || inFlight.current) return;
    inFlight.current = true;
    ++sequence.current;
    setMessage("");
    setSync("saving");
    try {
      const result = await umpireRequest({ action: "score", matchId: match.id, version: match.umpireWorkflow?.version, operation: queued.operation, sets: queued.match.sets }, undefined, demoSeat);
      const snapshot = { ...current.current!, match: result.match as Match };
      current.current = snapshot;
      failed.current = null;
      if (pending.current === queued) {
        pending.current = null;
        setData(snapshot);
        setSync("saved");
      }
    } catch (error) {
      // A retry uses the same operation and base version if the reply was lost.
      setSync("offline");
      failed.current = queued;
      setMessage(error instanceof Error ? error.message : "Score could not be saved.");
      inFlight.current = false;
      return;
    }
    inFlight.current = false;
    if (pending.current) void flush();
  }

  function score(change: (match: Match) => Match) {
    const match = pending.current?.match ?? current.current?.match;
    if (!match || saving.current || failed.current) return;
    const next = change(match);
    if (next === match) return;
    pending.current = { match: next, operation: crypto.randomUUID() };
    setData(snapshot => snapshot ? { ...snapshot, match: next } : snapshot);
    setSync("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 350);
  }

  if (!data?.authenticated) return <section className="card gate">
    <h2>Racketeers umpire sign-in</h2>
    <form onSubmit={event => { event.preventDefault(); void action({ action: "login", pin }); }}>
      <label>Personal umpire PIN<input type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{6}" required maxLength={6} value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, ""))} /></label>
      <button className="primary" disabled={busy || pin.length !== 6}>Sign in</button>
    </form>{message && <p role="status">{message}</p>}{connection === "offline" && <p role="status">Unable to connect. Check your connection.</p>}
  </section>;

  const match = data.match;
  const entry = (id?: string | null) => data.division?.entries.find(item => item.id === id);
  const scoreState = { divisions: data.division ? [data.division] : [] } as unknown as TournamentState;
  const notices = <>
    {message && <p role="status">{message}</p>}
    {soundStatus === "unavailable" && <p role="status">Sound is unavailable. Assignments still appear on screen.</p>}
    {connection === "offline" && <p role="status">Reconnecting. Court and match details may be out of date.</p>}
    {sync === "offline" && <button className="ghost" onClick={() => { if (!window.confirm("Discard unsaved score changes and reload the saved score?")) return; pending.current = null; failed.current = null; setSync("saved"); setMessage("Unsaved changes discarded."); void refresh(); }}>Reload saved score</button>}
  </>;
  if (!match || flow?.phase === "assigned" || flow?.phase === "seen" || flow?.phase === "incorrect_players") {
    const newAssignment = flow?.phase === "assigned";
    const reportPending = flow?.phase === "incorrect_players";
    const rule = match && scoringRule(match.format, match.scoring);
    let heading = "Waiting for next game";
    let guidance = "Your next assignment will appear here.";
    if (data.phase === "completed") {
      heading = "Tournament complete";
      guidance = "";
    } else if (!data.court) {
      heading = "Waiting for court assignment";
      guidance = "The organizer will assign you a court.";
    } else if (!data.onDuty) {
      heading = "Ready to start duty?";
      guidance = "Start duty to receive games for your court.";
    } else if (data.phase !== "live") {
      heading = "Waiting for the tournament to start";
      guidance = "Your court can receive games once the tournament goes live.";
    }
    return <section className="umpire-workflow umpire-waiting" aria-label="Umpire console">
      <header className="umpire-console-header">
        <div className="umpire-waiting-brand">
          <span className="mark" aria-hidden="true">R</span>
          <div><h2>{data.court ? `Court ${data.court}` : "Umpire console"}</h2><p>Racketeers Badminton Club</p></div>
        </div>
        <details className="umpire-more" onKeyDown={event => {
          if (event.key === "Escape" && event.currentTarget.open) {
            event.currentTarget.open = false;
            event.currentTarget.querySelector("summary")?.focus();
          }
        }} onClick={event => {
          if (event.target instanceof Element && event.target.closest("button")) {
            event.currentTarget.open = false;
            event.currentTarget.querySelector("summary")?.focus();
          }
        }}>
          <summary><DotsThree size={24} weight="bold" aria-hidden="true" />More</summary>
          <div className="umpire-more-actions">
            <button type="button" disabled={busy || Boolean(match && data.onDuty)} onClick={() => void action({ action: "duty", onDuty: !data.onDuty })}>{data.onDuty ? "End duty" : "Start duty"}</button>
            <button type="button" disabled={busy || Boolean(match)} onClick={() => void action({ action: "logout" })}>Sign out</button>
          </div>
        </details>
      </header>
      <div className="umpire-waiting-status" role="status">
        <span><i className={data.onDuty ? "active" : ""} aria-hidden="true" />{data.onDuty ? "On duty" : "Off duty"}</span>
        <span><i className={connection === "online" ? "active" : ""} aria-hidden="true" />{connection === "online" ? "Connected" : connection === "offline" ? "Reconnecting" : "Connecting"}</span>
      </div>
      {match && rule ? <section className="umpire-assignment" aria-label="Current game" key={match.id}>
        <header role="status">
          <p className="umpire-assignment-status">
            {newAssignment ? <Bell size={23} aria-hidden="true" /> : !reportPending && <Check size={23} weight="bold" aria-hidden="true" />}
            {reportPending ? "Player report sent" : newAssignment ? "New assignment" : "Assignment acknowledged"}
          </p>
          <h3>Game {data.gameNumber}</h3>
          <p className="umpire-assignment-meta">{[data.division?.name, match.label].filter(Boolean).join(" · ")}</p>
        </header>
        <dl className="umpire-assignment-teams">
          {([{ label: "Team A", id: match.entryAId }, { label: "Team B", id: match.entryBId }]).map(side => {
            const team = entry(side.id);
            const players = team?.players.filter(name => name.trim()) ?? [];
            return <div key={side.label}>
              <dt>{side.label}</dt>
              <dd>{players.length ? players.map((name, index) => <span key={index}>{name}</span>) : displayName(team)}</dd>
            </div>;
          })}
        </dl>
        <p className="umpire-assignment-meta">
          {match.format === "best_of_3_21" ? "Best of three" : "Single set"} · First to {rule.target}
          {rule.mode !== "first_to_target" && ` · Win by 2 · Cap ${rule.cap}`}
        </p>
        {reportPending ? <p role="status">Waiting for the organizer to resolve the player report.</p> : <>
          {!newAssignment && <p className="umpire-assignment-guidance">Check that these players are on court.</p>}
          <button type="button" className="primary umpire-assignment-action" aria-disabled={busy} onClick={() => {
            if (!busy) void action({ action: newAssignment ? "acknowledge" : "start" });
          }}>{newAssignment ? "Acknowledge assignment" : "Confirm players & start game"}</button>
          {newAssignment && <p className="umpire-assignment-guidance">Let the organizer know you’ve seen this game.</p>}
          <details className="umpire-assignment-report">
            <summary>Report incorrect players</summary>
            <form className="umpire-workflow-form" onSubmit={event => {
              event.preventDefault();
              void action({ action: "incorrectPlayers", note });
            }}>
              <label>Who is incorrect?<textarea required maxLength={600} value={note} onChange={event => setNote(event.target.value)} /></label>
              <button type="submit" className="secondary" disabled={busy || !note.trim()}>Send report</button>
            </form>
          </details>
        </>}
        {notices}
      </section> : <div className="umpire-waiting-main">
        <div className="umpire-waiting-icon"><Bell size={34} aria-hidden="true" /></div>
        <div role="status"><h3>{heading}</h3>{guidance && <p>{guidance}</p>}</div>
        <p className="umpire-waiting-identity">{data.name} · {data.tournamentName}</p>
        {!data.onDuty && data.court && data.phase !== "completed" && <button type="button" className="primary" disabled={busy} onClick={() => void action({ action: "duty", onDuty: true })}>Start duty</button>}
        {notices}
      </div>}
      <button type="button" className="umpire-waiting-alerts" aria-pressed={soundStatus === "on"} onClick={() => void toggleSound()}>
        <Bell size={22} aria-hidden="true" /><span>Match alerts</span>
        <strong>{soundStatus === "on" ? "On" : soundStatus === "loading" ? "Loading…" : "Off"}</strong>
      </button>
    </section>;
  }
  return <div className="stack umpire-workflow">
    <section className={`card umpire-dashboard-status${focused && flow?.phase === "playing" ? " umpire-dashboard-focused" : ""}`}><h2>{data.name}</h2><p>{data.tournamentName} · {data.court ? `Court ${data.court}` : "No court assigned"} · {data.onDuty ? "On duty" : "Off duty"}</p>
      <div className="action-row"><button className="secondary" disabled={busy || Boolean(match && data.onDuty)} onClick={() => void action({ action: "duty", onDuty: !data.onDuty })}>{data.onDuty ? "End duty" : "Start duty"}</button>
        <button type="button" className="ghost" aria-pressed={soundStatus === "on"} onClick={() => void toggleSound()}>{soundStatus === "on" ? "Disable match alerts" : soundStatus === "loading" ? "Cancel loading match alerts" : "Enable match alerts"}</button>
        <button className="ghost" disabled={busy || Boolean(match)} onClick={() => void action({ action: "logout" })}>Sign out</button></div>
      {notices}
    </section>
    {match && flow && flow.phase !== "playing" && <section className="card" aria-label="Current game">
      <h2>Game {data.gameNumber} · {workflowText[flow.phase]}</h2>
      <p>{data.division?.name} · {match.label} · {match.format === "best_of_3_21" ? "Best of three" : "Single set"} · First to {scoringRule(match.format, match.scoring).target}</p>
      <p><strong>Team A:</strong> {displayName(entry(match.entryAId))}</p><p><strong>Team B:</strong> {displayName(entry(match.entryBId))}</p>
      {["awaiting_confirmation", "disputed", "escalated"].includes(flow.phase) && <><p>Recorded score <strong>{matchScoreText(match)}</strong></p><p>Winner <strong>{displayName(entry(matchWinner(match)))}</strong></p></>}
      {flow.phase === "awaiting_confirmation" && <ConfirmResult key={flow.version} busy={busy} onAction={body => void action(body)} />}
      {flow.phase === "disputed" && <><p>{flow.dispute?.reason}. {flow.dispute?.notes}</p><details><summary>Correct recorded score</summary><ScoreCorrection match={match} busy={busy} onSave={(sets, reason) => void action({ action: "correct", sets, reason })} /></details><button className="secondary" disabled={busy} onClick={() => void action({ action: "escalate" })}>Escalate to organizer</button></>}
      {flow.phase === "escalated" && <p>Waiting for an organizer ruling or court release.</p>}
      {Boolean(flow.scoreHistory?.length || flow.setHistory?.length) && <details><summary>Score history</summary>
        {flow.setHistory?.map((item, index) => <p key={index}>Set {item.index + 1} {item.reopened ? "reopened" : "completed"} at {item.score.a}–{item.score.b}</p>)}
        {flow.scoreHistory?.map((item, index) => <p key={index}>{item.reason} · {matchScoreText({ ...match, sets: item.before })} → {matchScoreText({ ...match, sets: item.after })}</p>)}
      </details>}
    </section>}
    {match && flow?.phase === "playing" && <UmpireScorecard key={match.id} match={match} state={scoreState} sync={sync} focused={focused}
      helpRequested={data.help} helpBusy={busy} helpMessage="" onToggleHelp={() => void action({ action: "help", clear: data.help })}
      onToggleFocus={() => setFocused(value => !value)} onPrint={onPrint ? () => onPrint(match, data.division, data.gameNumber) : undefined} onRetry={() => void flush()}
      onScoreStep={(index, side, delta) => score(item => adjustMatchScore(item, index, side, delta))}
      onCompleteSet={index => score(item => completeMatchSet(item, index))} onUnlockSet={index => score(item => uncompleteMatchSet(item, index))} />}
  </div>;
}
