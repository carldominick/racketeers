import { createStateHandlers } from "../../../lib/state-handlers";
export const handlers = createStateHandlers({
  database: async () => (await import("cloudflare:workers")).env.DB,
  initialPin: async () => (await import("cloudflare:workers")).env.INITIAL_ORGANIZER_PIN,
  umpireSecret: async () => (await import("cloudflare:workers")).env.UMPIRE_CREDENTIAL_SECRET ?? "",
});
export const GET = handlers.GET;
export const POST = handlers.POST;
export const PUT = handlers.PUT;
export const PATCH = handlers.PATCH;
