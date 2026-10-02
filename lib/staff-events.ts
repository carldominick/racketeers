import { isMatchUsingCourt, matchWinner, type StaffNotification, type TournamentState } from "./tournament";
import { gameNumber, matchupText, nextGameCalls } from "./game-day";

export function appendStaffNotification(state: TournamentState, event: Omit<StaffNotification, "id" | "createdAt">): TournamentState {
  return { ...state, staffNotifications: [...(state.staffNotifications ?? []), { ...event, id: crypto.randomUUID(), createdAt: new Date().toISOString() }].slice(-100) };
}

/** Only newly completed sets generate alerts. Refreshes, resets and court reassignment do not. */
export function recordCourtCompletions(previous: TournamentState, next: TournamentState): TournamentState {
  let result: TournamentState = { ...next, matches: next.matches.map(match => {
    const before = previous.matches.find(m => m.id === match.id);
    const finished = Boolean(matchWinner(match)) || match.status === "finished";
    const newlyFinished = finished && before && !matchWinner(before) && before.status !== "finished";
    return { ...match, completedAt: finished ? match.completedAt || before?.completedAt || (newlyFinished ? new Date().toISOString() : undefined) : undefined };
  }) };
  for (const match of next.matches) {
    const before = previous.matches.find(item => item.id === match.id);
    if (!before || !match.court || match.court > next.courts) continue;
    const setIndex = match.sets.findIndex((set, index) => set.complete && !before.sets[index]?.complete);
    if (setIndex < 0) continue;
    result = appendStaffNotification(result, { kind: "court_released", court: match.court, matchId: match.id, matchLabel: match.label, setNumber: setIndex + 1, gameComplete: Boolean(matchWinner(match)), available: !next.matches.some(item => item.court === match.court && isMatchUsingCourt(item)) });
  }
  for (const call of nextGameCalls(result)) {
    if (call.match.nearCapNotified || !call.match.court) continue;
    result = appendStaffNotification(result, { kind: "near_cap", court: call.match.court, matchId: call.match.id, matchLabel: call.match.label, setNumber: call.setNumber, pointsRemaining: call.remaining, nextMatchLabel: call.next ? `Game ${gameNumber(result, call.next)} · ${matchupText(result, call.next)}` : undefined });
    result = { ...result, matches: result.matches.map(m => m.id === call.match.id ? { ...m, nearCapNotified: true } : m) };
  }
  return result;
}

export function staffNotificationText(event: StaffNotification): string {
  if (event.kind === "help_requested") return `Court ${event.court} needs help`;
  if (event.kind === "help_cleared") return `Court ${event.court} help request cleared`;
  if (event.kind === "near_cap") return `Court ${event.court} · ${event.pointsRemaining ?? 0} points from cap. ${event.nextMatchLabel ? `Prepare ${event.nextMatchLabel}` : "Prepare the next players"}`;
  const completion = event.gameComplete ? "Game complete" : `Set ${event.setNumber ?? ""} complete`;
  return `${completion} · Court ${event.court} ${event.available ? "is now available" : "is in use"}`;
}
