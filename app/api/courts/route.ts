import { GET as getState } from "../state/route";
import { courtViewSnapshot } from "../../../lib/court-view";

export async function GET(request: Request) {
  // Deliberately discard all credentials. This endpoint is always public-safe.
  const response = await getState(new Request(new URL("/api/state", request.url)));
  if (!response.ok) return Response.json({ error: "Court information is unavailable." }, { status: 503 });
  const { state } = await response.json();
  return Response.json(courtViewSnapshot(state), { headers: { "Cache-Control": "private, no-store" } });
}
