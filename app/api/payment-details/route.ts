import { handlePaymentDetails } from "../../../lib/payment-details-server";
async function handle(request: Request) {
  const { env } = await import("cloudflare:workers");
  return handlePaymentDetails(request, env);
}
export const GET = handle;
export const POST = handle;
