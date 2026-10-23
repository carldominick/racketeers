import type { Match, TournamentState } from "./tournament";

export function gameHasStarted(match: Match) {
  return match.status !== "ready" || match.validated || Boolean(match.forfeit || match.completedAt || match.courtInUse) || match.sets.some(set => set.a > 0 || set.b > 0 || set.complete);
}
export function regenerationIssue(state: TournamentState): string | null {
  if (state.status === "live" || state.status === "completed") return "Regeneration is unavailable during Live or Completed.";
  if (state.matches.some(gameHasStarted)) return "Games have already started or have recorded results. Use individual game corrections; brackets cannot be regenerated.";
  return null;
}
export function regenerationImpact(state: TournamentState) {
  return { games: state.matches.length, entries: state.divisions.reduce((total, division) => total + division.entries.length, 0), scheduled: state.matches.filter(match => match.scheduledAt || match.court).length, reserved: state.matches.filter(match => match.dispatchedAt).length };
}
/** Summary contains field names only, never PINs, contacts or receipt data. */
export function conflictingSections(local: TournamentState, remote: TournamentState) {
  const labels: Partial<Record<keyof TournamentState, string>> = { registrations: "Registrations", divisions: "Divisions and entries", matches: "Games, scores and courts", gameDay: "Game Day settings", projector: "Projector settings", status: "Tournament phase" };
  const ignored = new Set(["updatedAt", "theme", "organizerPinHash", "umpirePinHash", "courtHelp", "staffNotifications"]);
  return [...new Set(Object.keys(local).filter(key => !ignored.has(key) && JSON.stringify(local[key as keyof TournamentState]) !== JSON.stringify(remote[key as keyof TournamentState])).map(key => labels[key as keyof TournamentState] || "Tournament setup"))];
}
