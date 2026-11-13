import { courtOccupant, gameEligibility } from "./game-day";
import { appendStaffNotification } from "./staff-events";
import { isSetWon, matchScoreLimit, matchWinner, reseedChampionships, scoringRule, type Match, type SetScore, type TournamentState } from "./tournament";
import type { UmpireWorkflow } from "./umpire-types";

export const PRESENCE_GRACE_MS = 45_000;
export type Presence = Record<string, number>;

export function staffingIssue(state: TournamentState, court: number, presence: Presence, now = Date.now()) {
  const umpire = state.umpireDirectory?.members.find(member => member.court === court && !member.inactive);
  if (!umpire) return "Assign an umpire to this court.";
  if (!umpire.onDuty) return "The assigned umpire is off duty.";
  if (!umpire.session || umpire.session.expires <= now || now - (presence[umpire.session.hash] ?? 0) >= PRESENCE_GRACE_MS) return "The assigned umpire is disconnected.";
  if (state.courtHelp?.[court]) return "Clear the court help request before assigning a game.";
  return "";
}

export class UmpireError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

export function requireUmpire(condition: unknown, message: string, status?: number): asserts condition {
  if (!condition) throw new UmpireError(message, status);
}

export const workflowText: Record<UmpireWorkflow["phase"], string> = {
  assigned: "Assigned", seen: "Acknowledged", incorrect_players: "Incorrect players reported", playing: "In play",
  awaiting_confirmation: "Awaiting team confirmation", disputed: "Score disputed", escalated: "Escalated to organizer",
  completed: "Confirmed by both teams", finalized_by_ruling: "Finalized by ruling", voided: "Voided",
};

/** Accept only scores compatible with the existing match rules and a consecutive set order. */
function checkedSets(match: Match, input: unknown, final: boolean): SetScore[] {
  const max = match.format === "best_of_3_21" ? 3 : 1;
  requireUmpire(Array.isArray(input) && input.length > 0 && input.length <= max, "Enter a valid score for each set.", 400);
  const rule = scoringRule(match.format, match.scoring);
  let open = false, aWins = 0, bWins = 0;
  const sets = input.map((item: unknown) => {
    requireUmpire(item && typeof item === "object", "Invalid set.", 400);
    const { a, b, complete } = item as SetScore;
    requireUmpire(Number.isInteger(a) && a >= 0 && Number.isInteger(b) && b >= 0 && typeof complete === "boolean", "Invalid set score.", 400);
    const set = { a, b, complete };
    requireUmpire(a <= matchScoreLimit(match, set, "a") && b <= matchScoreLimit(match, set, "b") && !(a === b && a >= (rule.mode === "first_to_target" ? rule.target : rule.cap)), "Score exceeds the set rules.", 400);
    if (open || aWins >= (max === 3 ? 2 : 1) || bWins >= (max === 3 ? 2 : 1)) requireUmpire(!a && !b && !complete, "Only the current set can be played.", 400);
    if (complete) {
      requireUmpire(isSetWon(set, match.stage, match.format, match.scoring), "Complete sets must have a legal winning score.", 400);
      if (a > b) aWins++;
      else bWins++;
    } else open = true;
    return set;
  });
  if (final) requireUmpire(matchWinner({ ...match, sets }), "Enter a complete winning score.", 400);
  return sets;
}

export type WorkflowInput = {
  action?: string; matchId?: string; umpireId?: string; name?: string; pin?: string; court?: number;
  onDuty?: boolean; inactive?: boolean; expectedRevision?: number; version?: number; operation?: string;
  note?: string; reason?: string; side?: string; sets?: unknown; a?: boolean; b?: boolean; clear?: boolean;
  outcome?: string;
};

export function applyWorkflowAction(state: TournamentState, match: Match, body: WorkflowInput, actor: string, organizer: boolean, now: number): TournamentState {
  const flow = match.umpireWorkflow;
  requireUmpire(flow && !match.hold && !match.forfeit, "This game is no longer assigned.");
  if (!organizer && body.action === "submit" && flow.phase === "completed" && flow.confirmed?.umpireId === actor) return state;
  if (!organizer) requireUmpire(flow.umpireId === actor && !flow.releasedAt, "This game is no longer assigned to you.", 403);
  if (body.action === "score" && body.operation && flow.lastScoreOperation === body.operation) return state;
  requireUmpire(body.version === flow.version, "This game changed. Review the latest score before trying again.");
  const at = new Date(now).toISOString();
  const next: Match = { ...match };
  const changed: UmpireWorkflow = { ...flow, version: flow.version + 1 };
  next.umpireWorkflow = changed;
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 600) : "";
  const release = () => {
    changed.releasedAt = at;
    next.courtInUse = false;
    next.dispatchedAt = undefined;
  };
  const finalize = (phase: "completed" | "finalized_by_ruling") => {
    changed.phase = phase;
    if (changed.dispute) changed.dispute = { ...changed.dispute, resolvedAt: at };
    next.status = "finished";
    next.validated = true;
    next.completedAt = at;
    if (!flow.releasedAt) release();
  };
  const correct = (requireWinner: boolean) => {
    const sets = checkedSets(match, body.sets, requireWinner);
    changed.scoreHistory = [...(flow.scoreHistory ?? []), { at, actor, reason, before: match.sets, after: sets }];
    changed.confirmed = undefined;
    next.sets = sets;
  };
  if (organizer) {
    switch (body.action) {
      case "resolvePlayers":
        requireUmpire(flow.phase === "incorrect_players" && reason, "Record how the player issue was resolved.");
        changed.playerIssue = { ...flow.playerIssue!, resolvedAt: at, resolvedBy: actor, note: flow.playerIssue!.note + " · Resolution: " + reason };
        changed.phase = "seen";
        changed.seenAt ??= at;
        break;
      case "requeuePlayers":
        requireUmpire(flow.phase === "incorrect_players" && reason && body.clear === true, "Explain the player issue and confirm the court is clear.");
        changed.playerIssue = { ...flow.playerIssue!, resolvedAt: at, resolvedBy: actor, note: flow.playerIssue!.note + " · Returned to queue: " + reason };
        release();
        next.status = "ready";
        next.court = null;
        next.umpireWorkflow = undefined;
        next.umpireHistory = [...(match.umpireHistory ?? []), changed];
        break;
      case "returnDispute":
        requireUmpire(flow.phase === "escalated" && !flow.releasedAt && reason, "Return the game with a reason while its court is still held.");
        changed.phase = "disputed";
        changed.scoreHistory = [...(flow.scoreHistory ?? []), { at, actor, reason, before: match.sets, after: match.sets }];
        break;
      case "releaseDispute":
        requireUmpire(flow.phase === "escalated" && !flow.releasedAt && body.clear === true, "Confirm the court is clear before releasing it.");
        release();
        break;
      case "rule":
        requireUmpire(flow.phase === "escalated" && reason && (flow.releasedAt || body.clear === true), "Provide a ruling reason and confirm the court is clear.");
        requireUmpire(["finalized", "voided", "replay"].includes(body.outcome ?? ""), "Select an official outcome.", 400);
        changed.ruling = { at, actor, reason, outcome: body.outcome as "finalized" | "voided" | "replay" };
        if (body.outcome === "finalized") {
          correct(true);
          finalize("finalized_by_ruling");
        } else {
          changed.phase = "voided";
          if (changed.dispute) changed.dispute = { ...changed.dispute, resolvedAt: at };
          next.status = "finished";
          if (!flow.releasedAt) release();
        }
        break;
      default: throw new UmpireError("Unsupported organizer action.", 400);
    }
  } else {
    switch (body.action) {
      case "acknowledge":
        requireUmpire(flow.phase === "assigned", "This game is already acknowledged.");
        changed.phase = "seen";
        changed.seenAt = at;
        break;
      case "incorrectPlayers":
        requireUmpire(["assigned", "seen"].includes(flow.phase) && note, "Describe which players are incorrect.");
        changed.phase = "incorrect_players";
        changed.playerIssue = { at, umpireId: actor, note };
        break;
      case "start": {
        requireUmpire(flow.phase === "seen", "Acknowledge the assignment and resolve any player issue first.");
        const eligible = gameEligibility(state, match, now, true);
        requireUmpire(eligible.ready, eligible.reason);
        changed.phase = "playing";
        changed.startedAt = at;
        next.status = "live";
        next.courtInUse = true;
        break;
      }
      case "score": {
        requireUmpire(flow.phase === "playing", "This game is not open for scoring.");
        requireUmpire(typeof body.operation === "string" && /^[a-f0-9-]{36}$/i.test(body.operation), "Invalid score update.", 400);
        const sets = checkedSets(match, body.sets, false);
        for (const [index, previous] of match.sets.entries()) {
          const incoming = sets[index];
          requireUmpire(incoming || !previous.complete && !previous.a && !previous.b, "Existing scores cannot be removed.", 400);
          if (!incoming) continue;
          if (previous.complete) requireUmpire(incoming.a === previous.a && incoming.b === previous.b, "Unlock a completed set before correcting it.");
          if (isSetWon(previous, match.stage, match.format, match.scoring)) requireUmpire(incoming.a <= previous.a && incoming.b <= previous.b, "Subtract points before changing a winning score.");
        }
        next.sets = sets;
        const setChanges = sets.flatMap((set, index) => set.complete !== Boolean(match.sets[index]?.complete)
          ? [{ at, umpireId: actor, index, score: set, ...(set.complete ? {} : { reopened: true }) }]
          : []);
        if (setChanges.length) changed.setHistory = [...(flow.setHistory ?? []), ...setChanges];
        changed.lastScoreOperation = body.operation;
        if (matchWinner(next)) changed.phase = "awaiting_confirmation";
        break;
      }
      case "submit":
        requireUmpire(flow.phase === "awaiting_confirmation" && body.a === true && body.b === true && body.clear === true && matchWinner(match), "Both teams must confirm the score and the court must be clear.");
        changed.confirmed = { a: true, b: true, at, umpireId: actor };
        finalize("completed");
        break;
      case "reportDispute":
        requireUmpire(flow.phase === "awaiting_confirmation", "A final score is needed before reporting a dispute.");
        requireUmpire(body.side === "a" || body.side === "b" || body.side === "both", "Choose the disputing team.", 400);
        requireUmpire(["Incorrect recorded score", "Disagreement over a point", "Incorrect outcome", "Other disagreement"].includes(reason), "Choose a dispute reason.", 400);
        if (flow.dispute) changed.priorDisputes = [...(flow.priorDisputes ?? []), flow.dispute];
        changed.dispute = { side: body.side, reason, notes: note, at, umpireId: actor, scores: match.sets };
        changed.phase = "disputed";
        changed.confirmed = undefined;
        break;
      case "correct":
        requireUmpire(flow.phase === "disputed" && reason, "Enter a reason for the correction.");
        correct(true);
        changed.phase = "awaiting_confirmation";
        break;
      case "escalate":
        requireUmpire(flow.phase === "disputed" && flow.dispute, "Report a dispute before escalating.");
        changed.phase = "escalated";
        changed.dispute = { ...flow.dispute, escalatedAt: at };
        break;
      default: throw new UmpireError("Unsupported umpire action.", 400);
    }
  }
  const courtHelp = { ...state.courtHelp };
  if (!flow.releasedAt && changed.releasedAt && courtHelp[flow.court]?.matchId === match.id) delete courtHelp[flow.court];
  let result: TournamentState = { ...state, courtHelp, matches: state.matches.map(item => item.id === match.id ? next : item) };
  if (!flow.releasedAt && changed.releasedAt) result = appendStaffNotification(result, { kind: "court_released", court: flow.court, matchId: match.id, matchLabel: match.label, gameComplete: next.validated, available: !courtOccupant(result, flow.court) });
  if (changed.ruling?.outcome === "replay") {
    requireUmpire(!state.matches.some(item => item.id !== match.id && item.divisionId === match.divisionId && item.round > match.round && (item.status !== "ready" || item.dispatchedAt)), "A dependent round has already been assigned or started.");
    const replay: Match = { ...next, status: "ready", court: null, sets: [{ a: 0, b: 0, complete: false }], validated: false, umpireWorkflow: undefined, completedAt: undefined, nearCapNotified: false, umpireHistory: [...(match.umpireHistory ?? []), changed] };
    result.matches = result.matches.map(item => item.id === match.id ? replay : item);
  }
  return next.validated ? reseedChampionships(result) : result;
}
