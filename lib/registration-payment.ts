import type { Division, PlayerRegistration } from "./tournament";

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
