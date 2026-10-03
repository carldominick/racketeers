import type { ProofEnvironment } from "./payment-proof-server";
import { MAX_SPONSOR_BYTES, sponsorImageUrl } from "./sponsors";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
const validId = (id: string) => /^[a-f0-9-]{36}$/.test(id);
type Row = { id: string; name: string; created_at: string };
// A separate append-only library avoids stale tournament/score saves replacing uploads.
export type SponsorEnvironment = Omit<ProofEnvironment, "DB"> & {
  DB: { prepare(sql: string): {
    run(): Promise<unknown>;
    all<T>(): Promise<{ results: T[] }>;
    bind(...values: unknown[]): { first<T>(): Promise<T | null>; run(): Promise<unknown> };
  } };
};
export async function handleSponsors(request: Request, env: SponsorEnvironment): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (!["GET", "POST", "DELETE"].includes(request.method)) return reply({ error: "Method not allowed." }, 405);
    if (request.method !== "GET") {
      const pin = request.headers.get("x-organizer-pin") || "";
      if (!/^\d{4,10}$/.test(pin)) return reply({ error: "Organizer access is required." }, 401);
      const row = await env.DB.prepare("SELECT payload FROM tournament_state WHERE id = ?").bind("racketeers").first<{ payload: string }>();
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin));
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      if (!row || JSON.parse(row.payload).organizerPinHash !== hash) return reply({ error: "Organizer PIN did not match." }, 401);
    }
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS sponsor_images (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL)").run();
    const id = url.searchParams.get("image") || "";
    if (id || request.method === "DELETE") {
      if (!validId(id)) return reply({ error: "Invalid sponsor image." }, 400);
      const row = await env.DB.prepare("SELECT id, name, created_at FROM sponsor_images WHERE id = ?").bind(id).first<Row>();
      if (!row) return reply({ error: "Sponsor image not found." }, 404);
      if (request.method === "DELETE") {
        // Remove public access first. Retain the object for recovery; never touch receipt keys.
        await env.DB.prepare("DELETE FROM sponsor_images WHERE id = ?").bind(id).run();
        return reply({ ok: true });
      }
      if (request.method !== "GET") return reply({ error: "Upload new sponsor images without an image ID." }, 400);
      const object = await env.PAYMENT_PROOFS?.get(`sponsors/${id}.png`);
      if (!object) return reply({ error: "Sponsor image not found." }, 404);
      return new Response(object.body, { headers: { ...headers, "Content-Type": "image/png", "Content-Disposition": 'inline; filename="sponsor.png"', "Content-Security-Policy": "default-src 'none'; sandbox" } });
    }
    if (request.method === "GET") {
      const { results } = await env.DB.prepare("SELECT id, name, created_at FROM sponsor_images ORDER BY created_at, id").all<Row>();
      return reply({ enabled: Boolean(env.PAYMENT_PROOFS), images: results.map(row => ({ id: row.id, name: row.name, url: sponsorImageUrl(row.id) })) });
    }
    if (!env.PAYMENT_PROOFS) return reply({ error: "Sponsor image storage is unavailable." }, 503);
    if (request.headers.get("content-type") !== "image/png") return reply({ error: "Upload a PNG image." }, 415);
    let name: string;
    try { name = decodeURIComponent(request.headers.get("x-sponsor-name") || "Sponsor").trim(); } catch { return reply({ error: "Invalid sponsor name." }, 400); }
    if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) return reply({ error: "Use a sponsor name of 1–100 characters." }, 400);
    if (Number(request.headers.get("content-length") || 0) > MAX_SPONSOR_BYTES) return reply({ error: "Image must be 2 MB or smaller." }, 413);
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = []; let length = 0;
    if (reader) while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > MAX_SPONSOR_BYTES) { await reader.cancel(); return reply({ error: "Image must be 2 MB or smaller." }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 45 || !signature.every((byte, index) => bytes[index] === byte) || String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR" || String.fromCharCode(...bytes.slice(-8, -4)) !== "IEND") return reply({ error: "Invalid PNG image." }, 415);
    const view = new DataView(bytes.buffer);
    const width = view.getUint32(16), height = view.getUint32(20);
    if (!width || !height || width * height > 24_000_000) return reply({ error: "Image dimensions are too large." }, 415);
    const newId = crypto.randomUUID();
    await env.PAYMENT_PROOFS.put(`sponsors/${newId}.png`, bytes, { httpMetadata: { contentType: "image/png", contentDisposition: 'inline; filename="sponsor.png"' } });
    await env.DB.prepare("INSERT INTO sponsor_images (id, name, created_at) VALUES (?, ?, ?)").bind(newId, name, new Date().toISOString()).run();
    return reply({ image: { id: newId, name, url: sponsorImageUrl(newId) } }, 201);
  } catch { return reply({ error: "Sponsor images could not be processed. Please try again." }, 500); }
}
