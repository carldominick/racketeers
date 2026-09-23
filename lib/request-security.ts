/** Shared Worker boundary: never log credentials or payment request bodies. */
type Database = { prepare(sql: string): { bind(...values: unknown[]): { first<T>(): Promise<T | null>; run(): Promise<unknown> }; run(): Promise<unknown> } };
const reject = (error: string, status: number) => Response.json({ error }, { status });
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
  const api = url.pathname.startsWith("/api/");
  if (!api) return securityHeaders(await next(request), false);
  const finish = (response: Response) => securityHeaders(response, true);
  try {
    const origin = request.headers.get("origin");
    if ((origin && origin !== url.origin) || request.headers.get("sec-fetch-site") === "cross-site") return finish(reject("Cross-site API requests are not allowed.", 403));
    let action = "";
    if (!["GET", "HEAD"].includes(request.method)) {
      const image = request.headers.get("content-type") === "image/png";
      const limit = image ? 2 * 1024 * 1024 : request.method === "PUT" ? 2 * 1024 * 1024 : 16 * 1024;
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
        try { const body = JSON.parse(new TextDecoder().decode(bytes)); if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(); action = body.action || ""; }
        catch { return finish(reject("Invalid JSON request.", 400)); }
      }
      request = new Request(request, { body: length ? bytes : null });
    }
    const credentialRequest = request.headers.has("x-umpire-pin") || request.headers.has("x-organizer-pin") || request.headers.has("x-registration-pin") || url.pathname === "/api/state" && request.method !== "GET";
    const registering = action === "registerPlayer";
    let key = ""; const now = Date.now();
    if (credentialRequest) {
      // Cloudflare overwrites this header at the edge; never trust X-Forwarded-For.
      const ip = request.headers.get("cf-connecting-ip") || "local";
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
      key = `${registering ? "registration" : "auth"}:${Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("")}`;
      await db.prepare("CREATE TABLE IF NOT EXISTS request_limits (id TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)").run();
      const row = await db.prepare("SELECT count, expires FROM request_limits WHERE id = ?").bind(key).first<{count:number;expires:number}>();
      if (row && row.expires > now && row.count >= (registering ? 30 : 15)) {
        const response = reject("Too many attempts. Please try again in 15 minutes.", 429); response.headers.set("Retry-After", "900"); return finish(response);
      }
    }
    const response = await next(request);
    if (key && (registering || response.status === 401 || response.status === 403)) {
      await db.prepare("INSERT INTO request_limits (id, count, expires) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET count = CASE WHEN request_limits.expires <= ? THEN 1 ELSE request_limits.count + 1 END, expires = CASE WHEN request_limits.expires <= ? THEN excluded.expires ELSE request_limits.expires END").bind(key, now + 900000, now, now).run();
      await db.prepare("DELETE FROM request_limits WHERE expires <= ?").bind(now).run();
    }
    return finish(response);
  } catch { return finish(reject("Request could not be processed. Please try again.", 503)); }
}

export function philippinesAccess(request: Request): Response | null {
  const url = new URL(request.url);
  const cf = (request as Request & { cf?: { country?: string } }).cf;
  // Only local development bypasses geography; missing production location fails closed.
  if (!cf && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return null;
  if (cf?.country === "PH") return null;
  const message = "Racketeers is available only to visitors connecting from the Philippines.";
  const response = url.pathname.startsWith("/api/") ? reject(message, 403) : new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Access restricted · Racketeers</title><body><main><h1>Access restricted</h1><p>${message}</p><p>If you are in the Philippines, disable any overseas VPN or try your local mobile connection.</p></main></body></html>`, { status: 403, headers: { "Content-Type": "text/html; charset=utf-8" } });
  response.headers.set("Cache-Control", "private, no-store");
  return securityHeaders(response, url.pathname.startsWith("/api/"));
}
