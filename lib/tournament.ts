export type Mode = "singles" | "doubles" | "team";
export type BracketFormat = "round_robin" | "single_elimination" | "double_round_robin" | "custom";
export type ChampionshipFormat = "semifinals_final" | "direct_medals" | "ladderized";
export type MatchFormat = "single_31" | "single_21" | "best_of_3_21";
export type MatchStage = "regular" | "round_64" | "round_32" | "round_16" | "quarterfinal" | "semifinal" | "gold" | "bronze";
export type MatchStatus = "ready" | "live" | "finished";
export type TournamentPhase = "setup" | "registration" | "live" | "completed";

export type Entry = {
  id: string;
  name: string;
  teamName?: string;
  players: string[];
  registrationIds?: string[];
  playerLevels?: string[];
  desiredLevels?: string[];
  shirtSizes?: string[];
  levelOverride?: string;
  poolOverride?: number | null;
};

export type PlayerRegistration = {
  id: string;
  name: string;
  divisionId: string;
  paid: boolean;
  shirtReceived: boolean;
  shirtSize: string;
  partnerId: string | null;
  partnerName: string;
  teamName: string;
  playerLevel: string;
  desiredLevel: string;
  poolOverride?: number | null;
  registrationPinHash?: string;
  /** Server-only recoverable value; never included in normal state or player responses. */
  registrationPinRecovery?: string;
  paymentGroupId?: string;
  selfRegistered?: boolean;
  club?: string;
  personId?: string;
  secondShirt?: "black" | "tournament";
};

export type Division = {
  id: string;
  name: string;
  mode: Mode;
  bracketFormat: BracketFormat;
  championshipFormat: ChampionshipFormat;
  teamCount: number;
  playerCount: number;
  pairCount: number;
  playersPerTeam: number;
  playersPerPair: number;
  groupMatchFormat: MatchFormat;
  championshipMatchFormat: MatchFormat;
  customGroupGameCount: number;
  subBracketCount: number;
  qualifiersPerSubBracket: number;
  knockoutSize: 2 | 4 | 8 | 16 | 32 | 64;
  manualChampionshipMatchups: boolean;
  registrationManaged: boolean;
  entries: Entry[];
};

export type SetScore = { a: number; b: number; complete: boolean };

export type Match = {
  id: string;
  divisionId: string;
  stage: MatchStage;
  round: number;
  label: string;
  entryAId: string | null;
  entryBId: string | null;
  sets: SetScore[];
  status: MatchStatus;
  court: number | null;
  scheduledAt: string | null;
  validated: boolean;
  pin: string;
  format: MatchFormat;
  subBracket?: number;
};

export type MedalPoints = { gold: number; silver: number; bronze: number; runnerUp: number };

export type TournamentState = {
  version: number;
  status: TournamentPhase;
  tournamentName: string;
  organizerPinHash?: string;
  umpirePinHash?: string;
  theme: "light" | "dark";
  startDate: string;
  endDate: string;
  dayStart: string;
  dayEnd: string;
  gameDuration: number;
  courts: number;
  medalPoints: MedalPoints;
  divisions: Division[];
  registrations: PlayerRegistration[];
  matches: Match[];
  updatedAt: string;
};

export type Standing = {
  entryId: string;
  name: string;
  played: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  difference: number;
};

const id = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
const pin = () => String(Math.floor(1000 + Math.random() * 9000));

export function makeEntry(index: number, mode: Mode, playersPerTeam = 4, playersPerPair = 2): Entry {
  const count = mode === "singles" ? 1 : mode === "doubles" ? 2 : playersPerTeam;
  const label = mode === "team" ? `Team ${index + 1}` : mode === "doubles" ? `Pair ${index + 1}` : `Player ${index + 1}`;
  return {
    id: id("entry"),
    name: label,
    teamName: mode === "team" ? label : undefined,
    players: Array.from({ length: count }, (_, player) =>
      mode === "team" ? `Pair ${Math.floor(player / playersPerPair) + 1} · Player ${(player % playersPerPair) + 1}` : `Player ${player + 1}`,
    ),
  };
}

export function makeDivision(name: string, mode: Mode): Division {
  const teamCount = 4;
  const playersPerTeam = mode === "team" ? 4 : mode === "doubles" ? 2 : 1;
  const playersPerPair = mode === "singles" ? 1 : 2;
  return {
    id: id("division"),
    name,
    mode,
    bracketFormat: "round_robin",
    championshipFormat: "direct_medals",
    teamCount,
    playerCount: teamCount * playersPerTeam,
    pairCount: mode === "singles" ? 0 : mode === "team" ? teamCount * Math.ceil(playersPerTeam / playersPerPair) : teamCount,
    playersPerTeam,
    playersPerPair,
    groupMatchFormat: "single_31",
    championshipMatchFormat: "best_of_3_21",
    customGroupGameCount: 4,
    subBracketCount: 1,
    qualifiersPerSubBracket: 1,
    knockoutSize: 8,
    manualChampionshipMatchups: false,
    registrationManaged: true,
    entries: [],
  };
}

export function initialTournament(): TournamentState {
  const divisions = [makeDivision("Division 1", "doubles")];
  const base: TournamentState = {
    version: 5,
    status: "setup",
    tournamentName: "Racketeers Badminton Cup",
    theme: "light",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    dayStart: "09:00",
    dayEnd: "18:00",
    gameDuration: 25,
    courts: 4,
    medalPoints: { gold: 10, silver: 7, bronze: 5, runnerUp: 1 },
    divisions,
    registrations: [],
    matches: [],
    updatedAt: new Date().toISOString(),
  };
  return regenerateMatches(base);
}

export function displayName(entry?: Entry | null) {
  if (!entry) return "TBD";
  return entry.teamName?.trim() || entry.name || entry.players.filter(Boolean).join(" / ") || "Unnamed entry";
}

export function regenerateEntries(division: Division): Division {
  if (division.registrationManaged) return division;
  const wanted = Math.max(2, division.mode === "singles" ? division.playerCount : division.mode === "doubles" ? division.pairCount : division.teamCount);
  const entries = Array.from({ length: wanted }, (_, index) => {
    const old = division.entries[index];
    const fresh = makeEntry(index, division.mode, division.playersPerTeam, division.playersPerPair);
    if (!old) return fresh;
    const playerCount = division.mode === "singles" ? 1 : division.mode === "doubles" ? 2 : division.playersPerTeam;
    return {
      ...old,
      teamName: division.mode === "team" ? old.teamName || `Team ${index + 1}` : undefined,
      players: Array.from({ length: playerCount }, (_, player) => old.players[player] || fresh.players[player]),
    };
  });
  return { ...division, entries };
}

function blankMatch(divisionId: string, stage: MatchStage, round: number, label: string, a: string | null, b: string | null, format: MatchFormat, subBracket?: number): Match {
  return { id: id("match"), divisionId, stage, round, label, entryAId: a, entryBId: b, sets: [{ a: 0, b: 0, complete: false }], status: "ready", court: null, scheduledAt: null, validated: false, pin: pin(), format, subBracket };
}

export function subBracketName(index: number) {
  return `Bracket ${String.fromCharCode(65 + index)}`;
}

export function knockoutStageForSize(size: number): MatchStage {
  if (size >= 64) return "round_64";
  if (size >= 32) return "round_32";
  if (size >= 16) return "round_16";
  if (size >= 8) return "quarterfinal";
  if (size >= 4) return "semifinal";
  return "gold";
}

export function stageLabel(stage: MatchStage) {
  return ({ regular: "Group Stage", round_64: "Round of 64", round_32: "Round of 32", round_16: "Round of 16", quarterfinal: "Quarterfinals", semifinal: "Semifinals", gold: "Final", bronze: "Bronze Match" } as Record<MatchStage, string>)[stage];
}

export function makeRegistrationEditPin() {
  // Rejection sampling avoids modulo bias while retaining the existing eight-digit PIN format.
  const values = new Uint32Array(1);
  const range = 90_000_000;
  const limit = Math.floor(0x100000000 / range) * range;
  do { crypto.getRandomValues(values); } while (values[0] >= limit);
  return String(10_000_000 + values[0] % range);
}

export function regenerateMatchPin(state: TournamentState, matchId: string): TournamentState {
  const used = new Set(state.matches.map((match) => match.pin).filter(Boolean));
  let nextPin = "";
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = String(Math.floor(1000 + Math.random() * 9000));
    if (!used.has(candidate)) { nextPin = candidate; break; }
  }
  if (!nextPin) return state;
  return { ...state, matches: state.matches.map((match) => match.id === matchId ? { ...match, pin: nextPin } : match) };
}

export function distributeEntriesToPools(division: Division) {
  const poolCount = Math.max(1, Math.min(division.subBracketCount, Math.max(1, division.entries.length)));
  const pools = Array.from({ length: poolCount }, () => [] as Entry[]);
  const unassigned: Entry[] = [];
  division.entries.forEach((entry) => {
    const chosen = entry.poolOverride;
    if (chosen != null && chosen >= 0 && chosen < poolCount) pools[chosen].push(entry);
    else unassigned.push(entry);
  });
  unassigned.forEach((entry) => {
    const smallest = pools.reduce((best, pool, index) => pool.length < pools[best].length ? index : best, 0);
    pools[smallest].push(entry);
  });
  return pools;
}

export function regenerateMatches(state: TournamentState): TournamentState {
  const matches: Match[] = [];
  for (const rawDivision of state.divisions) {
    const division = regenerateEntries(rawDivision);
    const entries = division.entries;
    const pools = distributeEntriesToPools({ ...division, entries });
    const poolCount = pools.length;
    pools.forEach((pool, poolIndex) => {
      const prefix = poolCount > 1 ? `${subBracketName(poolIndex)} · ` : "";
      if (division.bracketFormat === "single_elimination") {
        for (let i = 0; i < pool.length; i += 2) {
          matches.push(blankMatch(division.id, "regular", 1, `${prefix}Elimination Match ${Math.floor(i / 2) + 1}`, pool[i]?.id ?? null, pool[i + 1]?.id ?? null, division.groupMatchFormat, poolIndex));
        }
      } else if (division.bracketFormat === "custom") {
        const count = Math.max(1, division.customGroupGameCount);
        for (let game = 0; game < count; game++) {
          const a = pool[game % Math.max(1, pool.length)];
          const b = pool[(game + 1 + Math.floor(game / Math.max(1, pool.length))) % Math.max(1, pool.length)];
          matches.push(blankMatch(division.id, "regular", 1, `${prefix}Custom Match ${game + 1}`, a?.id ?? null, a?.id === b?.id ? null : b?.id ?? null, division.groupMatchFormat, poolIndex));
        }
      } else {
        let game = 1;
        const repeats = division.bracketFormat === "double_round_robin" ? 2 : 1;
        for (let repeat = 0; repeat < repeats; repeat++) {
          for (let a = 0; a < pool.length; a++) {
            for (let b = a + 1; b < pool.length; b++) {
              const left = repeat % 2 === 0 ? pool[a] : pool[b];
              const right = repeat % 2 === 0 ? pool[b] : pool[a];
              matches.push(blankMatch(division.id, "regular", repeat + 1, `${prefix}Group Game ${game++}`, left.id, right.id, division.groupMatchFormat, poolIndex));
            }
          }
        }
      }
    });
    if (division.championshipFormat === "ladderized") {
      let participants = division.knockoutSize;
      let round = 1;
      while (participants >= 2) {
        const stage = knockoutStageForSize(participants);
        const matchCount = participants / 2;
        for (let game = 0; game < matchCount; game++) {
          matches.push(blankMatch(division.id, stage, round, `${stageLabel(stage)} ${stage === "gold" ? "" : `Match ${game + 1}`}`.trim(), null, null, division.championshipMatchFormat));
        }
        participants /= 2;
        round++;
      }
      if (division.knockoutSize >= 4) matches.push(blankMatch(division.id, "bronze", round - 1, "Bronze Match", null, null, division.championshipMatchFormat));
    } else if (division.championshipFormat === "semifinals_final") {
      matches.push(blankMatch(division.id, "semifinal", 1, "Semifinal 1", null, null, division.championshipMatchFormat));
      matches.push(blankMatch(division.id, "semifinal", 1, "Semifinal 2", null, null, division.championshipMatchFormat));
      matches.push(blankMatch(division.id, "gold", 2, "Championship", null, null, division.championshipMatchFormat));
      matches.push(blankMatch(division.id, "bronze", 2, "Bronze Match", null, null, division.championshipMatchFormat));
    } else {
      matches.push(blankMatch(division.id, "gold", 1, "Gold & Silver Match", null, null, division.championshipMatchFormat));
      matches.push(blankMatch(division.id, "bronze", 1, "Bronze Match", null, null, division.championshipMatchFormat));
    }
  }
  const usedPins = new Set<string>();
  for (const match of matches) {
    let candidate = match.pin;
    for (let attempts = 0; usedPins.has(candidate) && attempts < 9000; attempts++) candidate = String(1000 + ((Number(candidate) - 999) % 9000));
    match.pin = candidate;
    usedPins.add(candidate);
  }
  return { ...state, divisions: state.divisions.map(regenerateEntries), matches, updatedAt: new Date().toISOString() };
}

export function isSetWon(set: SetScore, stage: MatchStage, format?: MatchFormat) {
  const resolved = format ?? (stage === "regular" ? "single_31" : "best_of_3_21");
  const target = resolved === "single_31" ? 31 : 21;
  const cap = resolved === "single_31" ? 35 : 30;
  const high = Math.max(set.a, set.b);
  const low = Math.min(set.a, set.b);
  return high >= cap || (high >= target && high - low >= 2);
}

export function adjustMatchScore(match: Match, setIndex: number, side: "a" | "b", delta: number): Match {
  const setCount = match.format === "best_of_3_21" ? 3 : 1;
  if (setIndex < 0 || setIndex >= setCount || !Number.isFinite(delta)) return match;
  const cap = match.format === "single_31" ? 35 : 30;
  const sets = Array.from({ length: setCount }, (_, index) => match.sets[index] ?? { a: 0, b: 0, complete: false });
  const nextSets = sets.map((set, index) => {
    if (index !== setIndex) return set;
    if (set.complete) return set;
    const nextSet = { ...set, [side]: Math.max(0, Math.min(cap, set[side] + Math.trunc(delta))) };
    return { ...nextSet, complete: nextSet.complete && isSetWon(nextSet, match.stage, match.format) };
  });
  return { ...match, sets: nextSets, status: "live" };
}

export function completeMatchSet(match: Match, setIndex: number): Match {
  const set = match.sets[setIndex];
  if (!set || !isSetWon(set, match.stage, match.format)) return match;
  return { ...match, sets: match.sets.map((item, index) => index === setIndex ? { ...item, complete: true } : item), status: "live" };
}

export function uncompleteMatchSet(match: Match, setIndex: number): Match {
  if (match.validated || !match.sets[setIndex]?.complete) return match;
  return { ...match, sets: match.sets.map((set, index) => index === setIndex ? { ...set, complete: false } : set), status: "live" };
}

export function validateTournamentMatch(state: TournamentState, matchId: string): TournamentState {
  const matches = state.matches.map((match) => match.id === matchId ? {
    ...match,
    sets: match.sets.map((set) => ({ ...set, complete: isSetWon(set, match.stage, match.format) ? true : set.complete })),
    validated: true,
    status: "finished" as const,
    court: null,
  } : match);
  return reseedChampionships({ ...state, matches });
}

export function unvalidateTournamentMatch(state: TournamentState, matchId: string): TournamentState {
  const matches = state.matches.map((match) => match.id === matchId ? { ...match, validated: false, status: "live" as const, court: null } : match);
  return reseedChampionships({ ...state, matches });
}

export function matchWinner(match: Match): string | null {
  if (!match.entryAId || !match.entryBId) return null;
  const completed = match.sets.filter((set) => set.complete && isSetWon(set, match.stage, match.format));
  const aWins = completed.filter((set) => set.a > set.b).length;
  const bWins = completed.filter((set) => set.b > set.a).length;
  const needed = match.format === "best_of_3_21" ? 2 : 1;
  if (aWins >= needed) return match.entryAId;
  if (bWins >= needed) return match.entryBId;
  return null;
}

function winnerOrBye(match?: Match): string | null {
  if (!match) return null;
  return (match.validated ? matchWinner(match) : null) ?? (match.entryAId && !match.entryBId ? match.entryAId : match.entryBId && !match.entryAId ? match.entryBId : null);
}

export function standingsFor(state: TournamentState, divisionId: string, subBracket?: number): Standing[] {
  const division = state.divisions.find((item) => item.id === divisionId);
  if (!division) return [];
  const poolMatches = state.matches.filter((item) => item.divisionId === divisionId && item.stage === "regular" && (subBracket === undefined || (item.subBracket ?? 0) === subBracket));
  const poolEntries = subBracket === undefined ? division.entries : division.entries.filter((entry) => poolMatches.some((match) => match.entryAId === entry.id || match.entryBId === entry.id));
  const rows = new Map(poolEntries.map((entry) => [entry.id, { entryId: entry.id, name: displayName(entry), played: 0, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0, difference: 0 }]));
  for (const match of poolMatches.filter((item) => item.validated)) {
    const a = match.entryAId ? rows.get(match.entryAId) : null;
    const b = match.entryBId ? rows.get(match.entryBId) : null;
    const winner = matchWinner(match);
    if (!a || !b || !winner) continue;
    const aPoints = match.sets.reduce((sum, set) => sum + set.a, 0);
    const bPoints = match.sets.reduce((sum, set) => sum + set.b, 0);
    a.played++; b.played++;
    a.pointsFor += aPoints; a.pointsAgainst += bPoints;
    b.pointsFor += bPoints; b.pointsAgainst += aPoints;
    if (winner === a.entryId) { a.wins++; b.losses++; } else { b.wins++; a.losses++; }
  }
  return [...rows.values()].map((row) => ({ ...row, difference: row.pointsFor - row.pointsAgainst })).sort((a, b) => b.wins - a.wins || b.difference - a.difference || b.pointsFor - a.pointsFor || a.name.localeCompare(b.name));
}

export function championshipRanking(state: TournamentState, division: Division): string[] {
  const poolCount = Math.max(1, division.subBracketCount);
  if (poolCount === 1) return standingsFor(state, division.id).map((row) => row.entryId);
  const rankedPools = Array.from({ length: poolCount }, (_, index) => standingsFor(state, division.id, index));
  const rank: string[] = [];
  for (let place = 0; place < Math.max(1, division.qualifiersPerSubBracket); place++) {
    for (const pool of rankedPools) if (pool[place]) rank.push(pool[place].entryId);
  }
  return rank;
}

export function reseedChampionships(state: TournamentState): TournamentState {
  const matches = state.matches.map((match) => ({ ...match }));
  for (const division of state.divisions) {
    if (division.manualChampionshipMatchups) continue;
    const working = { ...state, matches };
    const rank = championshipRanking(working, division);
    const pool = matches.filter((match) => match.divisionId === division.id && match.stage !== "regular");
    const untouched = (match?: Match) => match && match.status === "ready" && !match.sets.some((set) => set.a || set.b || set.complete) && !match.validated;
    if (division.championshipFormat === "ladderized") {
      const rounds = [...new Set(pool.filter((match) => match.stage !== "bronze").map((match) => match.round))].sort((a, b) => a - b);
      rounds.forEach((round, roundIndex) => {
        const current = pool.filter((match) => match.round === round && match.stage !== "bronze");
        if (roundIndex === 0) {
          current.forEach((match, index) => {
            if (!untouched(match)) return;
            match.entryAId = rank[index] ?? null;
            match.entryBId = rank[division.knockoutSize - 1 - index] ?? rank[current.length + index] ?? null;
          });
          return;
        }
        const previous = pool.filter((match) => match.round === rounds[roundIndex - 1] && match.stage !== "bronze");
        current.forEach((match, index) => {
          if (!untouched(match)) return;
          match.entryAId = winnerOrBye(previous[index * 2]);
          match.entryBId = winnerOrBye(previous[index * 2 + 1]);
        });
      });
      const semis = pool.filter((match) => match.stage === "semifinal");
      const bronze = pool.find((match) => match.stage === "bronze");
      if (bronze && untouched(bronze) && semis.length >= 2) {
        const winners = semis.map(matchWinner);
        bronze.entryAId = winners[0] ? (semis[0].entryAId === winners[0] ? semis[0].entryBId : semis[0].entryAId) : null;
        bronze.entryBId = winners[1] ? (semis[1].entryAId === winners[1] ? semis[1].entryBId : semis[1].entryAId) : null;
      }
    } else if (division.championshipFormat === "direct_medals") {
      const gold = pool.find((match) => match.stage === "gold");
      const bronze = pool.find((match) => match.stage === "bronze");
      if (untouched(gold)) { gold!.entryAId = rank[0] ?? null; gold!.entryBId = rank[1] ?? null; }
      if (untouched(bronze)) { bronze!.entryAId = rank[2] ?? null; bronze!.entryBId = rank[3] ?? null; }
    } else {
      const semis = pool.filter((match) => match.stage === "semifinal");
      if (untouched(semis[0])) { semis[0].entryAId = rank[0] ?? null; semis[0].entryBId = rank[3] ?? null; }
      if (untouched(semis[1])) { semis[1].entryAId = rank[1] ?? null; semis[1].entryBId = rank[2] ?? null; }
      const winners = semis.map(matchWinner);
      const losers = semis.map((match, index) => winners[index] ? (match.entryAId === winners[index] ? match.entryBId : match.entryAId) : null);
      const gold = pool.find((match) => match.stage === "gold");
      const bronze = pool.find((match) => match.stage === "bronze");
      if (untouched(gold)) { gold!.entryAId = winners[0]; gold!.entryBId = winners[1]; }
      if (untouched(bronze)) { bronze!.entryAId = losers[0]; bronze!.entryBId = losers[1]; }
    }
  }
  return { ...state, matches };
}

export function makeRegistration(divisionId: string, index = 0): PlayerRegistration {
  return { id: `REG${crypto.randomUUID().replace(/-/g, "").toUpperCase()}`, name: `Player ${index + 1}`, divisionId, paid: false, shirtReceived: false, shirtSize: "M", partnerId: null, partnerName: "", teamName: "", playerLevel: "Beginner", desiredLevel: "Beginner", poolOverride: null };
}

export function makeUniqueRegistration(divisionId: string, index: number, existing: PlayerRegistration[]): PlayerRegistration {
  const used = new Set(existing.map(player => player.id));
  for (let attempt = 0; attempt < 20; attempt++) {
    const registration = makeRegistration(divisionId, index);
    if (!used.has(registration.id)) return registration;
  }
  throw new Error("Unable to allocate a unique registration ID. Please try again.");
}

export function availablePartnerRegistrations(registrations: PlayerRegistration[], player: PlayerRegistration) {
  return registrations.filter((candidate) => candidate.divisionId === player.divisionId && candidate.id !== player.id && (!candidate.partnerId || candidate.partnerId === player.id));
}

export function syncRegistrationsToEntries(state: TournamentState): TournamentState {
  const divisions = state.divisions.map((division) => {
    const players = state.registrations.filter((registration) => registration.divisionId === division.id);
    if (!players.length) return division.registrationManaged ? { ...division, playerCount: 0, pairCount: 0, entries: [] } : regenerateEntries(division);
    if (division.mode === "singles") {
      return { ...division, playerCount: players.length, entries: players.map((player) => ({ id: `entry-${player.id}`, name: player.name, players: [player.name], registrationIds: [player.id], playerLevels: [player.playerLevel], desiredLevels: [player.desiredLevel], shirtSizes: [player.shirtSize], poolOverride: player.poolOverride, levelOverride: division.entries.find((entry) => entry.registrationIds?.includes(player.id))?.levelOverride })) };
    }
    if (division.mode === "doubles") {
      const used = new Set<string>();

      const entries: Entry[] = [];
      for (const player of players) {
        if (used.has(player.id)) continue;
        const partner = players.find((candidate) => candidate.id === player.partnerId && !used.has(candidate.id));
        used.add(player.id); if (partner) used.add(partner.id);
        const pairPlayers = partner ? [player, partner] : [player];
        const names = pairPlayers.map((item) => item.name).filter(Boolean);
        const pairKey = [...names].map((name) => name.trim().toLowerCase()).sort().join("|");

        const registrationIds = pairPlayers.map((item) => item.id);
        const sortedIds = [...registrationIds].sort();
        const old = division.entries.find((entry) => entry.registrationIds?.some((registrationId) => registrationIds.includes(registrationId))) ?? division.entries.find((entry) => [...entry.players].map((name) => name.toLowerCase()).sort().join("|") === pairKey);
        entries.push({ id: `entry-${sortedIds.join("-")}`, name: names.join(" / "), players: names, registrationIds, playerLevels: pairPlayers.map((item) => item.playerLevel), desiredLevels: pairPlayers.map((item) => item.desiredLevel), shirtSizes: pairPlayers.map((item) => item.shirtSize), poolOverride: pairPlayers.find((item) => item.poolOverride != null)?.poolOverride ?? null, levelOverride: old?.levelOverride });
      }
      return { ...division, playerCount: entries.reduce((sum, entry) => sum + entry.players.length, 0), pairCount: entries.length, teamCount: entries.length, entries };
    }
    const teams = new Map<string, PlayerRegistration[]>();
    for (const player of players) {
      const team = player.teamName.trim() || "Unassigned Team";
      teams.set(team, [...(teams.get(team) ?? []), player]);
    }
    const entries = [...teams.entries()].map(([teamName, members]) => ({ id: `entry-${division.id}-${teamName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name: teamName, teamName, players: members.map((member) => member.name), registrationIds: members.map((member) => member.id), playerLevels: members.map((member) => member.playerLevel), desiredLevels: members.map((member) => member.desiredLevel), shirtSizes: members.map((member) => member.shirtSize), poolOverride: members.find((member) => member.poolOverride != null)?.poolOverride ?? null, levelOverride: division.entries.find((entry) => entry.teamName === teamName)?.levelOverride }));
    return { ...division, playerCount: players.length, teamCount: entries.length, pairCount: Math.ceil(players.length / Math.max(1, division.playersPerPair)), entries };
  });
  return { ...state, divisions };
}

export function hydrateTournament(input: TournamentState): TournamentState {
  const baseRegistrations = (input.registrations ?? []).map((registration) => ({ ...registration, partnerName: registration.partnerName ?? "", playerLevel: registration.playerLevel ?? "Beginner", desiredLevel: registration.desiredLevel ?? registration.playerLevel ?? "Beginner", poolOverride: registration.poolOverride ?? null }));
  const registrations: PlayerRegistration[] = [...baseRegistrations];
  for (const division of input.divisions ?? []) {
    if ((input.version ?? 1) >= 5 || !division.registrationManaged || registrations.some((registration) => registration.divisionId === division.id) || !division.entries?.length) continue;
    for (const entry of division.entries) {
      if (!entry.registrationIds?.length) continue;
      const memberIds = entry.players.map((_, index) => entry.registrationIds?.[index] ?? `recovered-${division.id}-${entry.id}-${index}`);
      entry.players.forEach((name, index) => {
        const pairStart = Math.floor(index / Math.max(1, division.playersPerPair ?? 2)) * Math.max(1, division.playersPerPair ?? 2);
        const pairIds = memberIds.slice(pairStart, pairStart + Math.max(1, division.playersPerPair ?? 2));
        const partnerId = division.mode === "doubles" && memberIds.length === 2 ? memberIds[index === 0 ? 1 : 0] : division.mode === "team" && pairIds.length === 2 ? pairIds[index % 2 === 0 ? 1 : 0] : null;
        registrations.push({
          ...makeRegistration(division.id, registrations.length),
          id: memberIds[index],
          name,
          partnerId,
          teamName: entry.teamName ?? "",
          playerLevel: entry.playerLevels?.[index] || "Beginner",
          desiredLevel: entry.desiredLevels?.[index] || entry.playerLevels?.[index] || "Beginner",
          shirtSize: entry.shirtSizes?.[index] || "M",
          poolOverride: entry.poolOverride ?? null,
        });
      });
    }
  }
  for (const player of registrations.slice()) {
    if (!player.partnerName.trim() || player.partnerId) continue;
    const existing = registrations.find((candidate) => candidate.id !== player.id && candidate.divisionId === player.divisionId && candidate.name.trim().toLowerCase() === player.partnerName.trim().toLowerCase());
    if (existing) {
      player.partnerId = existing.id;
      if (!existing.partnerId) existing.partnerId = player.id;
    } else {
      const partner = { ...makeRegistration(player.divisionId), id: `${player.id}-partner`, name: player.partnerName.trim(), partnerId: player.id, partnerName: "", playerLevel: player.playerLevel, desiredLevel: player.desiredLevel, selfRegistered: player.selfRegistered, poolOverride: player.poolOverride };
      registrations.push(partner);
      player.partnerId = partner.id;
    }
    player.partnerName = "";
  }
  const divisions = (input.divisions ?? []).map((division) => ({
    ...division,
    entries: (division.entries ?? []).map((entry) => ({ ...entry, playerLevels: entry.playerLevels ?? entry.players.map(() => ""), desiredLevels: entry.desiredLevels ?? entry.players.map(() => ""), shirtSizes: entry.shirtSizes ?? entry.players.map(() => "M"), poolOverride: entry.poolOverride ?? null })),
    playerCount: division.playerCount ?? (division.mode === "singles" ? division.entries.length : division.entries.reduce((sum, entry) => sum + entry.players.length, 0)),
    pairCount: division.pairCount ?? (division.mode === "doubles" ? division.entries.length : Math.ceil(division.entries.reduce((sum, entry) => sum + entry.players.length, 0) / Math.max(1, division.playersPerPair ?? 2))),
    groupMatchFormat: division.groupMatchFormat ?? "single_31",
    championshipMatchFormat: division.championshipMatchFormat ?? "best_of_3_21",
    customGroupGameCount: division.customGroupGameCount ?? Math.max(1, division.entries.length),
    subBracketCount: division.subBracketCount ?? 1,
    qualifiersPerSubBracket: division.qualifiersPerSubBracket ?? 1,
    knockoutSize: division.knockoutSize ?? 8,
    manualChampionshipMatchups: division.manualChampionshipMatchups ?? false,
    registrationManaged: division.registrationManaged ?? registrations.some((registration) => registration.divisionId === division.id),
  }));
  const formatByDivision = new Map(divisions.map((division) => [division.id, division]));
  const usedPins = new Set<string>();
  const matches = (input.matches ?? []).map((match) => {
    let matchPin = /^\d{4}$/.test(match.pin ?? "") && !usedPins.has(match.pin) ? match.pin : "";
    for (let attempt = 0; !matchPin && attempt < 100; attempt++) {
      const candidate = String(Math.floor(1000 + Math.random() * 9000));
      if (!usedPins.has(candidate)) matchPin = candidate;
    }
    if (matchPin) usedPins.add(matchPin);
    return { ...match, pin: matchPin, format: match.format ?? (match.stage === "regular" ? formatByDivision.get(match.divisionId)?.groupMatchFormat ?? "single_31" : formatByDivision.get(match.divisionId)?.championshipMatchFormat ?? "best_of_3_21") };
  });
  return { ...input, version: Math.max(5, input.version ?? 1), status: input.status ?? "setup", divisions, registrations, matches };
}

export function addDivision(state: TournamentState, name = `Division ${state.divisions.length + 1}`): TournamentState {
  return { ...state, divisions: [...state.divisions, makeDivision(name, "doubles")] };
}

export function duplicateDivision(state: TournamentState, divisionId: string): TournamentState {
  const source = state.divisions.find((division) => division.id === divisionId);
  if (!source) return state;
  const fresh = makeDivision(`${source.name} Copy`, source.mode);
  const duplicate = regenerateEntries({ ...source, id: fresh.id, name: fresh.name, entries: [], registrationManaged: true });
  return { ...state, divisions: [...state.divisions, duplicate] };
}

export function removeDivision(state: TournamentState, divisionId: string): TournamentState {
  if (state.divisions.length <= 1) return state;
  return {
    ...state,
    divisions: state.divisions.filter((division) => division.id !== divisionId),
    registrations: state.registrations.filter((registration) => registration.divisionId !== divisionId),
    matches: state.matches.filter((match) => match.divisionId !== divisionId),
  };
}

export function assignSchedule(state: TournamentState): TournamentState {
  const start = new Date(`${state.startDate}T${state.dayStart}:00`);
  const end = new Date(`${state.endDate}T${state.dayEnd}:00`);
  const duration = Math.max(5, state.gameDuration) * 60_000;
  const matches = state.matches.map((match, index) => {
    const slot = Math.floor(index / Math.max(1, state.courts));
    const time = new Date(start.getTime() + slot * duration);
    return { ...match, court: (index % Math.max(1, state.courts)) + 1, scheduledAt: time <= end ? time.toISOString() : null };
  });
  return { ...state, matches };
}

export function medalResults(state: TournamentState, divisionId: string) {
  const division = state.divisions.find((item) => item.id === divisionId);
  const entries = new Map(division?.entries.map((entry) => [entry.id, displayName(entry)]) ?? []);
  const goldMatch = state.matches.find((match) => match.divisionId === divisionId && match.stage === "gold" && match.validated);
  const bronzeMatch = state.matches.find((match) => match.divisionId === divisionId && match.stage === "bronze" && match.validated);
  const goldId = goldMatch ? matchWinner(goldMatch) : null;
  const silverId = goldMatch && goldId ? (goldMatch.entryAId === goldId ? goldMatch.entryBId : goldMatch.entryAId) : null;
  const bronzeId = bronzeMatch ? matchWinner(bronzeMatch) : null;
  const runnerUpId = bronzeMatch && bronzeId ? (bronzeMatch.entryAId === bronzeId ? bronzeMatch.entryBId : bronzeMatch.entryAId) : null;
  return [
    { medal: "Gold", entryId: goldId, name: goldId ? entries.get(goldId) : "TBD", points: state.medalPoints.gold },
    { medal: "Silver", entryId: silverId, name: silverId ? entries.get(silverId) : "TBD", points: state.medalPoints.silver },
    { medal: "Bronze", entryId: bronzeId, name: bronzeId ? entries.get(bronzeId) : "TBD", points: state.medalPoints.bronze },
    { medal: "Runner-Up", entryId: runnerUpId, name: runnerUpId ? entries.get(runnerUpId) : "TBD", points: state.medalPoints.runnerUp },
  ];
}

export function isCourtAvailable(state: TournamentState, court: number, matchId: string) {
  const target = state.matches.find((match) => match.id === matchId);
  return !state.matches.some((match) => {
    if (match.id === matchId || match.court !== court || match.status === "finished") return false;
    if (!match.scheduledAt || !target?.scheduledAt) return true;
    const gap = Math.abs(new Date(match.scheduledAt).getTime() - new Date(target.scheduledAt).getTime());
    return gap < Math.max(5, state.gameDuration) * 60_000;
  });
}
