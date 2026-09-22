import type { TournamentState } from "./tournament";

export const MAX_PROOF_BYTES = 2 * 1024 * 1024;
type StoredProof = { body?: ReadableStream; size: number; uploaded: Date };
export type ProofEnvironment = {
  DB: { prepare(sql: string): { bind(...values: unknown[]): { first<T>(): Promise<T | null>; run(): Promise<unknown> }; run(): Promise<unknown> } };
  PAYMENT_PROOFS?: {
    delete(key: string): Promise<unknown>;
    head(key: string): Promise<StoredProof | null>;
    get(key: string): Promise<StoredProof | null>;
    put(key: string, value: Uint8Array, options: { httpMetadata: { contentType: string; contentDisposition: string } }): Promise<unknown>;
  };
};
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
async function hash(pin: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin))), b => b.toString(16).padStart(2, "0")).join("");
}
async function boundedBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > MAX_PROOF_BYTES) { await reader.cancel(); throw new Error("oversize"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export async function handlePaymentProof(request: Request, env: ProofEnvironment): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (request.method === "GET" && url.searchParams.get("capabilities") === "1") return reply({ enabled: Boolean(env.PAYMENT_PROOFS), maxBytes: MAX_PROOF_BYTES });
    if (request.method !== "GET" && request.method !== "POST" && request.method !== "DELETE") return reply({ error: "Method not allowed." }, 405);
    const registrationId = url.searchParams.get("registrationId") ?? "";
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(registrationId)) return reply({ error: "Invalid registration ID." }, 400);
    const row = await env.DB.prepare("SELECT payload FROM tournament_state WHERE id = ?").bind("racketeers").first<{ payload: string }>();
    if (!row) return reply({ error: "Registration not found." }, 404);
    const state: TournamentState = JSON.parse(row.payload);
    const organizerPin = request.headers.get("x-organizer-pin") ?? "";
    const registrationPin = request.headers.get("x-registration-pin") ?? "";
    const organizer = /^\d{4,10}$/.test(organizerPin) && await hash(organizerPin) === state.organizerPinHash;
    const registration = state.registrations.find(r => r.id === registrationId);
    const partner = registration && state.registrations.find(r => r.id === registration.partnerId && r.partnerId === registration.id && r.divisionId === registration.divisionId);
    const owner = registration && /^\d{8,10}$/.test(registrationPin) && [registration.registrationPinHash, partner?.registrationPinHash].filter(Boolean).includes(await hash(registrationPin));
    if (!organizer && !owner) return reply({ error: "A valid organizer or registration PIN is required." }, 401);
    if (!registration) return reply({ error: "Registration not found." }, 404);
    if (!env.PAYMENT_PROOFS) return reply({ error: "Payment screenshot uploads are not available yet. Please contact the organizer." }, 503);
    const linkedRegistrationIds = [registration.id, ...(partner ? [partner.id] : [])].sort();
    const filename = `${linkedRegistrationIds[0]}.png`;
    // A pair-specific location prevents a newly uploaded receipt following a later partner change.
    const key = partner ? `payments/pairs/${linkedRegistrationIds.join("/")}/${filename}` : `payments/${filename}`;
    const keys = [...new Set([key, ...linkedRegistrationIds.map(id => `payments/${id}.png`)])];
    if (request.method === "DELETE") {
      if (!organizer) return reply({ error: "Only organizers can delete payment photos." }, 403);
      for (const candidate of keys) await env.PAYMENT_PROOFS.delete(candidate);
      return reply({ ok: true });
    }
    if (request.method === "GET") {
      const metadataOnly = url.searchParams.get("metadata") === "1";
      const available = await Promise.all(keys.map(async candidate => ({ key: candidate, metadata: await env.PAYMENT_PROOFS!.head(candidate) })));
      const selected = available.filter(item => item.metadata).sort((a, b) => b.metadata!.uploaded.getTime() - a.metadata!.uploaded.getTime())[0];
      const object = selected && (metadataOnly ? selected.metadata : await env.PAYMENT_PROOFS.get(selected.key));
      if (!object) return reply({ error: "No payment screenshot uploaded." }, 404);
      if (metadataOnly) return reply({ filename, size: object.size, uploadedAt: object.uploaded.toISOString(), linkedRegistrationIds });
      return new Response(object.body, { headers: { ...headers, "Content-Type": "image/png", "Content-Disposition": `inline; filename="${filename}"`, "Content-Security-Policy": "default-src 'none'; sandbox" } });
    }
    if (!organizer && state.status !== "registration") return reply({ error: "Payment uploads are locked outside the Registration phase." }, 423);
    if (request.headers.get("content-type") !== "image/png") return reply({ error: "Upload a PNG screenshot." }, 415);
    if (Number(request.headers.get("content-length") || 0) > MAX_PROOF_BYTES) return reply({ error: "Screenshot must be 2 MB or smaller." }, 413);
    let bytes: Uint8Array;
    try { bytes = await boundedBody(request); } catch { return reply({ error: "Screenshot must be 2 MB or smaller." }, 413); }
    const signature = [137,80,78,71,13,10,26,10];
    if (bytes.length < 45 || !signature.every((b,i) => bytes[i] === b) || String.fromCharCode(...bytes.slice(12,16)) !== "IHDR" || String.fromCharCode(...bytes.slice(-8,-4)) !== "IEND") return reply({ error: "The file is not a valid PNG screenshot." }, 415);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16), height = view.getUint32(20);
    if (!width || !height || width * height > 24_000_000) return reply({ error: "Screenshot dimensions are too large." }, 415);
    await env.PAYMENT_PROOFS.put(key, bytes, { httpMetadata: { contentType: "image/png", contentDisposition: `inline; filename="${filename}"` } });
    // Proof storage is separate from whole-tournament saves. Uploads never mark a payment as verified.
    return reply({ ok: true, filename, linkedRegistrationIds });
  } catch {
    return reply({ error: "The payment screenshot could not be processed. Please try again." }, 500);
  }
}

const QR_KEY = "payment-instructions/qr.png";
export async function handlePaymentSettings(request: Request, env: ProofEnvironment): Promise<Response> {
  try {
    const imageRequest = new URL(request.url).searchParams.get("image") === "1";
    if (request.method === "GET" && imageRequest) {
      const object = await env.PAYMENT_PROOFS?.get(QR_KEY);
      if (!object) return reply({ error: "No payment QR image is available." }, 404);
      return new Response(object.body, { headers: { ...headers, "Content-Type": "image/png", "Content-Disposition": 'inline; filename="payment-qr.png"', "Content-Security-Policy": "default-src 'none'; sandbox" } });
    }
    if (request.method !== "GET") {
      const pin = request.headers.get("x-organizer-pin") ?? "";
      if (!/^\d{4,10}$/.test(pin)) return reply({ error: "Organizer access is required." }, 401);
      const row = await env.DB.prepare("SELECT payload FROM tournament_state WHERE id = ?").bind("racketeers").first<{ payload: string }>();
      if (!row || await hash(pin) !== JSON.parse(row.payload).organizerPinHash) return reply({ error: "Organizer PIN did not match." }, 401);
    }
    if (imageRequest && request.method === "DELETE") {
      if (!env.PAYMENT_PROOFS) return reply({ error: "Image storage has not been connected." }, 503);
      await env.PAYMENT_PROOFS.delete(QR_KEY);
      return reply({ ok: true });
    }
    if (imageRequest && request.method === "POST") {
      if (!env.PAYMENT_PROOFS) return reply({ error: "Image storage has not been connected." }, 503);
      if (request.headers.get("content-type") !== "image/png") return reply({ error: "Upload a PNG payment image." }, 415);
      let bytes: Uint8Array;
      try { bytes = await boundedBody(request); } catch { return reply({ error: "Image must be 2 MB or smaller." }, 413); }
      const signature = [137,80,78,71,13,10,26,10];
      if (bytes.length < 45 || !signature.every((b,i) => bytes[i] === b) || String.fromCharCode(...bytes.slice(12,16)) !== "IHDR" || String.fromCharCode(...bytes.slice(-8,-4)) !== "IEND") return reply({ error: "Invalid PNG image." }, 415);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (!view.getUint32(16) || !view.getUint32(20) || view.getUint32(16) * view.getUint32(20) > 24_000_000) return reply({ error: "Image dimensions are too large." }, 415);
      await env.PAYMENT_PROOFS.put(QR_KEY, bytes, { httpMetadata: { contentType: "image/png", contentDisposition: 'inline; filename="payment-qr.png"' } });
      return reply({ ok: true });
    }
    if (request.method !== "GET" && request.method !== "POST") return reply({ error: "Method not allowed." }, 405);
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS payment_settings (id TEXT PRIMARY KEY, payload TEXT NOT NULL)").run();
    if (request.method === "POST") {
      if (Number(request.headers.get("content-length") || 0) > 8192) return reply({ error: "Payment details are too long." }, 413);
      const raw = await request.text();
      if (raw.length > 8192) return reply({ error: "Payment details are too long." }, 413);
      const body = JSON.parse(raw);
      const details = { bankName: String(body.bankName ?? "").trim().slice(0,120), accountNumber: String(body.accountNumber ?? "").trim().slice(0,100), accountName: String(body.accountName ?? "").trim().slice(0,150), instructions: String(body.instructions ?? "").trim().slice(0,1500) };
      await env.DB.prepare("INSERT INTO payment_settings (id, payload) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload").bind("racketeers", JSON.stringify(details)).run();
      return reply({ ok: true, details });
    }
    const row = await env.DB.prepare("SELECT payload FROM payment_settings WHERE id = ?").bind("racketeers").first<{ payload: string }>();
    const details = row ? JSON.parse(row.payload) : { bankName: "", accountNumber: "", accountName: "", instructions: "" };
    return reply({ ...details, imageAvailable: Boolean(await env.PAYMENT_PROOFS?.head(QR_KEY)), uploadsEnabled: Boolean(env.PAYMENT_PROOFS) });
  } catch {
    return reply({ error: "Payment details could not be processed. Please try again." }, 500);
  }
}
