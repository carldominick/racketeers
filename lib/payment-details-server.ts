import { handlePaymentProof, type ProofEnvironment } from "./payment-proof-server";
import { validReceipt, receiptReferenceKey, type ReceiptDetails } from "./receipt-details";

type Row = { group_id: string; payload: string; proof_version: string; revision: number; updated_at: string };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function handlePaymentDetails(request: Request, env: ProofEnvironment): Promise<Response> {
  try {
    if (!["GET", "POST"].includes(request.method)) return reply({ error: "Method not allowed." }, 405);
    const id = new URL(request.url).searchParams.get("registrationId") || "";
    // Only organizer credentials are forwarded. Owners and signed share links cannot read these records.
    const metadata = await handlePaymentProof(new Request(new URL(`/api/payment-proof?metadata=1&registrationId=${encodeURIComponent(id)}`, request.url), {
      headers: { "x-organizer-pin": request.headers.get("x-organizer-pin") || "" },
    }), env);
    if (!metadata.ok) return metadata;
    const proof = await metadata.json() as { linkedRegistrationIds: string[]; receiptGroupId: string; proofVersion: string };
    const groups = [...new Set([proof.receiptGroupId, ...proof.linkedRegistrationIds])].filter(Boolean);
    if (!groups.length) return reply({ error: "Registration not found." }, 404);
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS payment_receipt_details (group_id TEXT PRIMARY KEY, reference_key TEXT NOT NULL, payload TEXT NOT NULL, proof_version TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL)").run();
    // Retain a legacy pair's review when later entries join its payment group.
    const placeholders = groups.map(() => "?").join(",");
    const current = await env.DB.prepare(`SELECT group_id, payload, proof_version, revision, updated_at FROM payment_receipt_details WHERE group_id IN (${placeholders}) ORDER BY updated_at DESC LIMIT 1`).bind(...groups).first<Row>();
    const groupId = current?.group_id || proof.receiptGroupId;
    const duplicate = async (details: ReceiptDetails) => details.reference ? Boolean(await env.DB.prepare(`SELECT group_id FROM payment_receipt_details WHERE reference_key = ? AND group_id NOT IN (${placeholders}) LIMIT 1`).bind(receiptReferenceKey(details.reference), ...groups).first()) : false;
    if (request.method === "GET") {
      const details = current ? JSON.parse(current.payload) as ReceiptDetails : null;
      return reply({ groupId, details, revision: current?.revision || 0, proofVersion: proof.proofVersion, stale: Boolean(current && current.proof_version !== proof.proofVersion), reviewedAt: current?.updated_at || null, duplicateReference: details ? await duplicate(details) : false, linkedRegistrationIds: proof.linkedRegistrationIds });
    }
    const raw = await request.text();
    if (raw.length > 4096) return reply({ error: "Payment details are too large." }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return reply({ error: "Invalid payment details." }, 400); }
    if (!body || !validReceipt(body.details)) return reply({ error: "Check the amount, reference, provider and date." }, 400);
    if (body.proofVersion !== proof.proofVersion) return reply({ error: "The screenshot changed. Reload and review it again." }, 409);
    if (!Number.isInteger(body.expectedRevision) || body.expectedRevision !== (current?.revision || 0)) return reply({ error: "Another organizer changed these details. Reload before saving." }, 409);
    const { amount, reference, provider, date } = body.details;
    const details: ReceiptDetails = { amount, reference, provider, date };
    const updatedAt = new Date().toISOString();
    const revision = (current?.revision || 0) + 1;
    const statement = current
      ? env.DB.prepare("UPDATE payment_receipt_details SET reference_key = ?, payload = ?, proof_version = ?, revision = ?, updated_at = ? WHERE group_id = ? AND revision = ?").bind(receiptReferenceKey(reference), JSON.stringify(details), proof.proofVersion, revision, updatedAt, groupId, current.revision)
      : env.DB.prepare("INSERT INTO payment_receipt_details (reference_key, payload, proof_version, revision, updated_at, group_id) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(group_id) DO NOTHING").bind(receiptReferenceKey(reference), JSON.stringify(details), proof.proofVersion, revision, updatedAt, groupId);
    const result = await statement.run() as { meta?: { changes?: number } };
    if (result.meta?.changes !== 1) return reply({ error: "Payment details changed. Reload before saving." }, 409);
    return reply({ groupId, details, revision, proofVersion: proof.proofVersion, stale: false, reviewedAt: updatedAt, duplicateReference: await duplicate(details), linkedRegistrationIds: proof.linkedRegistrationIds });
  } catch {
    return reply({ error: "Payment details could not be saved. Please retry." }, 503);
  }
}
