import { handlePaymentProof } from "../../../lib/payment-proof-server";

async function handle(request: Request) {
  const { env } = await import("cloudflare:workers");
  return handlePaymentProof(request, env);
}
export const GET = handle;
export const POST = handle;
