import { isAwaitingUmpireCompletion, type StaffNotification, type TournamentState } from "./tournament";
import { courtOccupant, gameNumber, isFinished, matchupText, nextGameCalls } from "./game-day";

export function appendStaffNotification(state: TournamentState, event: Omit<StaffNotification, "id" | "createdAt">): TournamentState {
  return { ...state, staffNotifications: [...(state.staffNotifications ?? []), { ...event, id: crypto.randomUUID(), createdAt: new Date().toISOString() }].slice(-100) };
}

/** Record court releases once, independently of organizer validation. */
export function recordCourtCompletions(previous: TournamentState, next: TournamentState): TournamentState {
  let result: TournamentState = { ...next, matches: next.matches.map(match => {
    const before = previous.matches.find(m => m.id === match.id);
    const finished = isFinished(match);
    const newlyFinished = finished && before && !isFinished(before);
    return { ...match, completedAt: finished ? match.completedAt || before?.completedAt || (newlyFinished ? new Date().toISOString() : undefined) : undefined };
  }) };
  for (const match of next.matches) {
    const before = previous.matches.find(item => item.id === match.id);
    if (match.umpireWorkflow && !match.forfeit) continue;
    if (!before) continue;
    const confirmedGame = isAwaitingUmpireCompletion(before) && isFinished(match);
    const court = confirmedGame ? before.court : match.court;
    if (!court || court > next.courts) continue;
    const setIndex = match.sets.findIndex((set, index) => set.complete && !before.sets[index]?.complete);
    if (confirmedGame || match.forfeit && !before.forfeit) {
      result = appendStaffNotification(result, { kind: "court_released", court, matchId: match.id, matchLabel: match.label, gameComplete: true, available: !courtOccupant(next, court) });
      continue;
    }
    if (setIndex < 0 || isAwaitingUmpireCompletion(match)) continue;
    result = appendStaffNotification(result, { kind: "court_released", court, matchId: match.id, matchLabel: match.label, setNumber: setIndex + 1, gameComplete: isFinished(match), available: !courtOccupant(next, court) });
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
  const court = `Court ${event.court} ${event.available ? "is now available" : "is in use"}`;
  if (event.gameComplete) return `Game complete · ${court}`;
  return event.setNumber ? `Set ${event.setNumber} complete · ${court}` : court;
}
