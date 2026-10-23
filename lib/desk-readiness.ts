import type { TournamentState } from "./tournament";
import { isDispatched, isFinished } from "./game-day";
export function deskReadiness(state: TournamentState) {
  return {
    validations: state.matches.filter(match => isFinished(match) && !match.validated),
    held: state.matches.filter(match => match.hold && !isFinished(match)),
    noShows: state.matches.filter(match => match.forfeit && !match.validated),
    reserved: state.matches.filter(match => match.status === "ready" && isDispatched(match)),
  };
}
