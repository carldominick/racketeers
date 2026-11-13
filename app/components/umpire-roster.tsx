"use client";

import { useEffect, useState } from "react";
import { courtOccupant, gameNumber, matchupText } from "../../lib/game-day";
import { matchScoreText, type Match, type TournamentState } from "../../lib/tournament";
import type { UmpireSummary } from "../../lib/umpire-types";
import { workflowText, type WorkflowInput } from "../../lib/umpire-workflow";
import { ScoreCorrection, umpireRequest } from "./umpire-dashboard";
import "./umpire-workflow.css";

type Props = {
  state: TournamentState; roster: UmpireSummary[]; busy: boolean; demo: boolean;
  personalAccessConfigured: boolean | null;
  onAction: (body: WorkflowInput) => Promise<{ pin?: string }>;
};

export function UmpireRoster({ state, roster, busy, demo, personalAccessConfigured, onAction }: Props) {
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("active");
  const [issued, setIssued] = useState<{ name: string; pin: string }>();
  const [error, setError] = useState("");
  async function save(body: WorkflowInput, recipient?: string) {
    setError("");
    setIssued(undefined);
    try {
      const result = await onAction(body);
      if (result.pin && recipient) setIssued({ name: recipient, pin: result.pin });
      if (body.action === "add") setName("");
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to save."); }
  }
  const matchesFilter = (member: UmpireSummary) => member.name.toLowerCase().includes(search.trim().toLowerCase()) && (filter === "all" || filter === "active" && !member.inactive || filter === "inactive" && member.inactive || filter === "on-duty" && !member.inactive && member.onDuty);
  return <div className="stack umpire-workflow">
    <section className="card"><h2>Umpire roster</h2>
      {!state.managedUmpires ? <>
        <p>Give each umpire a personal PIN and assign them to a court. Turning this on retires the shared login and removes game PINs.</p>
        {personalAccessConfigured !== true && <p role="status">{personalAccessConfigured === false ? "Personal access needs a one-time setup in Cloudflare. Ask the site administrator to finish setup. Shared login and game PINs still work." : "Waiting to verify that personal umpire access is ready."}</p>}
        <button className="primary" disabled={busy || personalAccessConfigured !== true} onClick={() => void save({ action: "enable" })}>Enable personal umpire access</button>
      </> : <>
        <form className="umpire-workflow-form" onSubmit={event => { event.preventDefault(); void save({ action: "add", name }, name.trim()); }}>
          <label>Umpire name<input required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label>
          <button className="primary" disabled={busy || name.trim().length < 2}>Add umpire and generate PIN</button>
        </form>
        {issued && <section className="card" aria-label="New umpire PIN"><strong>{demo ? "Demo PIN" : "New personal PIN"} for {issued.name}</strong><p className="umpire-issued-pin">{issued.pin}</p><p>Give this PIN privately to the umpire. It appears here once.</p><button className="ghost" onClick={() => setIssued(undefined)}>Hide PIN</button></section>}
        <div className="umpire-roster-filters"><label>Search umpires<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label><label>Roster filter<select value={filter} onChange={event => setFilter(event.target.value)}><option value="active">Active</option><option value="on-duty">On duty</option><option value="inactive">Inactive</option><option value="all">All</option></select></label></div>
        <ul className="umpire-roster-list">{roster.filter(matchesFilter).map(member => <li key={member.id}>
          <strong>{member.name}</strong><span>{member.inactive ? "Inactive" : `${member.court ? `Court ${member.court}` : "Unassigned"} · ${member.onDuty ? "On duty" : "Off duty"} · ${member.connected ? "Connected" : "Disconnected"}`}</span>
          <details><summary>Manage {member.name}</summary><form className="umpire-workflow-form" key={member.name} onSubmit={event => { event.preventDefault(); void save({ action: "rename", umpireId: member.id, name: String(new FormData(event.currentTarget).get("name")) }); }}><label>Name<input name="name" defaultValue={member.name} required maxLength={100} /></label><button className="secondary" disabled={busy}>Save name</button></form>
            <div className="action-row">{!member.inactive && <><button className="secondary" disabled={busy} onClick={() => void save({ action: "issuePin", umpireId: member.id }, member.name)}>{member.credential ? "Regenerate PIN" : "Assign to tournament & issue PIN"}</button>{member.credential && <button className="ghost" disabled={busy} onClick={() => void save({ action: "revokePin", umpireId: member.id })}>Revoke PIN</button>}</>}
              <button className="ghost" disabled={busy} onClick={() => void save({ action: "deactivate", umpireId: member.id, inactive: !member.inactive })}>{member.inactive ? "Reactivate" : "Deactivate"}</button></div>
          </details>
        </li>)}</ul>
        {roster.filter(matchesFilter).length === 0 && <p>No umpires match this view.</p>}
        {["setup", "registration"].includes(state.status) && !state.matches.some(match => match.dispatchedAt || match.umpireWorkflow && !["completed", "finalized_by_ruling", "voided"].includes(match.umpireWorkflow.phase)) && <details><summary>Reuse the roster for a new tournament</summary><p>This revokes current umpire PINs and clears court assignments. Roster names stay available.</p><button className="secondary" disabled={busy} onClick={() => { if (window.confirm("Start a new umpire credential scope?")) void save({ action: "newTournament" }); }}>Start new credential scope</button></details>}
      </>}
      {error && <p role="alert">{error}</p>}
    </section>
    {state.managedUmpires && <section className="card"><h2>Court assignments</h2><div className="umpire-roster-courts">{Array.from({ length: state.courts }, (_, index) => {
      const court = index + 1;
      const match = courtOccupant(state, court);
      const current = roster.find(member => member.court === court);
      return <form className="umpire-workflow-form card" key={`${court}:${current?.id ?? ""}:${match?.id ?? ""}`} onSubmit={event => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        void save({ action: "assignCourt", court, umpireId: String(values.get("umpire") ?? ""), reason: String(values.get("reason") ?? "") });
      }}><h3>Court {court}</h3><p>{match ? `Game ${gameNumber(state, match)} · ${match.umpireWorkflow ? workflowText[match.umpireWorkflow.phase] : "In use"}` : "Idle"}</p>
        <label>Assigned umpire<select name="umpire" defaultValue={current?.id ?? ""}><option value="">Unassigned</option>{roster.filter(member => !member.inactive).map(member => <option key={member.id} value={member.id}>{member.name}{member.onDuty && member.connected ? " · On duty" : ""}</option>)}</select></label>
        {match && <label>Handoff reason<input name="reason" required maxLength={300} /></label>}
        <button className="secondary" disabled={busy}>{match ? "Hand off current game" : "Save court assignment"}</button>
      </form>;
    })}</div></section>}
  </div>;
}

function DisputeControls({ match, busy, onAction }: { match: Match; busy: boolean; onAction: (body: WorkflowInput) => void }) {
  const [reason, setReason] = useState("");
  const [clear, setClear] = useState(false);
  const flow = match.umpireWorkflow!;
  return <div className="umpire-workflow-form">
    <label>Organizer explanation<input value={reason} onChange={event => setReason(event.target.value)} maxLength={300} /></label>
    {!flow.releasedAt && <label><input type="checkbox" checked={clear} onChange={event => setClear(event.target.checked)} /> Court is clear</label>}
    {flow.phase === "incorrect_players" ? <div className="action-row">
      <button className="primary" disabled={busy || !reason.trim()} onClick={() => onAction({ action: "resolvePlayers", reason })}>Resolve player report</button>
      <button className="secondary" disabled={busy || !reason.trim() || !clear} onClick={() => onAction({ action: "requeuePlayers", reason, clear })}>Release court and return game to queue</button>
    </div> : <>
      {!flow.releasedAt && <div className="action-row"><button className="secondary" disabled={busy || !reason.trim()} onClick={() => onAction({ action: "returnDispute", reason })}>Return to umpire</button><button className="secondary" disabled={busy || !clear} onClick={() => onAction({ action: "releaseDispute", clear })}>Release court</button></div>}
      <div className="action-row"><button className="ghost" disabled={busy || !reason.trim() || !(flow.releasedAt || clear)} onClick={() => onAction({ action: "rule", outcome: "voided", reason, clear })}>Void result</button>
        <button className="ghost" disabled={busy || !reason.trim() || !(flow.releasedAt || clear)} onClick={() => onAction({ action: "rule", outcome: "replay", reason, clear })}>Require replay</button></div>
      <details><summary>Record an official score ruling</summary><ScoreCorrection match={match} busy={busy} button="Finalize by ruling" onSave={(sets, reason, clear) => onAction({ action: "rule", outcome: "finalized", sets, reason, clear })} /></details>
    </>}
  </div>;
}

export function OrganizerUmpireReviews({ state, roster, busy, onAction }: Pick<Props, "state" | "roster" | "busy" | "onAction">) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const relevant = state.matches.filter(match => match.umpireWorkflow && ["incorrect_players", "awaiting_confirmation", "disputed", "escalated", "finalized_by_ruling", "voided"].includes(match.umpireWorkflow.phase) || match.umpireHistory?.length);
  return <section className="card umpire-workflow"><h3>Umpire reports and rulings</h3>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {relevant.length === 0 && <p>No reports or results awaiting confirmation.</p>}
    {relevant.map(match => {
      const flow = match.umpireWorkflow;
      const name = (id?: string) => roster.find(member => member.id === id)?.name ?? id;
      return <details key={match.id}><summary>Game {gameNumber(state, match)} · {flow ? workflowText[flow.phase] : "Replay history"}</summary>
        <p>{matchupText(state, match)} · {matchScoreText(match)}</p>
        {flow && <><p>{name(flow.umpireId)} · Court {flow.court}{flow.releasedAt ? " released" : ""}</p>
          {flow.playerIssue && <p>{flow.playerIssue.note}</p>}
          {flow.dispute && <p>Team {flow.dispute.side.toUpperCase()} · {flow.dispute.reason}. {flow.dispute.notes}</p>}
          {Boolean(flow.setHistory?.length) && <details><summary>Set history</summary>{flow.setHistory?.map((item, index) => <p key={index}>{name(item.umpireId)} · Set {item.index + 1} {item.reopened ? "reopened" : "completed"} at {item.score.a}–{item.score.b} · {new Date(item.at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</p>)}</details>}
          {flow.scoreHistory?.map((item, index) => <p key={index}>{new Date(item.at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })} · {name(item.actor)} · {item.reason} · {matchScoreText({ ...match, sets: item.before })} → {matchScoreText({ ...match, sets: item.after })}</p>)}
          {flow.handoffs?.map((item, index) => <p key={index}>Handoff from {name(item.from)} to {name(item.to)} · {item.reason}</p>)}
          {flow.ruling && <p>{flow.ruling.actor} · {flow.ruling.reason}</p>}
          {["incorrect_players", "escalated"].includes(flow.phase) && <DisputeControls key={flow.version} match={match} busy={busy} onAction={body => {
            setError(""); setNotice("");
            void onAction({ ...body, matchId: match.id, version: flow.version }).then(() => setNotice("Game updated."), error => setError(error.message));
          }} />}
        </>}
        {match.umpireHistory?.map((item, index) => <p key={index}>{item.ruling ? `Previous result · ${item.dispute?.reason} · ${item.ruling.actor} ordered a replay · ${item.ruling.reason}` : item.playerIssue?.note}</p>)}
      </details>;
    })}
  </section>;
}

export function useUmpireRoster(pin: string, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<{ pin: string; roster: UmpireSummary[]; personalAccessConfigured: boolean | null }>();
  useEffect(() => {
    if (!enabled || !pin) return;
    let current = true;
    const refresh = async () => {
      try {
        const data = await umpireRequest(undefined, pin);
        if (current) setSnapshot({ pin, roster: data.roster ?? [], personalAccessConfigured: data.personalAccessConfigured ?? null });
      } catch { if (current) setSnapshot(undefined); }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => { current = false; clearInterval(timer); };
  }, [enabled, pin]);
  return enabled && snapshot?.pin === pin ? snapshot : { roster: [], personalAccessConfigured: null };
}
