import type { TournamentState } from "./tournament";

export type SyncStatus = "connecting" | "saved" | "saving" | "offline";
export const SYNC_LABELS = { connecting: "Connecting…", saved: "Synced", saving: "Saving…", offline: "Offline", stale: "Update delayed" } as const;

export function syncDisplayState(status: SyncStatus, confirmedAt: number, now: number, pollingMs: number): keyof typeof SYNC_LABELS {
  if (status !== "saved") return status;
  if (!confirmedAt) return "connecting";
  return now - confirmedAt > pollingMs * 3 + 5000 ? "stale" : "saved";
}
export async function readStateResponse(response: Response): Promise<{ state: TournamentState; revision: number; organizer: boolean }> {
  if (!response.ok) throw new Error("State refresh failed.");
  const data = await response.json();
  if (!data?.state || !Array.isArray(data.state.matches) || !Array.isArray(data.state.divisions) || !Number.isInteger(data.revision) || data.revision < 0) throw new Error("Invalid state response.");
  return data;
}
