import { handlePaymentSettings } from "../../../lib/payment-proof-server";
async function handle(request: Request) {
  const { env } = await import("cloudflare:workers");
  return handlePaymentSettings(request, env);
}
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
