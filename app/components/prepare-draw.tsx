"use client";

import { useRef, useState, type ReactNode } from "react";
import { displayName, distributeEntriesToPools, matchResultSets, matchWinner, stageLabel, subBracketName, type Division, type Match } from "../../lib/tournament";
import { PrepareDetails } from "./prepare-details";

const rounds: Match["stage"][] = ["round_64", "round_32", "round_16", "quarterfinal", "semifinal", "gold", "bronze"];

type Props = {
  division: Division;
  matches: Match[];
  locked: boolean;
  onAssign: (id: string, side: "entryAId" | "entryBId", entryId: string) => void;
  onManual: (manual: boolean) => void;
  tools: ReactNode;
};

export function PrepareDraw({ division, matches, locked, onAssign, onManual, tools }: Props) {
  const [championship, setChampionship] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const matchTrigger = useRef<HTMLButtonElement | null>(null);
  const stageMatches = matches.filter(match => championship ? match.stage !== "regular" : match.stage === "regular");
  const selected = stageMatches.find(match => match.id === selectedId);
  const entries = new Map(division.entries.map(entry => [entry.id, entry]));
  const pools = distributeEntriesToPools(division);
  const canAssign = championship ? division.manualChampionshipMatchups : division.bracketFormat === "custom";

  const matchButton = (match: Match) => {
    const sets = matchResultSets(match);
    const winner = matchWinner(match);
    return <button type="button" className="draw-match prepare-match" key={match.id} aria-pressed={selectedId === match.id}
      onClick={event => { matchTrigger.current = event.currentTarget; setSelectedId(match.id); }}>
      <small>{match.label}{match.forfeit ? " · Forfeit" : ""}</small>
      <span className={winner && winner === match.entryAId ? "winner" : ""}>{displayName(entries.get(match.entryAId ?? ""))}<b>{sets.map(set => set.a).join(" · ")}</b></span>
      <span className={winner && winner === match.entryBId ? "winner" : ""}>{displayName(entries.get(match.entryBId ?? ""))}<b>{sets.map(set => set.b).join(" · ")}</b></span>
    </button>;
  };

  return <div className="stack">
    <div className="prepare-actions">
      <div className="prepare-segments" aria-label="Draw stage">
        <button type="button" aria-pressed={!championship} onClick={() => { setChampionship(false); setSelectedId(""); }}>Group stage</button>
        <button type="button" aria-pressed={championship} onClick={() => { setChampionship(true); setSelectedId(""); }}>Championship</button>
      </div>
      {tools}
    </div>
    <div className="prepare-workspace">
      <section className="card prepare-draw-board">
        <h2>{division.name} {championship ? "championship bracket" : "pools and matchups"}</h2>
        {!championship && <div className="sub-bracket-rosters">{pools.map((pool, index) => <article key={index}>
          <div><h3>{subBracketName(index)}</h3><span>Top {division.qualifiersPerSubBracket} advance</span></div>
          {pool.map((entry, position) => <p key={entry.id}><b>{position + 1}</b><span>{displayName(entry)}</span>
            <em>{entry.levelOverride || entry.playerLevels?.find(Boolean) || "Unrated"}</em></p>)}
        </article>)}</div>}
        {championship && <label className="manual-toggle"><input type="checkbox" checked={Boolean(division.manualChampionshipMatchups)}
          disabled={locked} onChange={event => onManual(event.target.checked)} /><span>Manually choose championship matchups</span></label>}
        {stageMatches.length === 0 ? <p>No {championship ? "championship" : "group-stage"} matchups yet.</p>
          : championship ? <div className="bracket-scroll"><div className="bracket-board">
            {rounds.filter(stage => stageMatches.some(match => match.stage === stage)).map(stage =>
              <div className="bracket-column" key={stage}><h3>{stageLabel(stage)}</h3>
                <div className="bracket-column-matches">{stageMatches.filter(match => match.stage === stage).map(matchButton)}</div>
              </div>)}
          </div></div> : <div className="match-mini-grid">{stageMatches.map(matchButton)}</div>}
      </section>
      {selected && <PrepareDetails title={selected.label} context={division.name} onClose={() => {
        setSelectedId("");
        requestAnimationFrame(() => matchTrigger.current?.focus());
      }}>
        <div className="prepare-match-detail">
          <p>{selected.format.replaceAll("_", " ")}{championship && !canAssign ? " · Seeded from standings and earlier rounds" : ""}</p>
          {(["entryAId", "entryBId"] as const).map((side, index) => <label key={side}>Side {index === 0 ? "A" : "B"}
            {canAssign ? <select value={selected[side] ?? ""} disabled={locked}
              onChange={event => onAssign(selected.id, side, event.target.value)}>
              <option value="">TBD / Auto seed</option>
              {division.entries.map(entry => <option value={entry.id} key={entry.id}>{displayName(entry)}</option>)}
            </select> : <strong>{displayName(entries.get(selected[side] ?? ""))}</strong>}
          </label>)}
        </div>
      </PrepareDetails>}
    </div>
  </div>;
}
