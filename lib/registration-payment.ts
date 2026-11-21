import type { Division, PlayerRegistration, TournamentState } from "./tournament";
import { registrationCharges } from "./registration-pricing";
import { receiptReferenceKey, validReceipt, type ReceiptDetails } from "./receipt-details";

export type PaymentAllocation = { ids: string[]; cents: number; due: number; previouslyPaid: string[] };
export type PaymentTransfer = {
  id: string; groupId: string; slot: number; proofVersion: string; contentVersion?: string;
  details: ReceiptDetails; allocations: PaymentAllocation[]; confirmedAt: string;
};
export type PaymentPhoto = { slot: number; filename: string; proofVersion: string; contentVersion?: string };
export type ReceiptPaymentChange =
  | { action: "confirmReceiptTransfer"; slot: number; proofVersion: string; details: ReceiptDetails; allocations: { scope: string; cents: number; due?: number }[] }
  | { action: "undoReceiptTransfer"; transferId: string };
export type ReceiptPaymentControls = {
  state: TournamentState;
  disabled: boolean;
  change: (registrationId: string, mutation: ReceiptPaymentChange) => Promise<void>;
};

export function registrationPaymentEntries(registrations: PlayerRegistration[], player: PlayerRegistration, mode?: Division["mode"]) {
  if (!mode || mode === "singles") return [player];
  // Legacy reciprocal pairs with no explicit group use the same shared receipt key.
  const partner = registrations.find(candidate => candidate.id !== player.id && candidate.id === player.partnerId &&
    candidate.partnerId === player.id && candidate.divisionId === player.divisionId &&
    (candidate.paymentGroupId || null) === (player.paymentGroupId || null));
  return partner ? [player, partner] : [player];
}

/** List the player or pair confirmations in a receipt without merging separate division entries. */
export function registrationPaymentScopes(registrations: PlayerRegistration[], divisions: Division[], receiptIds: string[]) {
  const linked = new Set(receiptIds);
  const remaining = new Set(receiptIds);
  return registrations.flatMap(player => {
    if (!remaining.delete(player.id)) return [];
    const division = divisions.find(item => item.id === player.divisionId);
    const entries = registrationPaymentEntries(registrations, player, division?.mode);
    entries.forEach(entry => remaining.delete(entry.id));
    return entries.every(entry => linked.has(entry.id)) ? [{ entries, division }] : [];
  });
}

type RegistrationPayments = Pick<TournamentState, "divisions" | "registrations" | "paymentTransfers">;

export function linkedPaymentIds(state: RegistrationPayments, registrationId: string) {
  const player = state.registrations.find(entry => entry.id === registrationId);
  if (!player) return [];
  if (player.paymentGroupId) return state.registrations.filter(entry => entry.paymentGroupId === player.paymentGroupId).map(entry => entry.id);
  return registrationPaymentEntries(state.registrations, player, state.divisions.find(division => division.id === player.divisionId)?.mode).map(entry => entry.id);
}

export function groupPaymentTransfers(state: RegistrationPayments, ids: string[], groupId?: string) {
  const linked = new Set(ids);
  return (state.paymentTransfers ?? []).filter(transfer => groupId === transfer.groupId
    || linked.has(transfer.groupId) || transfer.allocations.some(allocation => allocation.ids.some(id => linked.has(id))));
}

const scopeKey = (ids: string[]) => [...ids].sort().join("/");
export function paymentTransferScopes(state: RegistrationPayments, ids: string[]) {
  const allocations = groupPaymentTransfers(state, ids).flatMap(transfer => transfer.allocations);
  return registrationPaymentScopes(state.registrations, state.divisions, ids).map(({ entries, division }) => {
    const memberIds = entries.map(entry => entry.id);
    const key = scopeKey(memberIds);
    const prior = allocations.filter(allocation => scopeKey(allocation.ids) === key);
    return {
      key, ids: memberIds, entries, division,
      due: prior[0]?.due ?? registrationCharges(state.divisions, entries).total,
      previouslyPaid: prior[0]?.previouslyPaid ?? entries.filter(entry => entry.paid).map(entry => entry.id),
      confirmed: prior.reduce((total, allocation) => total + allocation.cents, 0),
    };
  });
}

export function trackedPaymentIds(state: TournamentState) {
  return new Set((state.paymentTransfers ?? []).flatMap(transfer => transfer.allocations.flatMap(allocation => allocation.ids)));
}

export function changesConfirmedBillingScope(before: TournamentState, after: TournamentState) {
  const ids = trackedPaymentIds(before);
  if (!ids.size) return false;
  const next = new Map(after.registrations.map(player => [player.id, player]));
  return before.registrations.some(player => {
    if (!ids.has(player.id)) return false;
    const updated = next.get(player.id);
    return !updated || player.divisionId !== updated.divisionId || player.partnerId !== updated.partnerId ||
      player.paymentGroupId !== updated.paymentGroupId ||
      before.divisions.find(division => division.id === player.divisionId)?.mode !== after.divisions.find(division => division.id === player.divisionId)?.mode;
  });
}

export function receiptCents(amount: string) {
  const [whole, fraction] = amount.split(".");
  return Number(whole) * 100 + Number(fraction);
}

function applyPaymentTransfers(state: TournamentState, transfers: PaymentTransfer[], affected: PaymentAllocation[]) {
  const totals = new Map<string, number>();
  for (const transfer of transfers) for (const allocation of transfer.allocations) {
    const key = scopeKey(allocation.ids);
    totals.set(key, (totals.get(key) ?? 0) + allocation.cents);
  }
  const paid = new Map<string, boolean>();
  for (const allocation of affected) {
    const total = totals.get(scopeKey(allocation.ids)) ?? 0;
    for (const id of allocation.ids) paid.set(id, allocation.previouslyPaid.includes(id) || total > 0 && total >= allocation.due);
  }
  return { ...state, paymentTransfers: transfers, registrations: state.registrations.map(entry =>
    paid.has(entry.id) ? { ...entry, paid: paid.get(entry.id)! } : entry) };
}

export function confirmPaymentTransfer(state: TournamentState, proof: { groupId: string; ids: string[]; photo: PaymentPhoto }, mutation: Extract<ReceiptPaymentChange, { action: "confirmReceiptTransfer" }>) {
  const { details } = mutation;
  const transfers = state.paymentTransfers ?? [];
  if (!validReceipt(details) || !details.provider.trim() || !details.date || !details.reference || !details.amount
      || receiptCents(details.amount) <= 0 || details.transferStatus === "pending") {
    return { error: "A received transfer needs a positive amount, reference number, payment source and date. Pending transfers cannot be confirmed.", status: 400 } as const;
  }
  const reference = receiptReferenceKey(details.reference);
  if (transfers.some(transfer => receiptReferenceKey(transfer.details.reference) === reference
    || proof.photo.contentVersion && transfer.contentVersion === proof.photo.contentVersion)) {
    return { error: "This reference number or screenshot already belongs to a confirmed transfer.", status: 409 } as const;
  }
  if (groupPaymentTransfers(state, proof.ids, proof.groupId).some(transfer => transfer.slot === proof.photo.slot)) {
    return { error: "This photo slot already has a confirmed transfer. Undo it before confirming a correction.", status: 409 } as const;
  }
  const scopes = paymentTransferScopes(state, proof.ids);
  if (!Array.isArray(mutation.allocations) || !mutation.allocations.length || mutation.allocations.length > scopes.length) {
    return { error: "Allocate the transfer to the covered entries.", status: 400 } as const;
  }
  const allocations: PaymentAllocation[] = [];
  const selected = new Set<string>();
  for (const item of mutation.allocations) {
    const scope = scopes.find(candidate => candidate.key === item?.scope);
    const due = scope?.due ?? item?.due;
    if (!scope || selected.has(scope.key) || !Number.isSafeInteger(item.cents) || item.cents <= 0
        || typeof due !== "number" || !Number.isSafeInteger(due) || due < 0 || due > 99_999_999_999) {
      return { error: "Check the amount due and the transfer amount for each entry.", status: 400 } as const;
    }
    if (transfers.some(transfer => transfer.allocations.some(previous => previous.ids.some(id => scope.ids.includes(id)) && scopeKey(previous.ids) !== scope.key))) {
      return { error: "The player pairing changed after a transfer was confirmed. Review the original confirmation before allocating another transfer.", status: 409 } as const;
    }
    selected.add(scope.key);
    allocations.push({ ids: scope.ids, cents: item.cents, due, previouslyPaid: scope.previouslyPaid });
  }
  if (allocations.reduce((sum, item) => sum + item.cents, 0) !== receiptCents(details.amount)) {
    return { error: "The allocated amounts must add up to the received amount.", status: 400 } as const;
  }
  const transfer: PaymentTransfer = { id: crypto.randomUUID(), groupId: proof.groupId, slot: proof.photo.slot,
    proofVersion: proof.photo.proofVersion, contentVersion: proof.photo.contentVersion,
    details: { amount: details.amount, provider: details.provider.trim(), reference: details.reference, date: details.date, transferStatus: details.transferStatus },
    allocations, confirmedAt: new Date().toISOString() };
  return { state: applyPaymentTransfers(state, [...transfers, transfer], allocations) } as const;
}

export function undoPaymentTransfer(state: TournamentState, registrationId: string, transferId: string) {
  const transfer = groupPaymentTransfers(state, linkedPaymentIds(state, registrationId)).find(item => item.id === transferId);
  if (!transfer) return null;
  return applyPaymentTransfers(state, state.paymentTransfers!.filter(item => item.id !== transfer.id), transfer.allocations);
}
