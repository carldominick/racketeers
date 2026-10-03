import { courtOccupant, gameNumber } from "./game-day";
import { displayName, isMatchUsingCourt, type TournamentState } from "./tournament";

export type ProjectorCourt = {
  court: number;
  status: "in_play" | "reserved" | "available";
  game?: { number: number; division: string; playersA: string[]; playersB: string[]; scoreA: number; scoreB: number; setNumber: number; multipleSets: boolean };
};

/** Use physical occupation and dispatched reservations, never a planned schedule. */
export function projectorCourts(state: TournamentState): ProjectorCourt[] {
  return Array.from({ length: Math.max(0, Math.trunc(state.courts)) }, (_, index) => {
    const court = index + 1;
    const match = courtOccupant(state, court);
    if (!match) return { court, status: "available" as const };
    const division = state.divisions.find(item => item.id === match.divisionId);
    const players = (id: string | null) => {
      const entry = division?.entries.find(item => item.id === id);
      return entry?.players.filter(name => name.trim()).length ? entry.players.filter(name => name.trim()) : [displayName(entry)];
    };
    const unfinished = match.sets.findIndex(set => !set.complete);
    const setIndex = unfinished >= 0 ? unfinished : Math.max(0, match.sets.length - 1);
    const score = match.sets[setIndex];
    return { court, status: isMatchUsingCourt(match) ? "in_play" as const : "reserved" as const, game: { number: gameNumber(state, match), division: division?.name ?? "Division", playersA: players(match.entryAId), playersB: players(match.entryBId), scoreA: score?.a ?? 0, scoreB: score?.b ?? 0, setNumber: setIndex + 1, multipleSets: match.format === "best_of_3_21" } };
  });
}

/** Whole grid rows fit each page, including long names and small viewports. */
export function paginateCourts(heights: number[], columns: number, available: number, gap = 16): { start: number; end: number }[] {
  const width = Math.max(1, Math.trunc(columns));
  const rows = Array.from({ length: Math.ceil(heights.length / width) }, (_, row) => Math.max(...heights.slice(row * width, (row + 1) * width)) + gap);
  return paginateRows(rows, available + gap).map(page => ({ start: page.start * width, end: Math.min(heights.length, page.end * width) }));
}

/** Pack measured rows into pages without dropping or duplicating any row. */
export function paginateRows(heights: number[], available: number): { start: number; end: number }[] {
  const pages: { start: number; end: number }[] = [];
  let start = 0, used = 0;
  for (let i = 0; i < heights.length; i++) {
    const height = Math.max(1, heights[i]);
    if (i > start && used + height > available) { pages.push({ start, end: i }); start = i; used = 0; }
    used += height;
  }
  pages.push({ start, end: heights.length });
  return pages;
}
