import { organizerPinMatches } from "./organizer-auth";
import type { ProofEnvironment } from "./payment-proof-server";
export async function authorizeDemo(request: Request, env: Pick<ProofEnvironment, "DB">) {
  const headers = { "Cache-Control": "private, no-store" };
  if (request.method !== "POST") return Response.json({ error: "Use organizer access to start a demo." }, { status: 405, headers });
  const row = await env.DB.prepare("SELECT payload FROM tournament_state WHERE id = ?").bind("racketeers").first<{payload: string}>();
  if (!await organizerPinMatches(request.headers.get("x-organizer-pin"), row ? JSON.parse(row.payload).organizerPinHash : undefined)) return Response.json({ error: "A valid organizer PIN is required." }, { status: 401, headers });
  return Response.json({ authorized: true, expiresAt: Date.now() + 30 * 60_000 }, { headers });
}
