import type { SetScore } from "./tournament";

export type UmpireMember = {
  id: string;
  name: string;
  inactive?: boolean;
  court?: number;
  onDuty?: boolean;
  pinKey?: string;
  pinHash?: string;
  session?: { hash: string; expires: number };
};

export type UmpireDirectory = { scope: string; members: UmpireMember[]; issuedKeys?: string[] };
export type UmpirePhase = "assigned" | "seen" | "incorrect_players" | "playing" | "awaiting_confirmation" | "disputed" | "escalated" | "completed" | "finalized_by_ruling" | "voided";
export type ScoreAudit = { at: string; actor: string; reason: string; before: SetScore[]; after: SetScore[] };
export type UmpireWorkflow = {
  phase: UmpirePhase;
  umpireId: string;
  court: number;
  version: number;
  lastScoreOperation?: string;
  assignedAt: string;
  seenAt?: string;
  startedAt?: string;
  releasedAt?: string;
  confirmed?: { a: true; b: true; at: string; umpireId: string };
  dispute?: { side: "a" | "b" | "both"; reason: string; notes: string; at: string; umpireId: string; scores: SetScore[]; escalatedAt?: string; resolvedAt?: string };
  priorDisputes?: NonNullable<UmpireWorkflow["dispute"]>[];
  playerIssue?: { note: string; at: string; umpireId: string; resolvedAt?: string; resolvedBy?: string };
  scoreHistory?: ScoreAudit[];
  setHistory?: { at: string; umpireId: string; index: number; score: SetScore; reopened?: boolean }[];
  handoffs?: { at: string; from: string; to: string; actor: string; reason: string }[];
  ruling?: { at: string; actor: string; reason: string; outcome: "finalized" | "voided" | "replay" };
};

export type UmpireSummary = Pick<UmpireMember, "id" | "name" | "inactive" | "court" | "onDuty"> & { credential: boolean; connected: boolean };

export function provisionalWorkflow(workflow?: UmpireWorkflow) {
  return Boolean(workflow && !["completed", "finalized_by_ruling", "voided"].includes(workflow.phase));
}
