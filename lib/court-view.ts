import { projectorCourts, type ProjectorCourt } from "./projector";
import type { TournamentState } from "./tournament";

export type CourtViewSnapshot = {
  name: string; venue: string; theme: TournamentState["theme"]; phase: TournamentState["status"];
  courts: ProjectorCourt[]; updatedAt: string;
};
/** Whitelist projection: never transfer staff credentials or raw state to a display. */
export function courtViewSnapshot(state: TournamentState, staffPreview = false): CourtViewSnapshot {
  return { name: state.tournamentName, venue: state.venue || "", theme: state.theme, phase: state.status,
    courts: staffPreview || state.status === "live" || state.status === "completed" ? projectorCourts(state) : [],
    updatedAt: new Date().toISOString() };
}

// BWF doubles layout in metres; no centre line through either forecourt.
export const badmintonLines: [number, number, number, number][] = [
  [-3.05,-6.7,3.05,-6.7],[-3.05,6.7,3.05,6.7],[-3.05,-6.7,-3.05,6.7],[3.05,-6.7,3.05,6.7],
  [-2.59,-6.7,-2.59,6.7],[2.59,-6.7,2.59,6.7],
  [-3.05,-1.98,3.05,-1.98],[-3.05,1.98,3.05,1.98],
  [-3.05,-5.94,3.05,-5.94],[-3.05,5.94,3.05,5.94],
  [0,-6.7,0,-1.98],[0,1.98,0,6.7],
];
