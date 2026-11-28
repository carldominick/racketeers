import { assignSchedule, initialTournament, makeDivision, makeRegistration, regenerateMatches, syncRegistrationsToEntries } from "./tournament";
import { issueUmpirePin } from "./umpire-auth";
import type { UmpireDirectory } from "./umpire-types";

export const DEMO_ORGANIZER_PIN = "98765432";
export const DEMO_REGISTRATION_PIN = "12345678";
export const DEMO_RECEIPT_FILES = ["demo-receipt.png", "demo-receipt-2.png", "demo-receipt-3.png"] as const;
export const demoHash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), b => b.toString(16).padStart(2, "0")).join("");

export async function demoFixture(umpireSecret: string) {
  const structure = [
    { name: "Practice Invitational", pairs: 6, pools: 2, bracket: "round_robin", entry: "950", second: "950", noShirt: "800" },
    { name: "Practice D/E", pairs: 4, pools: 1, bracket: "single_elimination", entry: "1500", second: "1200", noShirt: "1200" },
    { name: "Practice F", pairs: 4, pools: 1, bracket: "single_elimination", entry: "950", second: "950", noShirt: "800" },
    { name: "Practice G", pairs: 6, pools: 3, bracket: "single_elimination", entry: "950", second: "950", noShirt: "800" },
    { name: "Practice Club Invitational", pairs: 4, pools: 2, bracket: "single_elimination", entry: "950", second: "950", noShirt: "800" },
  ] as const;
  const divisions = structure.map(({ name, pools, bracket, entry, second, noShirt }, index) => ({
    ...makeDivision(name, "doubles"), id: `demo-division-${index + 1}`, subBracketCount: pools, bracketFormat: bracket,
    registrationPricing: { entry, additionalEntry: second, additionalEntryNoShirt: noShirt, tournamentShirt: "0", blackShirt: "0" },
  }));
  const firstNames = ["Miguel", "Elena", "Rafael", "Sofia", "Adrian", "Camila", "Gabriel", "Isabel"];
  const surnames = ["Santos", "Cruz", "Navarro", "Reyes", "Mendoza", "Flores", "Lim", "Ramos"];
  const nameAt = (index: number) => `${firstNames[index % firstNames.length]} ${surnames[(index + Math.floor(index / firstNames.length)) % surnames.length]}`;
  const pinHash = await demoHash(DEMO_REGISTRATION_PIN);
  let playerIndex = 0;
  const registrations = divisions.flatMap((division, divisionIndex) =>
    Array.from({ length: structure[divisionIndex].pairs * 2 }, () => {
      const index = playerIndex++;
      const partner = index % 2 ? index - 1 : index + 1;
      return {
        ...makeRegistration(division.id, index), id: `DEMO-PLAYER-${index + 1}`, name: nameAt(index),
        club: "Harbor Badminton Club", facebookProfile: "https://www.facebook.com/example.demo", phone: "09000000000",
        partnerId: `DEMO-PLAYER-${partner + 1}`, partnerName: nameAt(partner),
        paymentGroupId: `DEMO-PAYMENT-${Math.floor(index / 2) + 1}`, personId: `DEMO-PERSON-${index + 1}`,
        registrationPinHash: pinHash, registrationPinRecovery: DEMO_REGISTRATION_PIN,
      };
    })
  );
  const umpireDirectory: UmpireDirectory = { scope: crypto.randomUUID(), members: [] };
  const umpireSeats: { name: string; court: number; pin: string }[] = [];
  for (const [index, name] of ["Nina Javier", "Marco Rivera"].entries()) {
    const { pin, pinKey, pinHash } = await issueUmpirePin(umpireDirectory, umpireSecret);
    const court = index + 1;
    umpireDirectory.members.push({ id: `demo-umpire-${court}`, name, court, pinKey, pinHash });
    umpireSeats.push({ name, court, pin });
  }
  const manilaNow = Date.now() + 8 * 60 * 60_000;
  const futureDate = (days: number) => new Date(manilaNow + days * 24 * 60 * 60_000).toISOString().slice(0, 10);
  const day = futureDate(14);
  const state = assignSchedule(regenerateMatches(syncRegistrationsToEntries({
    ...initialTournament(), tournamentName: "Racketeers practice tournament", venue: "Demo sports hall",
    startDate: day, endDate: day, registrationClosesAt: `${futureDate(7)}T18:00`, courts: 12, status: "registration",
    divisions, registrations, organizerPinHash: await demoHash(DEMO_ORGANIZER_PIN), managedUmpires: true, umpireDirectory,
  })));
  state.matches = state.matches.map(match => ({ ...match, pin: "" }));
  return { state, umpireSeats };
}
