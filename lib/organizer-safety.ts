import { gameDaySettings, reseedChampionships, type Match, type TournamentState } from "./tournament";

export const RESET_GAMES_CONFIRMATION = "RESET GAMES";

export function resetTournamentGames(state: TournamentState, now = new Date().toISOString()): TournamentState | null {
  // Retire old match PINs so a scorecard left open on another device cannot
  // put pre-reset scores back. Managed umpire actions use workflow versions.
  const oldPins = new Set(state.matches.map(match => match.pin));
  const pins = state.managedUmpires ? [] : Array.from({ length: 9000 }, (_, index) => String(1000 + index)).filter(pin => !oldPins.has(pin));
  if (!state.managedUmpires && pins.length < state.matches.length) return null;
  const random = state.managedUmpires ? new Uint32Array() : crypto.getRandomValues(new Uint32Array(state.matches.length));
  const matches = state.matches.map((match, index): Match => {
    const pinIndex = state.managedUmpires ? 0 : random[index] % pins.length;
    const pin = state.managedUmpires ? "" : pins[pinIndex];
    if (!state.managedUmpires) {
      pins[pinIndex] = pins[pins.length - 1];
      pins.pop();
    }
    return {
      ...match, pin, sets: [{ a: 0, b: 0, complete: false }], status: "ready", validated: false,
      court: null, courtInUse: false, dispatchedAt: undefined, completedAt: undefined,
      awaitingUmpireCompletion: undefined, provisionalResult: undefined, voidedResult: undefined,
      nearCapNotified: undefined, hold: undefined, forfeit: undefined, umpireWorkflow: undefined,
      umpireHistory: match.umpireWorkflow
        ? [...(match.umpireHistory ?? []), { ...match.umpireWorkflow, releasedAt: match.umpireWorkflow.releasedAt ?? now }]
        : match.umpireHistory,
    };
  });
  return reseedChampionships({
    ...state, matches, courtHelp: {}, staffNotifications: [],
    gameDay: { ...gameDaySettings(state), nextBracketKey: undefined },
  });
}

export function gameHasStarted(match: Match) {
  return match.status !== "ready" || match.validated || Boolean(match.forfeit || match.completedAt || match.courtInUse) || match.sets.some(set => set.a > 0 || set.b > 0 || set.complete);
}
export function regenerationIssue(state: TournamentState): string | null {
  if (state.status === "live" || state.status === "completed") return "Regeneration is unavailable during Live or Completed.";
  if (state.matches.some(match => gameHasStarted(match) || match.umpireWorkflow || match.umpireHistory?.length)) return "Games have already started or have recorded results. Use individual game corrections; brackets cannot be regenerated.";
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
