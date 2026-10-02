import { displayName, gameDaySettings, isMatchUsingCourt, isSetWon, matchWinner, scoringRule, subBracketName, type Match, type TournamentState } from "./tournament";

export function bracketKey(match: Match) { return `${match.divisionId}:${match.subBracket ?? 0}`; }
export function bracketLabel(state: TournamentState, match: Match) {
  const division = state.divisions.find(d => d.id === match.divisionId);
  return `${division?.name ?? "Division"} · ${subBracketName(match.subBracket ?? 0)}`;
}
export function gameNumber(state: TournamentState, match: Match) { return state.matches.findIndex(m => m.id === match.id) + 1; }
export function matchupText(state: TournamentState, match: Match) {
  if (!match.entryAId && !match.entryBId && match.label.includes(" vs ")) return match.label.split(" · ").at(-1)!;
  const entries = state.divisions.find(d => d.id === match.divisionId)?.entries ?? [];
  return `${displayName(entries.find(e => e.id === match.entryAId))} vs ${displayName(entries.find(e => e.id === match.entryBId))}`;
}
export function isFinished(match: Match) { return match.validated || match.status === "finished" || Boolean(matchWinner(match)); }
export function isDispatched(match: Match) { return !isFinished(match) && Boolean(match.dispatchedAt); }
export function courtOccupant(state: TournamentState, court: number) {
  return state.matches.find(m => m.court === court && isMatchUsingCourt(m)) ?? state.matches.find(m => m.court === court && isDispatched(m) && m.status === "ready");
}

function playerKeys(state: TournamentState, match: Match): Set<string> {
  const division = state.divisions.find(d => d.id === match.divisionId);
  const keys = new Set<string>();
  for (const entry of division?.entries.filter(e => e.id === match.entryAId || e.id === match.entryBId) ?? []) {
    entry.players.forEach((name, index) => {
      const registration = state.registrations.find(r => r.id === entry.registrationIds?.[index]);
      if (registration) keys.add(`person:${registration.personId || registration.id}`);
      // Also works in public state, which intentionally omits private registrations.
      if (name.trim()) keys.add(`name:${name.trim().toLocaleLowerCase().replace(/\s+/g, " ")}`);
    });
  }
  return keys;
}
const overlaps = (a: Set<string>, b: Set<string>) => [...a].some(key => b.has(key));
export type Eligibility = { ready: boolean; reason: string; eligibleAt?: string };
export function gameEligibility(state: TournamentState, match: Match, now = Date.now(), ignoreOwnDispatch = false): Eligibility {
  if (state.status === "completed") return { ready: false, reason: "Tournament completed" };
  if (isFinished(match)) return { ready: false, reason: "Result complete" };
  if (!ignoreOwnDispatch && (match.status === "live" || isDispatched(match))) return { ready: false, reason: "Already assigned / in progress" };
  if (!match.entryAId || !match.entryBId) return { ready: false, reason: "Waiting for confirmed players / winners" };
  if (match.entryAId === match.entryBId) return { ready: false, reason: "Matchup needs two different entries" };
  const division = state.divisions.find(d => d.id === match.divisionId);
  if (!division?.entries.some(e => e.id === match.entryAId) || !division.entries.some(e => e.id === match.entryBId)) return { ready: false, reason: "Waiting for confirmed players" };
  if (match.stage !== "regular" && !division.manualChampionshipMatchups) {
    const prior = state.matches.filter(m => m.divisionId === match.divisionId && (m.stage === "regular" || m.round < match.round));
    if (prior.some(m => !m.validated)) return { ready: false, reason: "Waiting for earlier results to be validated" };
  }
  const players = playerKeys(state, match);
  const busy = state.matches.find(m => m.id !== match.id && !isFinished(m) && (m.status === "live" || isDispatched(m)) && overlaps(players, playerKeys(state, m)));
  if (busy) return { ready: false, reason: `Players busy in Game ${gameNumber(state, busy)}` };
  const rest = gameDaySettings(state).restMinutes * 60000;
  const end = Math.max(0, ...state.matches.filter(m => m.id !== match.id && isFinished(m) && m.completedAt && overlaps(players, playerKeys(state, m))).map(m => Date.parse(m.completedAt!) || 0));
  if (rest && end && now < end + rest) return { ready: false, reason: "Players resting", eligibleAt: new Date(end + rest).toISOString() };
  return { ready: true, reason: "Ready" };
}

export function gameQueue(state: TournamentState, now = Date.now()) {
  const pending = state.matches.filter(m => !isFinished(m) && m.status !== "live" && !isDispatched(m));
  const allKeys = [...new Set(state.matches.map(bracketKey))];
  const settings = gameDaySettings(state);
  const cursor = Math.max(0, allKeys.indexOf(settings.nextBracketKey ?? ""));
  const keys = [...allKeys.slice(cursor), ...allKeys.slice(0, cursor)];
  const eligible = pending.filter(m => gameEligibility(state, m, now).ready);
  const compare = (a: Match, b: Match) => (a.scheduledAt ?? "z").localeCompare(b.scheduledAt ?? "z") || gameNumber(state, a) - gameNumber(state, b);
  const groups = new Map(keys.map(key => [key, eligible.filter(m => bracketKey(m) === key).sort(compare)]));
  const ready: Match[] = [];
  if (settings.evenRotation) {
    while ([...groups.values()].some(games => games.length)) for (const key of keys) { const next = groups.get(key)?.shift(); if (next) ready.push(next); }
  } else ready.push(...eligible.sort(compare));
  return { ready, waiting: pending.filter(m => !gameEligibility(state, m, now).ready), rotation: keys.map(key => ({ key, match: state.matches.find(m => bracketKey(m) === key)!, next: ready.find(m => bracketKey(m) === key) })) };
}

/** Atomic endpoint calls this against the latest revision, never a stale UI recommendation. */
export function dispatchGame(state: TournamentState, matchId: string, court: number, now = Date.now()): { state?: TournamentState; error?: string } {
  const match = state.matches.find(m => m.id === matchId);
  if (!match) return { error: "Game not found." };
  if (!Number.isInteger(court) || court < 1 || court > state.courts) return { error: "Choose a valid court." };
  const eligible = gameEligibility(state, match, now);
  if (!eligible.ready) return { error: eligible.reason };
  if (courtOccupant(state, court)) return { error: `Court ${court} is already in use or reserved.` };
  const keys = [...new Set(state.matches.map(bracketKey))];
  const nextBracketKey = keys[(keys.indexOf(bracketKey(match)) + 1) % keys.length];
  return { state: { ...state, gameDay: { ...gameDaySettings(state), nextBracketKey }, matches: state.matches.map(m => m.id === matchId ? { ...m, court, dispatchedAt: new Date(now).toISOString(), courtInUse: false } : m) } };
}

export type NearCapSignal = { match: Match; setNumber: number; remaining: number; cap: number };
export function nearCapSignal(state: TournamentState, match: Match): NearCapSignal | null {
  const settings = gameDaySettings(state);
  if (!settings.nearCapEnabled || state.status !== "live" || match.status !== "live" || isFinished(match)) return null;
  const index = match.sets.findIndex(s => !s.complete);
  if (index < 0) return null;
  const set = match.sets[index], rule = scoringRule(match.format, match.scoring);
  const cap = rule.mode === "first_to_target" ? rule.target : rule.cap;
  const needed = match.format === "best_of_3_21" ? 2 : 1;
  const aWins = match.sets.filter(s => s.complete && isSetWon(s, match.stage, match.format, match.scoring) && s.a > s.b).length;
  const bWins = match.sets.filter(s => s.complete && isSetWon(s, match.stage, match.format, match.scoring) && s.b > s.a).length;
  // Warn only if a side within the threshold can win the entire match in this set.
  const closers = [aWins + 1 >= needed ? set.a : -1, bWins + 1 >= needed ? set.b : -1];
  const leader = Math.max(...closers), remaining = cap - leader;
  return leader > 0 && remaining >= 0 && remaining <= settings.nearCapPoints ? { match, setNumber: index + 1, remaining, cap } : null;
}
export function nextGameCalls(state: TournamentState, now = Date.now()) {
  const upcoming = gameQueue(state, now).ready;
  const signals = state.matches.map(m => nearCapSignal(state, m)).filter((s): s is NearCapSignal => Boolean(s));
  const reserved = state.matches.filter(m => isDispatched(m) && m.status === "ready");
  const used = new Set<string>();
  return signals.map(signal => {
    const next = reserved.find(m => m.court === signal.match.court && !used.has(m.id)) ?? upcoming.find(m => !used.has(m.id));
    if (next) used.add(next.id);
    return { ...signal, next };
  });
}
