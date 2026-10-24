import type { Division, PlayerRegistration } from "./tournament";
import type { RegistrationDraft } from "./registration-draft";
export type RegistrationPricing = { entry: string; additionalEntry: string; additionalEntryNoShirt?: string; tournamentShirt: string; blackShirt: string };
export const emptyPricing = (): RegistrationPricing => ({ entry: "", additionalEntry: "", additionalEntryNoShirt: "", tournamentShirt: "", blackShirt: "" });
export function priceCents(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{1,6}(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export function normalizePricing(value?: Partial<RegistrationPricing>): RegistrationPricing {
  return Object.fromEntries(Object.keys(emptyPricing()).map(key => [key, priceCents(value?.[key as keyof RegistrationPricing]) === null ? "" : value![key as keyof RegistrationPricing]])) as RegistrationPricing;
}
export type ChargePerson = { name: string; divisionId: string; secondShirt?: "black" | "tournament" | "none" };
export type ChargeLine = { label: string; cents: number | null };
export function registrationCharges(divisions: Division[], people: ChargePerson[]) {
  const lines: ChargeLine[] = people.flatMap(person => {
    const division = divisions.find(item => item.id === person.divisionId);
    const prices = normalizePricing(division?.registrationPricing);
    return [
      { label: `${person.name} · ${division?.name || "Division"} · ${person.secondShirt ? "second" : "first"} entry`, cents: priceCents(person.secondShirt === "none" ? prices.additionalEntryNoShirt : person.secondShirt ? prices.additionalEntry : prices.entry) },
      { label: `${person.name} · ${person.secondShirt === "none" ? "no shirt" : person.secondShirt === "black" ? "black shirt" : "tournament shirt"}`, cents: person.secondShirt === "none" ? 0 : priceCents(person.secondShirt === "black" ? prices.blackShirt : prices.tournamentShirt) },
    ];
  });
  return { lines, total: lines.length && lines.every(line => line.cents !== null) ? lines.reduce((sum, line) => sum + line.cents!, 0) : null };
}
export function draftChargePeople(draft: RegistrationDraft, mode?: string): ChargePerson[] {
  return [{ name: draft.name, divisionId: draft.divisionId, secondShirt: draft.secondShirt }, ...(mode && mode !== "singles" ? [{ name: draft.partnerName, divisionId: draft.divisionId, secondShirt: draft.samePartner || draft.id ? draft.partnerSecondShirt : undefined }] : [])];
}
export function paymentGroupCharges(divisions: Division[], registrations: PlayerRegistration[], linkedIds: string[]) {
  return registrationCharges(divisions, registrations.filter(player => linkedIds.includes(player.id)));
}
export function formatPesos(cents: number) { return `PHP ${(cents / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
