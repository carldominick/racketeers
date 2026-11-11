import { organizerRequestMatches } from "./organizer-accounts";
import type { ProofEnvironment } from "./payment-proof-server";
import { sponsorImageUrl } from "./sponsors";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
const validId = (id: string) => /^[a-f0-9-]{36}$/.test(id);
type Row = { id: string; name: string; created_at: string };
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
declare const FixedLengthStream: new (length: number) => TransformStream<Uint8Array, Uint8Array>;

function sponsorPngStream(length: number) {
  const head = new Uint8Array(24);
  const tail = new Uint8Array(12);
  let received = 0;
  let error = "";
  const invalid = (message: string): never => {
    error = message;
    throw new Error(message);
  };
  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (received < head.length) {
        head.set(chunk.subarray(0, head.length - received), received);
        if (received + chunk.length >= head.length) {
          if (!pngSignature.every((byte, index) => head[index] === byte) || String.fromCharCode(...head.subarray(12, 16)) !== "IHDR") invalid("Invalid PNG image.");
          const view = new DataView(head.buffer);
          const width = view.getUint32(16), height = view.getUint32(20);
          if (!width || !height || width * height > 24_000_000) invalid("Image dimensions are too large.");
        }
      }
      received += chunk.length;
      if (received > length) invalid("The PNG did not match its declared size.");
      if (chunk.length >= tail.length) tail.set(chunk.subarray(chunk.length - tail.length));
      else {
        tail.copyWithin(0, chunk.length);
        tail.set(chunk, tail.length - chunk.length);
      }
      controller.enqueue(chunk);
    },
    flush() {
      if (received !== length) invalid("The PNG did not match its declared size.");
      if (received < 45 || String.fromCharCode(...tail.subarray(4, 8)) !== "IEND") invalid("Invalid PNG image.");
    },
  });
  return { stream, get error() { return error; } };
}

type SponsorBucket = Omit<NonNullable<ProofEnvironment["PAYMENT_PROOFS"]>, "put"> & {
  put(key: string, value: ReadableStream<Uint8Array>, options: { httpMetadata: { contentType: string; contentDisposition: string } }): Promise<unknown>;
};
// A separate append-only library avoids stale tournament/score saves replacing uploads.
export type SponsorEnvironment = {
  PAYMENT_PROOFS?: SponsorBucket;
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
      const row = await env.DB.prepare("SELECT payload FROM tournament_state WHERE id = ?").bind("racketeers").first<{ payload: string }>();
      if (!row || !await organizerRequestMatches(request, env.DB, JSON.parse(row.payload), pin)) return reply({ error: "Organizer PIN did not match." }, 401);
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
    const declared = request.headers.get("content-length") || request.headers.get("x-sponsor-size") || "";
    const length = Number(declared);
    if (!/^\d+$/.test(declared) || !Number.isSafeInteger(length)) return reply({ error: "The sponsor upload needs a declared byte length." }, 411);
    if (!request.body || length < 45) return reply({ error: "Invalid PNG image." }, 415);
    const validator = sponsorPngStream(length);
    // R2 requires a known-length stream. Disposable browser/Node fixtures use ordinary streams.
    const fixed = typeof FixedLengthStream === "undefined" ? new TransformStream<Uint8Array, Uint8Array>() : new FixedLengthStream(length);
    const newId = crypto.randomUUID();
    const writing = request.body.pipeThrough(validator.stream).pipeTo(fixed.writable);
    try {
      await Promise.all([writing, env.PAYMENT_PROOFS.put(`sponsors/${newId}.png`, fixed.readable, { httpMetadata: { contentType: "image/png", contentDisposition: 'inline; filename="sponsor.png"' } })]);
    } catch (error) {
      if (validator.error) return reply({ error: validator.error }, 415);
      throw error;
    }
    await env.DB.prepare("INSERT INTO sponsor_images (id, name, created_at) VALUES (?, ?, ?)").bind(newId, name, new Date().toISOString()).run();
    return reply({ image: { id: newId, name, url: sponsorImageUrl(newId) } }, 201);
  } catch { return reply({ error: "Sponsor images could not be processed. Please try again." }, 500); }
}
