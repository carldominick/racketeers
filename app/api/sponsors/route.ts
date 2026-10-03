import { handleSponsors } from "../../../lib/sponsor-server";
async function handle(request: Request) {
  const { env } = await import("cloudflare:workers");
  return handleSponsors(request, env);
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
