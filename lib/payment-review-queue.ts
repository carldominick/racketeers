import { readReceiptRecord, ReceiptRequestError } from "./receipt-batch";
import type { ReceiptRecord } from "./receipt-details";
import type { Division, PlayerRegistration } from "./tournament";
import { paymentGroupCharges, priceCents } from "./registration-pricing";
export type PaymentQueueItem = { registrationId: string; ids: string[]; record: ReceiptRecord | null };
export const PAYMENT_FILTERS = { all: "All payments", missing: "Missing screenshot", review: "Needs review / uncertain fields", pending: "Pending transfer", date: "Missing date", amount: "Missing / different amount", duplicate: "Duplicate reference", unconfirmed: "Payment not confirmed" } as const;
export type PaymentFilter = keyof typeof PAYMENT_FILTERS;
export async function loadPaymentQueue(registrations: PlayerRegistration[], pin: string, signal: AbortSignal, request: typeof fetch = fetch) {
  const items: PaymentQueueItem[] = [], seen = new Set<string>();
  for (const player of registrations) {
    if (signal.aborted) throw new DOMException("Stopped", "AbortError");
    if (seen.has(player.id)) continue;
    try {
      const record = await readReceiptRecord(player.id, pin, signal, request);
      const ids = record.linkedRegistrationIds?.length ? record.linkedRegistrationIds : [player.id];
      ids.forEach(id => seen.add(id));
      items.push({ registrationId: player.id, ids, record });
    } catch (error) {
      if (!(error instanceof ReceiptRequestError && error.status === 404)) throw error;
      const ids = registrations.filter(other => other.id === player.id || player.paymentGroupId && player.paymentGroupId === other.paymentGroupId || player.partnerId === other.id && other.partnerId === player.id).map(other => other.id);
      ids.forEach(id => seen.add(id)); items.push({ registrationId: player.id, ids, record: null });
    }
  }
  return items;
}
export function paymentExceptions(item: PaymentQueueItem, divisions: Division[], registrations: PlayerRegistration[]): PaymentFilter[] {
  const record = item.record, details = record?.details;
  const issues: PaymentFilter[] = [];
  if (!record) issues.push("missing");
  if (record && (!record.reviewedAt || record.stale || !details?.amount || !details.reference || !details.provider || !details.date)) issues.push("review");
  if (details?.transferStatus === "pending") issues.push("pending");
  if (record && !details?.date) issues.push("date");
  const expected = paymentGroupCharges(divisions, registrations, item.ids).total;
  if (record && (!details?.amount || expected !== null && priceCents(details.amount) !== expected)) issues.push("amount");
  if (record?.duplicateReference) issues.push("duplicate");
  if (registrations.some(player => item.ids.includes(player.id) && !player.paid)) issues.push("unconfirmed");
  return issues;
}
