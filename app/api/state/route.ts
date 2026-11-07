import { createStateHandlers } from "../../../lib/state-handlers";
const handlers = createStateHandlers({
  database: async () => (await import("cloudflare:workers")).env.DB,
  initialPin: async () => (await import("cloudflare:workers")).env.INITIAL_ORGANIZER_PIN,
});
export const GET = handlers.GET;
export const POST = handlers.POST;
export const PUT = handlers.PUT;
export const PATCH = handlers.PATCH;
