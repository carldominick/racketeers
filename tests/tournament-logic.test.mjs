import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = await mkdtemp(path.join(tmpdir(), "racketeers-tests-"));
const outfile = path.join(dir, "logic.mjs");
await build({ entryPoints: [path.resolve("lib/tournament.ts")], outfile, bundle: true, platform: "node", format: "esm" });
const logic = await import(pathToFileURL(outfile));

// Explicit disposable fixtures. Production division creation never generates people.
function fixtureDivision(name, mode) {
 const division = {...logic.makeDivision(name, mode), registrationManaged:false};
 return logic.regenerateEntries(division);
}
function fixtureTournament() {
 const state = logic.initialTournament();
 return logic.regenerateMatches({...state,version:4,divisions:[fixtureDivision('Division 1','doubles')]});
}

test("new tournaments start with one empty customizable division", () => {
  const state = logic.initialTournament();
  assert.equal(state.status, "setup");
  assert.deepEqual(state.divisions.map((division) => division.name), ["Division 1"]);
  assert.equal(state.registrations.length, 0);
  assert.equal(state.divisions[0].entries.length, 0);
});

test("regular games use 31 win-by-two with a cap of 35", () => {
  assert.equal(logic.isSetWon({ a: 31, b: 30, complete: true }, "regular"), false);
  assert.equal(logic.isSetWon({ a: 32, b: 30, complete: true }, "regular"), true);
  assert.equal(logic.isSetWon({ a: 35, b: 34, complete: true }, "regular"), true);
});

test("rapid umpire point taps accumulate without reverting and respect score bounds", () => {
  let match = fixtureTournament().matches.find((item) => item.stage === "regular");
  for (let tap = 0; tap < 12; tap++) match = logic.adjustMatchScore(match, 0, "a", 1);
  assert.equal(match.sets[0].a, 12);
  for (let tap = 0; tap < 20; tap++) match = logic.adjustMatchScore(match, 0, "a", -1);
  assert.equal(match.sets[0].a, 0);
  for (let tap = 0; tap < 40; tap++) match = logic.adjustMatchScore(match, 0, "b", 1);
  assert.equal(match.sets[0].b, 35);
});

test("set completion is available only after a valid winning score", () => {
  let match = fixtureTournament().matches.find((item) => item.stage === "regular");
  match.sets = [{ a: 31, b: 30, complete: false }];
  assert.equal(logic.completeMatchSet(match, 0), match);
  match = logic.adjustMatchScore(match, 0, "a", 1);
  const completed = logic.completeMatchSet(match, 0);
  assert.equal(completed.sets[0].complete, true);
});

test("completed umpire sets stay locked until explicitly reopened", () => {
  let match = fixtureTournament().matches.find((item) => item.stage === "regular");
  match.sets = [{ a: 32, b: 30, complete: false }];
  match = logic.completeMatchSet(match, 0);
  const locked = logic.adjustMatchScore(match, 0, "a", 1);
  assert.equal(locked.sets[0].a, 32);
  assert.equal(locked.sets[0].complete, true);
  const reopened = logic.uncompleteMatchSet(locked, 0);
  assert.equal(reopened.sets[0].complete, false);
  const edited = logic.adjustMatchScore(reopened, 0, "a", -1);
  assert.equal(edited.sets[0].a, 31);
});

test("validated sets cannot be reopened", () => {
  const match = fixtureTournament().matches.find((item) => item.stage === "regular");
  match.sets = [{ a: 32, b: 30, complete: true }];
  match.validated = true;
  assert.equal(logic.uncompleteMatchSet(match, 0), match);
});

test("organizer validation locks the result and releases its court", () => {
  const state = fixtureTournament();
  const match = state.matches.find((item) => item.stage === "regular");
  match.court = 2;
  match.status = "live";
  match.sets = [{ a: 31, b: 15, complete: true }];
  const validated = logic.validateTournamentMatch(state, match.id);
  const result = validated.matches.find((item) => item.id === match.id);
  assert.equal(result.validated, true);
  assert.equal(result.status, "finished");
  assert.equal(result.court, null);
});

test("medal games require two completed winning sets", () => {
  const state = fixtureTournament();
  const match = state.matches.find((item) => item.stage === "gold");
  match.entryAId = state.divisions[0].entries[0].id;
  match.entryBId = state.divisions[0].entries[1].id;
  match.sets = [{ a: 21, b: 15, complete: true }, { a: 20, b: 22, complete: true }, { a: 21, b: 10, complete: true }];
  assert.equal(logic.matchWinner(match), match.entryAId);
});

test("standings resolve tied wins by point difference then points for", () => {
  const state = fixtureTournament();
  const division = state.divisions[0];
  const regular = state.matches.filter((match) => match.divisionId === division.id && match.stage === "regular");
  for (const match of regular) {
    match.sets = [{ a: 31, b: 20, complete: true }];
    match.status = "finished";
    match.validated = true;
  }
  const rows = logic.standingsFor(state, division.id);
  for (let index = 1; index < rows.length; index++) {
    const prev = rows[index - 1], current = rows[index];
    assert.ok(prev.wins > current.wins || prev.wins === current.wins && (prev.difference > current.difference || prev.difference === current.difference && prev.pointsFor >= current.pointsFor));
  }
});

test("direct medal games re-seed from the latest validated standings", () => {
  const state = fixtureTournament();
  const division = state.divisions[0];
  const regular = state.matches.filter((match) => match.divisionId === division.id && match.stage === "regular");
  regular.forEach((match, index) => { match.sets = [{ a: index % 2 ? 20 : 31, b: index % 2 ? 31 : 10, complete: true }]; match.status = "finished"; match.validated = true; });
  const ranked = logic.standingsFor(state, division.id).map((row) => row.entryId);
  const seeded = logic.reseedChampionships(state);
  const gold = seeded.matches.find((match) => match.divisionId === division.id && match.stage === "gold");
  const bronze = seeded.matches.find((match) => match.divisionId === division.id && match.stage === "bronze");
  assert.deepEqual([gold.entryAId, gold.entryBId], ranked.slice(0, 2));
  assert.deepEqual([bronze.entryAId, bronze.entryBId], ranked.slice(2, 4));
});

test("team rosters preserve pair-sized groups", () => {
  const division = fixtureDivision("Team Event", "team");
  division.playersPerTeam = 6;
  division.playersPerPair = 2;
  const updated = logic.regenerateEntries(division);
  assert.equal(updated.entries[0].players.length, 6);
  assert.equal(Math.ceil(updated.entries[0].players.length / updated.playersPerPair), 3);
});

test("schedule uses every available court without duplicate time slots", () => {
  const state = logic.assignSchedule({ ...fixtureTournament(), courts: 3, gameDuration: 20 });
  const seen = new Set();
  for (const match of state.matches) {
    const key = `${match.scheduledAt}-${match.court}`;
    assert.equal(seen.has(key), false);
    seen.add(key);
  }
});

test("unfinished court assignments block overlapping games", () => {
  const state = fixtureTournament();
  const [first, second] = state.matches;
  first.court = 1; first.scheduledAt = null; first.status = "live";
  second.court = null; second.scheduledAt = null;
  assert.equal(logic.isCourtAvailable(state, 1, second.id), false);
  first.status = "finished";
  assert.equal(logic.isCourtAvailable(state, 1, second.id), true);
});

test("registration partner selection synchronizes doubles entries", () => {
  const state = fixtureTournament();
  const division = state.divisions[0];
  const first = logic.makeRegistration(division.id, 0);
  const second = logic.makeRegistration(division.id, 1);
  first.name = "Alex"; second.name = "Sam";
  first.partnerId = second.id; second.partnerId = first.id;
  const synced = logic.syncRegistrationsToEntries({ ...state, registrations: [first, second] });
  const updated = synced.divisions.find((item) => item.id === division.id);
  assert.equal(updated.entries.length, 1);
  assert.deepEqual(updated.entries[0].players, ["Alex", "Sam"]);
  assert.deepEqual(new Set(updated.entries[0].registrationIds), new Set([first.id, second.id]));
});

test("registration remains the idempotent source for derived player entries", () => {
  const state = fixtureTournament();
  const division = state.divisions[0];
  const first = logic.makeRegistration(division.id, 0);
  const second = logic.makeRegistration(division.id, 1);
  first.name = "Source Player One";
  second.name = "Source Player Two";
  first.partnerId = second.id;
  second.partnerId = first.id;
  const once = logic.syncRegistrationsToEntries({ ...state, registrations: [first, second] });
  const twice = logic.syncRegistrationsToEntries(once);
  assert.equal(twice.registrations.length, 2);
  assert.equal(twice.divisions[0].entries.length, 1);
  assert.deepEqual(twice.divisions[0].entries[0].players, ["Source Player One", "Source Player Two"]);
  const renamedRegistrations = twice.registrations.map((player) => player.id === first.id ? { ...player, name: "Updated at Registration" } : player);
  const renamed = logic.syncRegistrationsToEntries({ ...twice, registrations: renamedRegistrations });
  assert.equal(renamed.registrations.length, 2);
  assert.equal(renamed.divisions[0].entries.length, 1);
  assert.equal(renamed.divisions[0].entries[0].players[0], "Updated at Registration");
});

test("hydration restores registration rows from managed entries after a public-view overwrite", () => {
  const state = fixtureTournament();
  state.divisions[0].registrationManaged = true;
  const first = logic.makeRegistration(state.divisions[0].id, 0);
  const second = logic.makeRegistration(state.divisions[0].id, 1);
  first.name = "Recovered One";
  second.name = "Recovered Two";
  first.partnerId = second.id;
  second.partnerId = first.id;
  first.desiredLevel = "Beginner";
  second.desiredLevel = "Advanced";
  first.shirtSize = "S";
  second.shirtSize = "XL";
  const synced = logic.syncRegistrationsToEntries({ ...state, registrations: [first, second] });
  const repaired = logic.hydrateTournament({ ...synced, registrations: [] });
  assert.equal(repaired.registrations.length, 2);
  assert.deepEqual(repaired.registrations.map((player) => player.name), ["Recovered One", "Recovered Two"]);
  assert.deepEqual(repaired.registrations.map((player) => player.desiredLevel), ["Beginner", "Advanced"]);
  assert.deepEqual(repaired.registrations.map((player) => player.shirtSize), ["S", "XL"]);
  assert.equal(repaired.registrations[0].partnerId, repaired.registrations[1].id);
  assert.equal(repaired.registrations[1].partnerId, repaired.registrations[0].id);
  assert.equal(logic.syncRegistrationsToEntries(repaired).divisions[0].entries.length, 1);
});

test("already paired players are hidden from unrelated partner selectors", () => {
  const divisionId = fixtureTournament().divisions[0].id;
  const first = logic.makeRegistration(divisionId, 0);
  const second = logic.makeRegistration(divisionId, 1);
  const third = logic.makeRegistration(divisionId, 2);
  const fourth = logic.makeRegistration(divisionId, 3);
  first.partnerId = second.id;
  second.partnerId = first.id;
  assert.deepEqual(logic.availablePartnerRegistrations([first, second, third, fourth], third).map((player) => player.id), [fourth.id]);
  assert.deepEqual(logic.availablePartnerRegistrations([first, second, third, fourth], first).map((player) => player.id), [second.id, third.id, fourth.id]);
});

test("removing the final registered player does not recreate placeholder players", () => {
  const state = fixtureTournament();
  const division = state.divisions[0];
  division.registrationManaged = true;
  const player = logic.makeRegistration(division.id, 0);
  const withPlayer = logic.syncRegistrationsToEntries({ ...state, registrations: [player] });
  assert.equal(withPlayer.divisions[0].entries.length, 1);
  const withoutPlayer = logic.syncRegistrationsToEntries({ ...withPlayer, registrations: [] });
  assert.equal(withoutPlayer.divisions[0].entries.length, 0);
  assert.equal(withoutPlayer.divisions[0].playerCount, 0);
});

test("organizers can add, duplicate, rename, and remove divisions safely", () => {
  let state = fixtureTournament();
  state = logic.addDivision(state, "Mixed Doubles");
  assert.equal(state.divisions.length, 2);
  assert.equal(state.divisions[1].name, "Mixed Doubles");
  state.divisions[1].name = "Corporate Mixed Doubles";
  state = logic.duplicateDivision(state, state.divisions[1].id);
  assert.equal(state.divisions.length, 3);
  assert.equal(state.divisions[2].name, "Corporate Mixed Doubles Copy");
  const removedId = state.divisions[1].id;
  state = logic.removeDivision(state, removedId);
  assert.equal(state.divisions.length, 2);
  assert.equal(state.divisions.some((division) => division.id === removedId), false);
  const oneDivision = fixtureTournament();
  assert.equal(logic.removeDivision(oneDivision, oneDivision.divisions[0].id).divisions.length, 1);
});

test("custom group brackets respect the organizer match count and format", () => {
  const state = fixtureTournament();
  const division = state.divisions[0];
  division.bracketFormat = "custom";
  division.customGroupGameCount = 5;
  division.groupMatchFormat = "best_of_3_21";
  const rebuilt = logic.regenerateMatches(state);
  const groupMatches = rebuilt.matches.filter((match) => match.divisionId === division.id && match.stage === "regular");
  assert.equal(groupMatches.length, 5);
  assert.ok(groupMatches.every((match) => match.format === "best_of_3_21"));
});

test("manual championship matchups are not overwritten by automatic reseeding", () => {
  const state = fixtureTournament();
  const division = state.divisions[0];
  division.manualChampionshipMatchups = true;
  const gold = state.matches.find((match) => match.divisionId === division.id && match.stage === "gold");
  gold.entryAId = division.entries[3].id;
  gold.entryBId = division.entries[2].id;
  const seeded = logic.reseedChampionships(state);
  const preserved = seeded.matches.find((match) => match.id === gold.id);
  assert.deepEqual([preserved.entryAId, preserved.entryBId], [division.entries[3].id, division.entries[2].id]);
});

test("older saved tournaments hydrate registration and match-format fields", () => {
  const state = fixtureTournament();
  delete state.registrations;
  for (const division of state.divisions) {
    delete division.groupMatchFormat;
    delete division.championshipMatchFormat;
    delete division.manualChampionshipMatchups;
  }
  for (const match of state.matches) delete match.format;
  const hydrated = logic.hydrateTournament(state);
  assert.deepEqual(hydrated.registrations, []);
  assert.ok(hydrated.matches.every((match) => match.format));
  assert.ok(hydrated.divisions.every((division) => division.groupMatchFormat && division.championshipMatchFormat));
});

test("sub-brackets split entries into balanced pools and qualify independently", () => {
  const state = fixtureTournament();
  const division = state.divisions[0];
  division.subBracketCount = 2;
  division.qualifiersPerSubBracket = 2;
  const rebuilt = logic.regenerateMatches(state);
  const poolA = rebuilt.matches.filter((match) => match.stage === "regular" && match.subBracket === 0);
  const poolB = rebuilt.matches.filter((match) => match.stage === "regular" && match.subBracket === 1);
  assert.ok(poolA.length > 0 && poolB.length > 0);
  assert.ok(poolA.every((match) => match.label.startsWith("Bracket A")));
  assert.ok(poolB.every((match) => match.label.startsWith("Bracket B")));
  assert.equal(new Set(poolA.flatMap((match) => [match.entryAId, match.entryBId])).size, 2);
  assert.equal(new Set(poolB.flatMap((match) => [match.entryAId, match.entryBId])).size, 2);
});

test("ladderized draws scale from round of 64 through the final", () => {
  const state = fixtureTournament();
  state.divisions[0].championshipFormat = "ladderized";
  state.divisions[0].knockoutSize = 64;
  const rebuilt = logic.regenerateMatches(state);
  const stages = new Set(rebuilt.matches.filter((match) => match.stage !== "regular" && match.stage !== "bronze").map((match) => match.stage));
  assert.deepEqual(stages, new Set(["round_64", "round_32", "round_16", "quarterfinal", "semifinal", "gold"]));
  assert.equal(rebuilt.matches.filter((match) => match.stage === "round_64").length, 32);
  assert.equal(rebuilt.matches.filter((match) => match.stage === "gold").length, 1);
});

test("validated ladder semifinals advance winners into the final", () => {
  let state = fixtureTournament();
  state.divisions[0].championshipFormat = "ladderized";
  state.divisions[0].knockoutSize = 4;
  state = logic.regenerateMatches(state);
  state.matches.filter((match) => match.stage === "regular").forEach((match, index) => { match.sets = [{ a: index % 2 ? 10 : 31, b: index % 2 ? 31 : 10, complete: true }]; match.status = "finished"; match.validated = true; });
  state = logic.reseedChampionships(state);
  const semis = state.matches.filter((match) => match.stage === "semifinal");
  assert.ok(semis.every((match) => match.entryAId && match.entryBId));
  for (const semi of semis) state = logic.validateTournamentMatch({ ...state, matches: state.matches.map((match) => match.id === semi.id ? { ...match, sets: [{ a: 21, b: 10, complete: true }, { a: 21, b: 12, complete: true }] } : match) }, semi.id);
  const final = state.matches.find((match) => match.stage === "gold");
  assert.deepEqual([final.entryAId, final.entryBId], semis.map((semi) => semi.entryAId));
});

test("un-validating a result preserves the score but unlocks organizer editing", () => {
  let state = fixtureTournament();
  const match = state.matches.find((item) => item.stage === "regular");
  match.sets = [{ a: 31, b: 18, complete: true }]; match.validated = true; match.status = "finished"; match.court = null;
  state = logic.unvalidateTournamentMatch(state, match.id);
  const corrected = state.matches.find((item) => item.id === match.id);
  assert.equal(corrected.validated, false);
  assert.equal(corrected.status, "live");
  assert.deepEqual(corrected.sets, [{ a: 31, b: 18, complete: true }]);
});

test("self-service typed pairs migrate into individual Players entries", () => {
  const state = fixtureTournament();
  const division = state.divisions[0];
  division.registrationManaged = true;
  const player = logic.makeRegistration(division.id, 0);
  player.name = "Jamie"; player.partnerName = "Taylor"; player.playerLevel = "Beginner"; player.desiredLevel = "Intermediate";
  const synced = logic.syncRegistrationsToEntries(logic.hydrateTournament({ ...state, registrations: [player] }));
  assert.deepEqual(synced.divisions[0].entries[0].players, ["Jamie", "Taylor"]);
  assert.deepEqual(synced.divisions[0].entries[0].desiredLevels, ["Intermediate", "Intermediate"]);
});

test("self-service registration PINs are eight numeric digits", () => {
  for (let index = 0; index < 100; index++) assert.match(logic.makeRegistrationEditPin(), /^\d{8}$/);
});

test("umpire PIN regeneration produces a visible unique four-digit PIN", () => {
  const state = fixtureTournament();
  const target = state.matches[0];
  const previous = target.pin;
  const updated = logic.regenerateMatchPin(state, target.id);
  const next = updated.matches.find((match) => match.id === target.id).pin;
  assert.match(next, /^\d{4}$/);
  assert.notEqual(next, previous);
  assert.equal(updated.matches.filter((match) => match.pin === next).length, 1);
});

test("hydration repairs missing and duplicate umpire PINs", () => {
  const state = fixtureTournament();
  state.matches[0].pin = "";
  state.matches[1].pin = state.matches[2].pin;
  const hydrated = logic.hydrateTournament(state);
  assert.ok(hydrated.matches.every((match) => /^\d{4}$/.test(match.pin)));
  assert.equal(new Set(hydrated.matches.map((match) => match.pin)).size, hydrated.matches.length);
});

test("legacy typed partners become separate player records with a reciprocal pair", () => {
  const state = fixtureTournament();
  const player = logic.makeRegistration(state.divisions[0].id, 0);
  player.name = "Legacy Player";
  player.partnerName = "Legacy Partner";
  const hydrated = logic.hydrateTournament({ ...state, registrations: [player] });
  assert.equal(hydrated.registrations.length, 2);
  const primary = hydrated.registrations.find((item) => item.name === "Legacy Player");
  const partner = hydrated.registrations.find((item) => item.name === "Legacy Partner");
  assert.equal(primary.partnerId, partner.id);
  assert.equal(partner.partnerId, primary.id);
  const synced = logic.syncRegistrationsToEntries(hydrated);
  assert.deepEqual(synced.divisions[0].entries[0].players, ["Legacy Player", "Legacy Partner"]);
});

test("64 disposable pairs form eight pools of eight and schedule next Saturday without mutating live-shaped input", () => {
  const untouched = fixtureTournament();
  const untouchedSnapshot = JSON.stringify(untouched);
  let simulation = fixtureTournament();
  const division = simulation.divisions[0];
  division.registrationManaged = true;
  division.pairCount = 64;
  division.playerCount = 128;
  division.subBracketCount = 8;
  division.qualifiersPerSubBracket = 2;
  division.championshipFormat = "ladderized";
  division.knockoutSize = 64;
  const registrations = [];
  const sizes = ["S", "M", "L", "XL"];
  for (let pairIndex = 0; pairIndex < 64; pairIndex++) {
    const first = logic.makeRegistration(division.id, pairIndex * 2);
    const second = logic.makeRegistration(division.id, pairIndex * 2 + 1);
    first.name = `Pair ${pairIndex + 1} · Player 1`;
    second.name = `Pair ${pairIndex + 1} · Player 2`;
    first.partnerId = second.id;
    second.partnerId = first.id;
    first.shirtSize = sizes[pairIndex % sizes.length];
    second.shirtSize = sizes[(pairIndex + 1) % sizes.length];
    first.desiredLevel = second.desiredLevel = pairIndex % 2 ? "Intermediate" : "Beginner";
    first.playerLevel = second.playerLevel = first.desiredLevel;
    first.poolOverride = second.poolOverride = pairIndex % 8;
    registrations.push(first, second);
  }
  simulation = logic.syncRegistrationsToEntries({ ...simulation, registrations });
  assert.equal(simulation.registrations.length, 128);
  assert.equal(simulation.divisions[0].entries.length, 64);
  assert.ok(simulation.divisions[0].entries.every((entry) => entry.players.length === 2 && entry.shirtSizes.length === 2));
  const pools = logic.distributeEntriesToPools(simulation.divisions[0]);
  assert.deepEqual(pools.map((pool) => pool.length), Array(8).fill(8));
  simulation = logic.regenerateMatches(simulation);
  assert.equal(simulation.matches.filter((match) => match.stage === "regular").length, 224);
  assert.equal(simulation.matches.filter((match) => match.stage === "round_64").length, 32);
  const nextSaturday = new Date();
  nextSaturday.setHours(12, 0, 0, 0);
  let daysAhead = (6 - nextSaturday.getDay() + 7) % 7;
  if (daysAhead === 0) daysAhead = 7;
  nextSaturday.setDate(nextSaturday.getDate() + daysAhead);
  const date = nextSaturday.toISOString().slice(0, 10);
  simulation = logic.assignSchedule({ ...simulation, startDate: date, endDate: date, dayStart: "08:00", dayEnd: "20:00", courts: 20, gameDuration: 25 });
  assert.ok(simulation.matches.every((match) => match.scheduledAt?.startsWith(date)));
  const firstMatch = simulation.matches.find((match) => match.stage === "regular");
  firstMatch.sets = [{ a: 31, b: 19, complete: true }];
  simulation = logic.validateTournamentMatch(simulation, firstMatch.id);
  assert.equal(simulation.matches.find((match) => match.id === firstMatch.id).validated, true);
  assert.equal(JSON.stringify(untouched), untouchedSnapshot);
});

test.after(async () => rm(dir, { recursive: true, force: true }));


test("new registration IDs are alphanumeric, random, and unique", () => {
  const registrations = Array.from({ length: 2000 }, () => logic.makeRegistration("division"));
  assert.equal(new Set(registrations.map(r => r.id)).size, 2000);
  for (const registration of registrations) assert.match(registration.id, /^REG[A-F0-9]{32}$/);
  const next = logic.makeUniqueRegistration("division", 2000, registrations);
  assert.ok(!registrations.some(r => r.id === next.id));
});
