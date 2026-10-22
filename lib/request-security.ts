/** Shared Worker boundary: never log credentials or payment request bodies. */
import { organizerPinMatches } from "./organizer-auth";

type Database = { prepare(sql: string): { bind(...values: unknown[]): { first<T>(): Promise<T | null>; run(): Promise<unknown> }; run(): Promise<unknown> } };
type Limit = { count: number; expires: number };
const WINDOW_MS = 900000;
export const PUBLIC_REGISTRATION_LIMIT = 300;
export const PUBLIC_REGISTRATION_ATTEMPTS = 1200;
const initialized = new WeakMap<Database, Promise<void>>();
const lastCleanup = new WeakMap<Database, number>();
const reject = (error: string, status: number) => Response.json({ error }, { status });

async function prepareLimits(db: Database, now: number) {
  let ready = initialized.get(db);
  if (!ready) {
    ready = (async () => {
      await db.prepare("CREATE TABLE IF NOT EXISTS request_limits (id TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)").run();
      await db.prepare("CREATE INDEX IF NOT EXISTS request_limits_expires ON request_limits(expires)").run();
    })();
    initialized.set(db, ready);
    ready.catch(() => initialized.delete(db));
  }
  await ready;
  if (now - (lastCleanup.get(db) || 0) >= 60000) {
    lastCleanup.set(db, now);
    try { await db.prepare("DELETE FROM request_limits WHERE expires <= ?").bind(now).run(); }
    catch (error) { lastCleanup.delete(db); throw error; }
  }
}
async function reserve(db: Database, key: string, limit: number, now: number) {
  // Atomic admission: parallel callers cannot all pass a separate SELECT precheck.
  return db.prepare("INSERT INTO request_limits (id, count, expires) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET count = CASE WHEN request_limits.expires <= ? THEN 1 ELSE request_limits.count + 1 END, expires = CASE WHEN request_limits.expires <= ? THEN excluded.expires ELSE request_limits.expires END WHERE request_limits.expires <= ? OR request_limits.count < ? RETURNING count, expires")
    .bind(key, now + WINDOW_MS, now, now, now, limit).first<Limit>();
}
async function recordFailure(db: Database, key: string, now: number) {
  await db.prepare("INSERT INTO request_limits (id, count, expires) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET count = CASE WHEN request_limits.expires <= ? THEN 1 ELSE request_limits.count + 1 END, expires = CASE WHEN request_limits.expires <= ? THEN excluded.expires ELSE request_limits.expires END").bind(key, now + WINDOW_MS, now, now).run();
}
function limited(message: string) {
  const response = reject(message, 429);
  response.headers.set("Retry-After", "900");
  return response;
}
export function securityHeaders(response: Response, api: boolean) {
  const result = new Response(response.body, response);
  result.headers.set("X-Content-Type-Options", "nosniff");
  result.headers.set("X-Frame-Options", "DENY");
  result.headers.set("Referrer-Policy", "no-referrer");
  result.headers.set("Strict-Transport-Security", "max-age=31536000");
  if (!result.headers.has("Content-Security-Policy")) result.headers.set("Content-Security-Policy", "frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  if (api) result.headers.set("Cache-Control", "private, no-store");
  return result;
}
export async function protectedRequest(request: Request, db: Database, next: (request: Request) => Promise<Response>): Promise<Response> {
  const url = new URL(request.url);
  let pathname: string;
  try { pathname = decodeURIComponent(url.pathname).replace(/\/{2,}/g, "/").replace(/\/+$/, ""); }
  catch { return securityHeaders(reject("Invalid request path.", 400), true); }
  const api = pathname.startsWith("/api/");
  if (!api) return securityHeaders(await next(request), false);
  const finish = (response: Response) => securityHeaders(response, true);
  let release: (() => Promise<void>) | undefined;
  try {
    const origin = request.headers.get("origin");
    if ((origin && origin !== url.origin) || request.headers.get("sec-fetch-site") === "cross-site") return finish(reject("Cross-site API requests are not allowed.", 403));
    let action = "", registrationCredential = false;
    const write = !["GET", "HEAD"].includes(request.method);
    if (write) {
      const image = ["/api/payment-proof", "/api/payment-settings", "/api/sponsors"].includes(pathname) && request.headers.get("content-type") === "image/png";
      const limit = image || request.method === "PUT" ? 2 * 1024 * 1024 : 16 * 1024;
      if (Number(request.headers.get("content-length") || 0) > limit) return finish(reject("Request is too large.", 413));
      const chunks: Uint8Array[] = []; let length = 0;
      const reader = request.body?.getReader();
      if (reader) while (true) {
        const { value, done } = await reader.read(); if (done) break;
        length += value.length;
        if (length > limit) { await reader.cancel(); return finish(reject("Request is too large.", 413)); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      if (length && !image) {
        if (!request.headers.get("content-type")?.startsWith("application/json")) return finish(reject("JSON is required.", 415));
        try {
          const body = JSON.parse(new TextDecoder().decode(bytes));
          if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
          action = typeof body.action === "string" ? body.action : "";
          registrationCredential = Boolean(body.pin || body.registration?.sourceRegistrationId);
        } catch { return finish(reject("Invalid JSON request.", 400)); }
      }
      request = new Request(request, { body: length ? bytes : null });
    }
    const registering = pathname === "/api/state" && request.method === "POST" && action === "registerPlayer";
    const credentials = request.headers.has("x-umpire-pin") || request.headers.has("x-organizer-pin") || request.headers.has("x-registration-pin");
    const authRequest = credentials || write && (!registering || registrationCredential);
    const now = Date.now();
    let authKey = "";
    if (authRequest || registering) {
      await prepareLimits(db, now);
      // Cloudflare supplies this address. Do not trust X-Forwarded-For.
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(request.headers.get("cf-connecting-ip") || "local"));
      const identity = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      authKey = "auth:" + identity;
      if (authRequest) {
        const row = await db.prepare("SELECT count, expires FROM request_limits WHERE id = ?").bind(authKey).first<Limit>();
        if (row && row.expires > now && row.count >= 15) return finish(limited("Too many attempts. Please try again in 15 minutes."));
      }
      let organizer = false;
      if (registering && request.headers.has("x-organizer-pin")) {
        const row = await db.prepare("SELECT payload FROM tournament_state WHERE id = ?").bind("racketeers").first<{ payload: string }>();
        organizer = await organizerPinMatches(request.headers.get("x-organizer-pin"), row ? JSON.parse(row.payload).organizerPinHash : undefined);
        if (!organizer) { await recordFailure(db, authKey, now); return finish(reject("Organizer PIN did not match.", 401)); }
      }
      if (registering && !organizer) {
        if (!await reserve(db, "registration-attempts:" + identity, PUBLIC_REGISTRATION_ATTEMPTS, now)) return finish(limited("Too many registration attempts from this network. Please try again in 15 minutes or ask the organizer."));
        const key = "registration-success:" + identity;
        const slot = await reserve(db, key, PUBLIC_REGISTRATION_LIMIT, now);
        if (!slot) return finish(limited("This network's registration allowance is busy. Please try again in 15 minutes or ask the organizer."));
        release = async () => { await db.prepare("UPDATE request_limits SET count = count - 1 WHERE id = ? AND expires = ? AND count > 0").bind(key, slot.expires).run(); };
      }
    }
    const response = await next(request);
    if (authKey && (response.status === 401 || response.status === 403)) await recordFailure(db, authKey, now);
    if (response.ok) release = undefined;
    return finish(response);
  } catch { return finish(reject("Request could not be processed. Please try again.", 503)); }
  finally {
    // Only failed submissions refund a reserved success slot. Accounting failure must
    // never turn a committed registration into a retry-inducing 503 response.
    if (release) { try { await release(); } catch { /* Retain the slot until expiry. */ } }
  }
}
