import type { Division, PlayerRegistration } from "./tournament";

export function registrationPaymentEntries(registrations: PlayerRegistration[], player: PlayerRegistration, mode?: Division["mode"]) {
  if (!mode || mode === "singles") return [player];
  // Legacy reciprocal pairs with no explicit group use the same shared receipt key.
  const partner = registrations.find(candidate => candidate.id !== player.id && candidate.id === player.partnerId &&
    candidate.partnerId === player.id && candidate.divisionId === player.divisionId &&
    (candidate.paymentGroupId || null) === (player.paymentGroupId || null));
  return partner ? [player, partner] : [player];
}
