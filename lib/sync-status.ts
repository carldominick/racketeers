import type { TournamentState } from "./tournament";

export type SyncStatus = "connecting" | "saved" | "saving" | "offline";
export const SYNC_LABELS = { connecting: "Connecting…", saved: "Synced", saving: "Saving…", offline: "Offline", stale: "Update delayed" } as const;

export const STAFF_POLL_MS = 2000;
export const POLL_TIMEOUT_MS = 10000;

export function pollFailure(previousFailures: number, now: number, retryAfter: string | null = null) {
  const failures = Math.min(previousFailures + 1, 6);
  const backoff = Math.min(30000, STAFF_POLL_MS * 2 ** (failures - 1));
  const serverDelay = retryAfter === null ? 0 : /^\d+$/.test(retryAfter)
    ? Number(retryAfter) * 1000
    : Date.parse(retryAfter) - now;
  return { failures, retryAt: now + Math.max(backoff, Number.isFinite(serverDelay) ? serverDelay : 0), unavailable: failures >= 3 };
}

export function syncDisplayState(status: SyncStatus, confirmedAt: number, now: number, pollingMs: number): keyof typeof SYNC_LABELS {
  if (status !== "saved") return status;
  if (!confirmedAt) return "connecting";
  const staleAfter = Math.max(pollingMs * 3 + 5000, POLL_TIMEOUT_MS + pollingMs * 2 + 5000);
  return now - confirmedAt > staleAfter ? "stale" : "saved";
}
export async function readStateResponse(response: Response): Promise<{ state: TournamentState; revision: number; organizer: boolean }> {
  if (!response.ok) throw new Error("State refresh failed.");
  const data = await response.json();
  if (!data?.state || !Array.isArray(data.state.matches) || !Array.isArray(data.state.divisions) || !Number.isInteger(data.revision) || data.revision < 0) throw new Error("Invalid state response.");
  return data;
}
