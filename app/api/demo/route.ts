import { authorizeDemo } from "../../../lib/demo-access";
export async function POST(request: Request) {
  const { env } = await import("cloudflare:workers");
  return authorizeDemo(request, env);
}
