import { isMatchUsingCourt, matchWinner, type StaffNotification, type TournamentState } from "./tournament";

export function appendStaffNotification(state: TournamentState, event: Omit<StaffNotification, "id" | "createdAt">): TournamentState {
  return { ...state, staffNotifications: [...(state.staffNotifications ?? []), { ...event, id: crypto.randomUUID(), createdAt: new Date().toISOString() }].slice(-100) };
}

/** Only newly completed sets generate alerts. Refreshes, resets and court reassignment do not. */
export function recordCourtCompletions(previous: TournamentState, next: TournamentState): TournamentState {
  let result = next;
  for (const match of next.matches) {
    const before = previous.matches.find(item => item.id === match.id);
    if (!before || !match.court || match.court > next.courts) continue;
    const setIndex = match.sets.findIndex((set, index) => set.complete && !before.sets[index]?.complete);
    if (setIndex < 0) continue;
    result = appendStaffNotification(result, { kind: "court_released", court: match.court, matchId: match.id, matchLabel: match.label, setNumber: setIndex + 1, gameComplete: Boolean(matchWinner(match)), available: !next.matches.some(item => item.court === match.court && isMatchUsingCourt(item)) });
  }
  return result;
}

export function staffNotificationText(event: StaffNotification): string {
  if (event.kind === "help_requested") return `Court ${event.court} needs help`;
  if (event.kind === "help_cleared") return `Court ${event.court} help request cleared`;
  const completion = event.gameComplete ? "Game complete" : `Set ${event.setNumber ?? ""} complete`;
  return `${completion} · Court ${event.court} ${event.available ? "is now available" : "is in use"}`;
}
