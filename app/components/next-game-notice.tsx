"use client";
import { BellRinging } from "@phosphor-icons/react/dist/csr/BellRinging";
import { gameNumber, matchupText, nextGameCalls } from "../../lib/game-day";
import type { TournamentState } from "../../lib/tournament";

/** Public callouts contain matchup names only; never PINs or registration details. */
export function NextGameNotice({ state }: { state: TournamentState }) {
  const calls = nextGameCalls(state);
  if (!calls.length) return null;
  return <aside className="next-game-notice" aria-label="Next players prepare" aria-live="polite">{calls.map(call => <div key={call.match.id}><BellRinging size={24} aria-hidden="true" /><p><strong>Next players, please prepare</strong><span>{call.next ? `Game ${gameNumber(state, call.next)} · ${matchupText(state, call.next)}` : "The next eligible matchup will appear here."}</span><small>{call.match.court ? `Court ${call.match.court} · ` : ""}Game {gameNumber(state, call.match)} is {call.remaining} {call.remaining === 1 ? "point" : "points"} from its {call.cap}-point cap.</small></p></div>)}</aside>;
}
