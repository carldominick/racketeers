import { initialTournament, makeDivision, makeRegistration, regenerateMatches, syncRegistrationsToEntries } from "./tournament";
export const DEMO_ORGANIZER_PIN = "98765432";
export const DEMO_REGISTRATION_PIN = "12345678";
export const demoHash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), b => b.toString(16).padStart(2, "0")).join("");
export async function demoFixture() {
  const division = { ...makeDivision("Open doubles", "doubles"), id: "demo-division", subBracketCount: 1, registrationPricing: { entry: "625", additionalEntry: "400", tournamentShirt: "0", blackShirt: "0" } };
  const names = ["Miguel Santos", "Elena Cruz", "Rafael Navarro", "Sofia Reyes", "Adrian Mendoza", "Camila Flores", "Gabriel Lim", "Isabel Ramos"];
  const pinHash = await demoHash(DEMO_REGISTRATION_PIN);
  const registrations = names.map((name, index) => ({ ...makeRegistration(division.id, index), id: `DEMO-PLAYER-${index + 1}`, name, club: "Harbor Badminton Club", facebookProfile: "https://www.facebook.com/example.demo", phone: "09000000000", partnerId: `DEMO-PLAYER-${index % 2 ? index : index + 2}`, partnerName: names[index % 2 ? index - 1 : index + 1], paymentGroupId: `DEMO-PAYMENT-${Math.floor(index / 2) + 1}`, personId: `DEMO-PERSON-${index + 1}`, registrationPinHash: pinHash, registrationPinRecovery: DEMO_REGISTRATION_PIN }));
  const state = regenerateMatches(syncRegistrationsToEntries({ ...initialTournament(), tournamentName: "Racketeers practice tournament", venue: "Demo sports hall", courts: 4, divisions: [division], registrations, status: "registration", organizerPinHash: await demoHash(DEMO_ORGANIZER_PIN), umpirePinHash: await demoHash("87654321") }));
  state.matches = state.matches.map(match => ({ ...match, pin: "4317" }));
  return state;
}
