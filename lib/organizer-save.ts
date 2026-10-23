import type { TournamentState } from "./tournament";
export type OrganizerSaveResult = { kind: "saved"; state: TournamentState; revision: number } | { kind: "conflict"; state: TournamentState; revision: number; error: string };
/** A conflict is terminal for this attempt. Never resubmit an old snapshot at a newer revision. */
export async function writeOrganizerDraft(state: TournamentState, revision: number, pin: string, request: typeof fetch = fetch): Promise<OrganizerSaveResult> {
  const response = await request("/api/state", { method: "PUT", headers: { "content-type": "application/json", "x-organizer-pin": pin }, body: JSON.stringify({ state, expectedRevision: revision }), signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!data?.state || !Array.isArray(data.state.registrations) || !Array.isArray(data.state.matches) || !Number.isInteger(data.revision) || data.revision < revision) throw new Error(data?.error || "Unable to save. Your draft is retained.");
  if (response.status === 409) return { kind: "conflict", state: data.state, revision: data.revision, error: data.error || "Another device changed the tournament." };
  if (!response.ok) throw new Error(data.error || "Unable to save. Your draft is retained.");
  return { kind: "saved", state: data.state, revision: data.revision };
}
