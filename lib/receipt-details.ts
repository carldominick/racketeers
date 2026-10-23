export type ReceiptDetails = {
  amount: string; reference: string; provider: string; date: string;
  transferStatus?: "unknown" | "pending" | "completed";
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
  if (d.transferStatus !== undefined && !["unknown", "pending", "completed"].includes(d.transferStatus)) return false;
  if (![d.amount, d.reference, d.provider, d.date].every(x => typeof x === "string")) return false;
  if (d.amount !== "" && receiptAmount(d.amount) !== d.amount) return false;
  if (d.reference.length > 80 || d.reference && !/^[a-z\d][a-z\d -]*$/i.test(d.reference)) return false;
  if (d.provider.length > 60 || /[\x00-\x1f]/.test(d.provider)) return false;
  return !d.date || /^\d{4}-\d{2}-\d{2}$/.test(d.date) && !isNaN(Date.parse(d.date)) && new Date(d.date).toISOString().slice(0, 10) === d.date;
}

type Field = "amount" | "reference" | "provider" | "date";
type Candidate = { priority: number; value: string; notice?: string };
export type ReceiptExtraction = ReceiptReading & { ambiguousFields: Field[]; notices: string[] };
const fields: Field[] = ["amount", "reference", "provider", "date"];
const fieldNames = { amount: "Amount", reference: "Reference", provider: "Receipt bank / app", date: "Payment date" };
const amountLabel = /^(?:(?:transfer|payment|transaction)\s+amount|amount(?:\s+(?:sent|paid|transferred|received))?|total(?:\s+amount)?)(?:\s*\((?:PHP|₱)\))?\s*[:\-]?\s*/i;
const referenceLabel = /\b(?:reference\s*(?:number|no\.?|id)?|ref\.?\s*(?:no\.?|number|id)?|transaction\s*(?:(?:ref(?:erence)?\.?\s*)?(?:id|number|no\.?))|confirmation\s*(?:id|number|no\.?)|trace\s*(?:id|number|no\.?))\s*[:.#\-]?\s*/i;
const otherAmount = /\b(?:fee|charge|balance|total|account|mobile|phone)\b/i;
const dateLabel = /^(?:transaction|payment|transfer)?\s*date(?:\s*(?:and|&|\/)\s*time)?\b|^(?:paid|sent|transferred)\s+(?:on|at)\b/i;
const recipientLabel = /\b(?:to|recipient|receiving|destination|beneficiary)\b/i;
const sourceLabel = /\b(?:from|via|using|source|sending|powered\s+by|payment\s+method)\b/i;
const providers = [
  { name: "GCash", pattern: /\bg\s*cash\b/i },
  { name: "Maya", pattern: /\b(?:pay\s*)?maya\b/i },
  { name: "MariBank", pattern: /\bmari\s*bank\b/i },
  { name: "SeaBank", pattern: /\bsea\s*bank\b/i },
  { name: "BPI", pattern: /\bb\s*p\s*i\b|\bbank\s+of\s+the\s+philippine\s+islands\b/i },
  { name: "GoTyme", pattern: /\bgo\s*tyme(?:\s+bank)?\b/i },
];

function money(value: string): string | null {
  // A standalone P is a common OCR rendering of the peso sign. Never fix digits.
  return receiptAmount(value.trim().replace(/^(?:P|[$£])\s*(?=\d)/i, "").replace(/\s*PHP$/i, ""));
}
function reference(value: string): string | null {
  const trimmed = value.trim();
  if (!/^[a-z\d][a-z\d -]{4,79}$/i.test(trimmed) || !/\d/.test(trimmed)) return null;
  // Reject prose/dates beside a missing label, while retaining numeric groups and bank IDs.
  if (/\s/.test(trimmed) && !/^(?:[a-z]{1,8}[- ]?)?\d[\d -]*$/i.test(trimmed)) return null;
  return trimmed;
}
const monthPattern = "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function calendarDate(year: string, month: number, day: string): string | null {
  const date = `${year}-${String(month).padStart(2, "0")}-${day.padStart(2, "0")}`;
  return validReceipt({ ...emptyReceipt(), date }) ? date : null;
}
function dates(line: string): { values: string[]; ambiguous: boolean } {
  const values: string[] = [];
  let ambiguous = false;
  const add = (value: string | null) => { if (value) values.push(value); };
  for (const match of line.matchAll(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/g)) add(calendarDate(match[1], +match[2], match[3]));
  for (const match of line.matchAll(new RegExp(`\\b(${monthPattern})\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?(?:,\\s*|\\s+)(20\\d{2})\\b`, "gi"))) add(calendarDate(match[3], months.indexOf(match[1].slice(0, 3).toLowerCase()) + 1, match[2]));
  for (const match of line.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s-]+(${monthPattern})\\.?[\\s,-]+(20\\d{2})\\b`, "gi"))) add(calendarDate(match[3], months.indexOf(match[2].slice(0, 3).toLowerCase()) + 1, match[1]));
  for (const match of line.matchAll(/\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b/g)) {
    const a = +match[1], b = +match[2];
    if (a === b || a > 12 && b <= 12) add(calendarDate(match[3], b, match[1]));
    else if (b > 12 && a <= 12) add(calendarDate(match[3], a, match[2]));
    else if (a >= 1 && a <= 12 && b >= 1 && b <= 12) ambiguous = true;
  }
  return { values, ambiguous };
}
function warningsFor(details: ReceiptDetails, ambiguous: Field[]): string[] {
  return fields.flatMap(field => details[field] ? [] : [ambiguous.includes(field)
    ? `${fieldNames[field]} is ambiguous. Check the screenshot and enter it manually.`
    : `${fieldNames[field]} could not be identified. Enter it manually.`]);
}

/** Missing/ambiguous fields stay empty for human review. Never invent digits or a date locale. */
export function extractReceipt(text: string): ReceiptExtraction {
  const details = emptyReceipt();
  const ambiguousFields: Field[] = [];
  const notices: string[] = [];
  const lines = text.replace(/\r/g, "").split("\n").map(x => x.replace(/[\u00a0\u202f]/g, " ").trim()).filter(Boolean);
  const candidates: Record<Field, Candidate[]> = { amount: [], reference: [], provider: [], date: [] };
  let ambiguousDatePriority = Infinity;
  let bankContext: "source" | "recipient" | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], previous = lines[i - 1] || "";
    if (/^(?:from|source|sending\s+bank)\b/i.test(line)) bankContext = "source";
    else if (/^(?:to|transfer\s+to|recipient|destination|receiving\s+bank)\b/i.test(line)) bankContext = "recipient";
    else if (/^(?:transfer\s+(?:amount|fee|method)|amount|fee|total|reference|ref\b|date|transaction|purpose|gateway|processing\s+time|notes)\b/i.test(line)) bankContext = null;
    const label = line.match(amountLabel);
    if (label) {
      let raw = line.slice(label[0].length);
      if (!raw) raw = lines[i + 1] || "";
      if (/^(?:PHP|₱|P)$/i.test(raw)) raw += ` ${lines[i + 2] || ""}`;
      const value = money(raw);
      if (value) candidates.amount.push({ priority: /^total/i.test(label[0]) ? 3 : /sent|paid|transferred|transfer|payment/i.test(label[0]) ? 0 : 1, value, ...(/^[$£]/.test(raw.trim()) ? { notice: "Currency symbol was unclear in OCR. Confirm the amount is in PHP." } : {}) });
    }
    // Large unlabelled amounts on wallet receipts are common. Fees/balances never qualify.
    const amountContext = /^(?:PHP|₱|P)$/i.test(previous) ? lines[i - 2] || "" : previous;
    if (!otherAmount.test(amountContext) && !amountLabel.test(line)) {
      const raw = /^(?:PHP|₱|P)$/i.test(line) ? `${line} ${lines[i + 1] || ""}` : line;
      if (/^(?:(?:PHP|₱|P)\s*\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*\.\d{2}(?:\s*PHP)?)$/i.test(raw)) {
        const value = money(raw);
        if (value) candidates.amount.push({ priority: 2, value });
      }
    }
    const ref = line.match(referenceLabel);
    if (ref) {
      const inline = line.slice(ref.index! + ref[0].length);
      let raw = inline || lines[i + 1] || "";
      let next = i + 2;
      if (!inline && /^(?:number|no\.?|id)\s*[:#]?$/i.test(raw)) raw = lines[next++] || "";
      if (!inline && /^\d{1,4}$/.test(raw)) {
        while (next < lines.length && /^\d{1,4}$/.test(lines[next])) raw += ` ${lines[next++]}`;
      }
      // A footer may place the date on the same row as the reference number.
      const dateStart = raw.search(new RegExp(`\\b(?:${monthPattern})\\.?\\s*\\d{1,2}(?:,\\s*|\\s+)20\\d{2}\\b|\\b20\\d{2}-\\d{2}-\\d{2}\\b`, "i"));
      if (dateStart >= 0) raw = raw.slice(0, dateStart).trim();
      const value = reference(raw);
      if (value) candidates.reference.push({ priority: /^confirmation|^trace/i.test(ref[0]) ? 1 : 0, value });
    }
    for (const provider of providers) {
      if (!provider.pattern.test(line)) continue;
      const context = /^(?:bank|bank name|e-wallet|wallet)\s*:?$/i.test(previous) ? lines[i - 2] || "" : previous;
      const source = sourceLabel.test(line) || bankContext === "source" || sourceLabel.test(context) && !providers.some(p => p.pattern.test(context));
      const recipient = recipientLabel.test(line) || bankContext === "recipient" || recipientLabel.test(context) && !providers.some(p => p.pattern.test(context));
      if (recipient && !source) continue;
      const brandOnly = line.replace(provider.pattern, "").replace(/[^a-z]/gi, "") === "";
      candidates.provider.push({ value: provider.name, priority: source ? 0 : brandOnly ? 1 : 2 });
    }
    if (/\b(?:due|expiry|expires|birthday|statement)\b/i.test(line) || /^(?:due|expiry|statement)\s*date\b/i.test(previous)) continue;
    const priority = dateLabel.test(line) || dateLabel.test(previous) ? 0 : 1;
    const found = dates(line);
    if (found.ambiguous) ambiguousDatePriority = Math.min(priority, ambiguousDatePriority);
    candidates.date.push(...found.values.map(value => ({ priority, value })));
  }
  for (const field of fields) {
    const priority = Math.min(...candidates[field].map(c => c.priority));
    const values = new Map(candidates[field].filter(c => c.priority === priority).map(c => [field === "reference" ? receiptReferenceKey(c.value) : c.value, c.value]));
    // A readable total plus a fee is insufficient to establish the actual transfer. Never subtract to guess it.
    if (field === "amount" && priority === 3 && lines.some(line => /\b(?:fee|charge)\b/i.test(line))) { ambiguousFields.push(field); continue; }
    if (values.size === 1 && !(field === "date" && ambiguousDatePriority <= priority)) {
      details[field] = [...values.values()][0];
      for (const candidate of candidates[field].filter(c => c.priority === priority)) if (candidate.notice) notices.push(candidate.notice);
    }
    else if (values.size > 1 || field === "date" && ambiguousDatePriority < Infinity) ambiguousFields.push(field);
  }
  if (details.reference && candidates.reference.some(c => c.priority === 1) && candidates.reference.some(c => c.priority === 0)) notices.push("The receipt also has a confirmation number. Reference number uses the explicitly labelled transaction reference; check which identifier you need.");
  if (lines.some(line => /^(?:[xv✓✔●•\s]*)(?:(?:transfer|payment)\s+)?(?:processing|pending|in\s+progress)\s*[.!]?$/i.test(line))) notices.push("This screenshot shows a pending or processing transaction. It is not proof of a completed payment.");
  if (!details.amount && /[-−–]\s*(?:PHP|[₱P$£])?\s*\d[\d,]*\.\d{2}/i.test(text) && /\bfee\b/i.test(text)) notices.push("The wallet debit has a separate fee. The transferred amount is not explicit; check it manually rather than treating the total debit as payment.");
  return { details, ambiguousFields, notices, warnings: [...warningsFor(details, ambiguousFields), ...new Set(notices)] };
}

/** Different OCR passes must agree; an uncertain first reading is never silently overwritten. */
export function combineReceiptReadings(readings: ReceiptExtraction[]): ReceiptReading {
  const details = emptyReceipt(), ambiguous: Field[] = [];
  for (const field of fields) {
    const values = new Map(readings.flatMap(reading => reading.details[field] ? [[field === "reference" ? receiptReferenceKey(reading.details[field]) : reading.details[field], reading.details[field]]] : []));
    if (values.size === 1 && !readings.some(reading => reading.ambiguousFields.includes(field))) details[field] = [...values.values()][0];
    else if (values.size > 1 || readings.some(reading => reading.ambiguousFields.includes(field))) ambiguous.push(field);
  }
  return { details, warnings: [...warningsFor(details, ambiguous), ...new Set(readings.flatMap(reading => reading.notices))] };
}
