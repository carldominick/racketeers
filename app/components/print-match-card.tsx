import { gameNumber } from "../../lib/game-day";
import { displayName, scoringRule, type Entry, type Match, type TournamentState } from "../../lib/tournament";

function PlayerSignatures({ entry, side, mode }: { entry?: Entry; side: "A" | "B"; mode: "singles" | "doubles" | "team" }) {
  const count = Math.max(mode === "singles" ? 1 : 2, entry?.players.length ?? 0);
  const label = mode === "singles" ? "PLAYER" : mode === "team" ? "TEAM" : "PAIR";
  return <div className="print-signature-group">
    <h3>{label} {side}</h3>
    <div className="print-player-signatures">{Array.from({ length: count }, (_, index) => <p key={index}>
      <span>{entry?.players[index]?.trim() || (count === 1 ? "Player" : `Player ${index + 1}`)}:</span>
      <span className="print-write-line" aria-label={`Player ${index + 1}, side ${side}, signature`} />
    </p>)}</div>
  </div>;
}

export function PrintMatchCard({ state, match }: { state: TournamentState; match: Match }) {
  const division = state.divisions.find(item => item.id === match.divisionId);
  const entryA = division?.entries.find(item => item.id === match.entryAId);
  const entryB = division?.entries.find(item => item.id === match.entryBId);
  const nameA = displayName(entryA), nameB = displayName(entryB);
  const longNames = nameA.length > 28 || nameB.length > 28;
  const sideLabel = division?.mode === "singles" ? "Player" : division?.mode === "team" ? "Team" : "Pair";
  const scoreNameA = longNames || !entryA ? `${sideLabel} A` : nameA;
  const scoreNameB = longNames || !entryB ? `${sideLabel} B` : nameB;
  const sets = match.format === "best_of_3_21" ? 3 : 1;
  const rule = scoringRule(match.format, match.scoring);
  const rules = `${sets === 3 ? "Best of 3" : "Single set"} · First to ${rule.target}${rule.mode === "first_to_target" ? "" : ` · Win by 2 · Cap ${rule.cap}`}`;
  return <section className={`print-match-card${longNames ? " print-match-card-long-names" : ""}`} aria-label={`Game ${gameNumber(state, match)} match card`}>
    <header className="print-match-header">
      <div><p>RACKETEERS · MATCH CARD</p><h1>{state.tournamentName}</h1></div>
      <strong>Game {gameNumber(state, match)}</strong>
    </header>
    <div className="print-match-meta">
      <p>{division?.name} · {match.label}</p>
      <p className="print-blank-field"><b>Court #:</b><span className="print-write-line" data-field="court" /></p>
      <p className="print-blank-field"><b>Umpire PIN:</b><span className="print-write-line" data-field="umpire-pin" /></p>
    </div>
    <div className="print-matchup"><h2>{nameA}</h2><span>vs</span><h2>{nameB}</h2></div>
    <div className="print-match-body">
      <section className="print-final-scores" aria-label="Final scores">
        <h2>FINAL SCORES</h2><p className="print-match-rules">{rules}</p>
        <table className="print-results-table"><thead><tr><th scope="col">Set</th><th scope="col">{scoreNameA}</th><th scope="col">{scoreNameB}</th></tr></thead>
          <tbody>{Array.from({ length: sets }, (_, index) => <tr key={index}><th scope="row">{index + 1}</th><td aria-label={`${nameA}, set ${index + 1} final score`} /><td aria-label={`${nameB}, set ${index + 1} final score`} /></tr>)}</tbody>
        </table>
        <p className="print-score-instruction">Final scores only.{sets > 1 && " Leave unused sets blank."}</p>
        <div className="print-winner"><b>Winner:</b><label><input type="checkbox" checked={false} readOnly tabIndex={-1} />{scoreNameA}</label><label><input type="checkbox" checked={false} readOnly tabIndex={-1} />{scoreNameB}</label></div>
      </section>
      <section className="print-confirmation" aria-label="Player signatures">
        <h2>PLAYER SIGNATURES</h2><p>Sign to confirm the final scores.</p>
        <PlayerSignatures entry={entryA} side="A" mode={division?.mode ?? "doubles"} />
        <PlayerSignatures entry={entryB} side="B" mode={division?.mode ?? "doubles"} />
      </section>
    </div>
    <footer className="print-match-footer"><p><b>Umpire:</b><span className="print-write-line" /></p><p><b>Checked by:</b><span className="print-write-line" /></p></footer>
  </section>;
}

export function PrintMatchCards({ state, matchId }: { state: TournamentState; matchId?: string }) {
  const matches = matchId ? state.matches.filter(match => match.id === matchId) : [...state.matches].sort((a, b) => (a.scheduledAt ?? "z").localeCompare(b.scheduledAt ?? "z"));
  return <div className="print-sheet print-match-cards">{matches.map(match => <PrintMatchCard key={match.id} state={state} match={match} />)}</div>;
}
