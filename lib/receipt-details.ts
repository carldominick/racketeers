export type ReceiptDetails = {
  amount: string; reference: string; provider: string; date: string;
};
export type ReceiptRecord = {
  groupId: string; details: ReceiptDetails | null; revision: number; proofVersion: string;
  stale: boolean; reviewedAt: string | null; duplicateReference: boolean; linkedRegistrationIds?: string[];
};
export type ReceiptReading = { details: ReceiptDetails; warnings: string[] };
export const emptyReceipt = (): ReceiptDetails => ({ amount: "", reference: "", provider: "", date: "" });

/** Decimal text, never floating point or a receipt's unrelated balance/fee. */
export function receiptAmount(value: string): string | null {
  const text = value.replace(/(?:PHP|₱|,|\s)/gi, "");
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return `${whole.replace(/^0+(?=\d)/, "")}.${fraction.padEnd(2, "0")}`;
}
export function receiptReferenceKey(reference: string): string {
  return reference.toUpperCase().replace(/[\s-]/g, "");
}
export function validReceipt(value: unknown): value is ReceiptDetails {
  if (!value || typeof value !== "object") return false;
  const d = value as ReceiptDetails;
  if (![d.amount, d.reference, d.provider, d.date].every(x => typeof x === "string")) return false;
  if (d.amount !== "" && receiptAmount(d.amount) !== d.amount) return false;
  if (d.reference.length > 80 || d.reference && !/^[a-z\d][a-z\d -]*$/i.test(d.reference)) return false;
  if (d.provider.length > 60 || /[\x00-\x1f]/.test(d.provider)) return false;
  return !d.date || /^\d{4}-\d{2}-\d{2}$/.test(d.date) && !isNaN(Date.parse(d.date)) && new Date(d.date).toISOString().slice(0, 10) === d.date;
}

/** Missing/ambiguous fields stay empty for human review. Never invent digits. */
export function extractReceipt(text: string): { details: ReceiptDetails; warnings: string[] } {
  const details = emptyReceipt();
  const warnings: string[] = [];
  const lines = text.replace(/\r/g, "").split("\n").map(x => x.trim()).filter(Boolean);
  const amounts: { priority: number; value: string }[] = [];
  const references: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const label = line.match(/^(amount\s+(?:sent|paid|transferred)|total\s+amount|amount|total)\b\s*[:\-]?\s*(.*)$/i);
    if (label) {
      const value = receiptAmount(label[2] || lines[i + 1] || "");
      if (value) amounts.push({ priority: /sent|paid|transferred/i.test(label[1]) ? 0 : /^amount$/i.test(label[1]) ? 1 : 2, value });
    }
    const ref = line.match(/(?:reference\s*(?:number|no\.?|id)?|ref\.?\s*(?:no\.?|number)|transaction\s*(?:id|number|no\.?))\s*[:#\-]?\s*(.*)$/i);
    if (ref) {
      const value = (ref[1] || lines[i + 1] || "").trim();
      if (/^[a-z\d][a-z\d -]{4,79}$/i.test(value) && /\d/.test(value)) references.push(value);
    }
  }
  const priority = Math.min(...amounts.map(a => a.priority));
  const candidates = [...new Set(amounts.filter(a => a.priority === priority).map(a => a.value))];
  if (candidates.length === 1) details.amount = candidates[0];
  else warnings.push(candidates.length ? "Multiple amounts detected. Check the transferred amount." : "Amount could not be identified. Enter it manually.");
  const refs = [...new Set(references)];
  if (refs.length === 1) details.reference = refs[0];
  else warnings.push(refs.length ? "Multiple references detected. Check the screenshot." : "Reference could not be identified. Enter it manually.");
  details.provider = /\bgcash\b/i.test(text) ? "GCash" : /\bmaya\b/i.test(text) ? "Maya" : "";
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso && validReceipt({ ...details, date: iso[1] })) details.date = iso[1];
  return { details, warnings };
}
