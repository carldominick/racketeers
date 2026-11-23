import { paymentTransferScopes, type PaymentTransfer } from "./registration-payment";
import type { TournamentState } from "./tournament";

export type RegistrationPaymentTotals = {
  scope: string;
  fees: number;
  validated: number;
  outstanding: number;
  needsReview: number;
  unpriced: number;
};

export function registrationPaymentReport(state: TournamentState, divisionId: string) {
  const players = state.registrations.filter(player => divisionId === "all" || player.divisionId === divisionId);
  const playerIds = new Set(players.map(player => player.id));
  const allScopes = paymentTransferScopes(state, state.registrations.map(player => player.id));
  const currentKeys = new Set(allScopes.map(scope => scope.key));
  const allocations = new Map<string, { transfer: PaymentTransfer; cents: number }[]>();
  for (const transfer of state.paymentTransfers ?? []) {
    for (const allocation of transfer.allocations) {
      const key = [...allocation.ids].sort().join("/");
      if (divisionId !== "all" && !allocation.ids.some(id => playerIds.has(id))) continue;
      const items = allocations.get(key) ?? [];
      items.push({ transfer, cents: allocation.cents });
      allocations.set(key, items);
    }
  }
  const scopes = allScopes.filter(scope => scope.ids.some(id => playerIds.has(id))).map(scope => ({
    ...scope,
    outstanding: scope.due === null || (scope.previouslyPaid.length > 0 && scope.confirmed < scope.due)
      ? null
      : Math.max(0, scope.due - scope.confirmed),
  }));
  const historical = [...allocations].filter(([key]) => !currentKeys.has(key)).map(([key, items]) => ({
    key,
    confirmed: items.reduce((total, item) => total + item.cents, 0),
  }));
  const totals: RegistrationPaymentTotals = {
    scope: divisionId === "all" ? "All divisions" : state.divisions.find(division => division.id === divisionId)?.name ?? "Selected division",
    fees: scopes.reduce((total, scope) => total + (scope.due ?? 0), 0),
    validated: scopes.reduce((total, scope) => total + scope.confirmed, 0) + historical.reduce((total, scope) => total + scope.confirmed, 0),
    outstanding: scopes.reduce((total, scope) => total + (scope.outstanding ?? 0), 0),
    needsReview: scopes.filter(scope => scope.outstanding === null).length + historical.length,
    unpriced: scopes.filter(scope => scope.due === null).length,
  };
  return { totals, scopes, historical, allocations };
}
