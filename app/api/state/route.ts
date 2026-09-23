import { hydrateTournament, initialTournament, isSetWon, makeRegistration, makeUniqueRegistration, makeRegistrationEditPin, syncRegistrationsToEntries, type PlayerRegistration, type TournamentState } from "../../../lib/tournament";

const ROW_ID = "racketeers";
type EntryForm = Partial<PlayerRegistration> & { partnerShirtSize?: string; partnerDesiredLevel?: string; partnerClub?: string; sourceRegistrationId?: string; samePartner?: boolean; partnerSecondShirt?: "black" | "tournament" };
type RegistrationForm = EntryForm & { secondEntry?: EntryForm };
function organizerState(state: TournamentState) {
  return { ...state, registrations: state.registrations.map(({ registrationPinRecovery: secret, ...registration }) => { void secret; return registration; }) };
}
function registrationsForHash(state: TournamentState, hash?: string) {
  return hash ? state.registrations.filter(r => r.registrationPinHash === hash).map(r => editableRegistration(r, state)) : [];
}

async function database() {
  const runtime = await import("cloudflare:workers");
  return runtime.env.DB;
}

async function sha(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function ensureRow() {
  const db = await database();
  await db.prepare(`CREATE TABLE IF NOT EXISTS tournament_state (
    id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL DEFAULT 1,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
  let row = await db.prepare("SELECT revision, payload, updated_at FROM tournament_state WHERE id = ?").bind(ROW_ID).first<{ revision: number; payload: string; updated_at: string }>();
  if (!row) {
    const state = initialTournament();
    const runtime = await import("cloudflare:workers");
    const initialPin = runtime.env.INITIAL_ORGANIZER_PIN;
    if (typeof initialPin !== "string" || !/^\d{4,10}$/.test(initialPin)) {
      throw new Error("Set the INITIAL_ORGANIZER_PIN Worker secret to 4–10 digits before first use.");
    }
    state.organizerPinHash = await sha(initialPin);
    await db.prepare("INSERT INTO tournament_state (id, revision, payload, updated_at) VALUES (?, 1, ?, ?)").bind(ROW_ID, JSON.stringify(state), state.updatedAt).run();
    row = { revision: 1, payload: JSON.stringify(state), updated_at: state.updatedAt };
  }
  return row;
}

function publicState(state: TournamentState) {
  const safe = structuredClone(state);
  delete safe.organizerPinHash;
  delete safe.umpirePinHash;
  safe.registrations = [];
  safe.matches = safe.matches.map((match) => ({ ...match, pin: "" }));
  return safe;
}

async function authorized(pin: string | null, state: TournamentState) {
  return Boolean(pin && state.organizerPinHash && (await sha(pin)) === state.organizerPinHash);
}

async function umpireAuthorized(request: Request, state: TournamentState) {
  if (await authorized(request.headers.get("x-organizer-pin"), state)) return true;
  const pin = request.headers.get("x-umpire-pin");
  return Boolean(pin && state.umpirePinHash && await sha(pin) === state.umpirePinHash);
}

function clean(value: unknown, max = 80) {
  return String(value ?? "").trim().slice(0, max);
}

function editableRegistration(registration: PlayerRegistration, state?: TournamentState) {
  const { registrationPinHash: _secret, registrationPinRecovery: _recovery, ...safe } = registration;
  void _secret; void _recovery;
  const partner = state?.registrations.find((candidate) => candidate.id === registration.partnerId);
  return { ...safe, partnerName: partner?.name ?? safe.partnerName, partnerShirtSize: partner?.shirtSize ?? "M", partnerDesiredLevel: partner?.desiredLevel ?? safe.desiredLevel, partnerClub: partner?.club ?? "", partnerSecondShirt: partner?.secondShirt, partnerId: partner?.id ?? null, partnerEntryCount: partner ? state?.registrations.filter(r => (r.personId || r.id) === (partner.personId || partner.id)).length : 0, entryCount: state?.registrations.filter(r => (r.personId || r.id) === (registration.personId || registration.id)).length ?? 1 };
}

async function registrationForPin(state: TournamentState, value: string, registrationId?: string) {
  const pinHash = await sha(value);
  return state.registrations.find((registration) => registration.registrationPinHash === pinHash && (!registrationId || registration.id === registrationId));
}

async function saveStateAtRevision(state: TournamentState, revision: number) {
  const nextRevision = revision + 1;
  const next = { ...state, updatedAt: new Date().toISOString() };
  const db = await database();
  const result = await db.prepare("UPDATE tournament_state SET revision = ?, payload = ?, updated_at = ? WHERE id = ? AND revision = ?").bind(nextRevision, JSON.stringify(next), next.updatedAt, ROW_ID, revision).run();
  return result.meta.changes === 1 ? { state: next, revision: nextRevision } : null;
}

export async function GET(request: Request) {
  const row = await ensureRow();
  const state = hydrateTournament(JSON.parse(row.payload) as TournamentState);
  const isOrganizer = await authorized(request.headers.get("x-organizer-pin"), state);
  if (request.headers.has("x-organizer-pin") && !isOrganizer) return Response.json({ error: "Organizer PIN did not match." }, { status: 401 });
  return Response.json({ state: isOrganizer ? organizerState(state) : publicState(state), revision: row.revision, organizer: isOrganizer, updatedAt: row.updated_at });
}

export async function POST(request: Request) {
  const row = await ensureRow();
  const state = hydrateTournament(JSON.parse(row.payload) as TournamentState);
  const body = (await request.json()) as { action?: string; pin?: string; newPin?: string; matchId?: string; registrationId?: string; registration?: RegistrationForm };
  if (body.action === "viewRegistrationPin" || body.action === "replaceRegistrationPin") {
    if (!(await authorized(request.headers.get("x-organizer-pin"), state))) return Response.json({ error: "Organizer access is required." }, { status: 401 });
    const selected = state.registrations.find(r => r.id === body.registrationId);
    if (!selected) return Response.json({ error: "Registration not found." }, { status: 404 });
    const owner = selected.registrationPinHash ? selected : state.registrations.find(r => r.id === selected.partnerId && r.partnerId === selected.id && r.registrationPinHash) || selected;
    if (body.action === "viewRegistrationPin") return Response.json({ pin: owner.registrationPinRecovery || null, canReplace: true }, { headers: { "Cache-Control": "private, no-store" } });
    let replacement = "", replacementHash = "";
    for (let n = 0; n < 20; n++) { replacement = makeRegistrationEditPin(); replacementHash = await sha(replacement); if (!state.registrations.some(r => r.registrationPinHash === replacementHash)) break; }
    if (state.registrations.some(r => r.registrationPinHash === replacementHash)) return Response.json({ error: "Could not create a unique PIN. Try again." }, { status: 503 });
    const registrations = state.registrations.map(r => r.id === owner.id || Boolean(owner.registrationPinHash && r.registrationPinHash === owner.registrationPinHash) ? { ...r, registrationPinHash: replacementHash, registrationPinRecovery: replacement } : r);
    const saved = await saveStateAtRevision({ ...state, registrations }, row.revision);
    if (!saved) return Response.json({ error: "Registration changed. Please try again." }, { status: 409 });
    return Response.json({ pin: replacement, revision: saved.revision }, { headers: { "Cache-Control": "private, no-store" } });
  }
  if (body.action === "verifyAccess") {
    if (await authorized(body.pin ?? null, state)) return Response.json({ role: "organizer" });
    if (body.pin && state.umpirePinHash && await sha(body.pin) === state.umpirePinHash) return Response.json({ role: "umpire" });
    return Response.json({ error: "Access PIN did not match." }, { status: 401 });
  }
  if (body.action === "changeUmpirePin") {
    if (!(await authorized(request.headers.get("x-organizer-pin"), state))) return Response.json({ error: "Organizer PIN required." }, { status: 401 });
    const newPin = body.newPin ?? "";
    if (!/^\d{8,10}$/.test(newPin)) return Response.json({ error: "Use 8–10 digits for the umpire PIN." }, { status: 400 });
    if (await authorized(newPin, state)) return Response.json({ error: "Use a different PIN from the organizer PIN." }, { status: 400 });
    const saved = await saveStateAtRevision({ ...state, umpirePinHash: await sha(newPin) }, row.revision);
    return saved ? Response.json({ ok: true, revision: saved.revision }) : Response.json({ error: "Settings changed. Try again." }, { status: 409 });
  }
  if (body.action === "verifyOrganizer") {
    const ok = await authorized(body.pin ?? null, state);
    return Response.json({ ok }, { status: ok ? 200 : 401 });
  }
  if (body.action === "changeOrganizerPin") {
    if (!(await authorized(body.pin ?? null, state))) return Response.json({ error: "Current organizer PIN did not match." }, { status: 401 });
    const newPin = clean(body.newPin, 10);
    if (!/^\d{8,10}$/.test(newPin)) return Response.json({ error: "The new organizer PIN must contain 8–10 digits." }, { status: 400 });
    if (await sha(newPin) === state.umpirePinHash) return Response.json({ error: "Use a different PIN from the umpire PIN." }, { status: 400 });
    const saved = await saveStateAtRevision({ ...state, organizerPinHash: await sha(newPin) }, row.revision);
    if (!saved) return Response.json({ error: "Tournament settings changed at the same time. Please try again." }, { status: 409 });
    return Response.json({ ok: true, revision: saved.revision });
  }
  if (body.action === "verifyMatch") {
    if (!(await umpireAuthorized(request, state))) return Response.json({ error: "Umpire page access is required." }, { status: 401 });
    const matches = state.matches.filter((item) => item.pin === body.pin && !item.validated);
    if (matches.length > 1) return Response.json({ error: "This PIN matches more than one game. Ask the organizer to regenerate the match PINs." }, { status: 409 });
    const match = matches[0];
    return Response.json({ ok: Boolean(match), match: match ? { ...match, pin: "" } : null }, { status: match ? 200 : 401 });
  }
  if (body.action === "lookupRegistration") {
    const registration = body.pin ? await registrationForPin(state, body.pin, body.registrationId) : null;
    return Response.json({ ok: Boolean(registration), registration: registration ? editableRegistration(registration, state) : null, registrations: registration ? registrationsForHash(state, registration.registrationPinHash) : [] }, { status: registration ? 200 : 401 });
  }
  if (body.action === "registerPlayer") {
    const isOrganizer = await authorized(request.headers.get("x-organizer-pin"), state);
    if (!isOrganizer && state.status !== "registration") return Response.json({ error: "Player registration is not currently open." }, { status: 423 });
    const form = body.registration ?? {};
    const division = state.divisions.find((item) => item.id === form.divisionId);
    if (!division || !clean(form.name)) return Response.json({ error: "A player name and division are required." }, { status: 400 });
    if (division.mode === "doubles" && !clean(form.partnerName)) return Response.json({ error: "Both player names are required." }, { status: 400 });
    const source = form.sourceRegistrationId ? state.registrations.find(r => r.id === form.sourceRegistrationId) : null;
    const sourceOwner = source && state.registrations.find(r => r.id === source.partnerId && r.partnerId === source.id);
    if (form.sourceRegistrationId && (!source || !isOrganizer && (!body.pin || ![source.registrationPinHash, sourceOwner?.registrationPinHash].filter(Boolean).includes(await sha(body.pin))))) return Response.json({ error: "The original registration PIN is required to add a second entry." }, { status: 401 });
    const sourcePartner = source && form.samePartner && division.mode !== "singles" ? state.registrations.find(r => r.id === source.partnerId && r.partnerId === source.id) : null;
    for (const person of [source, sourcePartner]) {
      if (person && state.registrations.filter(r => (r.personId || r.id) === (person.personId || person.id)).length >= 2) return Response.json({ error: "This player already has two entries." }, { status: 409 });
    }
    if (source && !["black", "tournament"].includes(form.secondShirt || "")) return Response.json({ error: "Choose a black shirt or second tournament shirt." }, { status: 400 });
    if (sourcePartner && !["black", "tournament"].includes(form.partnerSecondShirt || "")) return Response.json({ error: "Choose the second shirt for the partner." }, { status: 400 });
    const second = form.secondEntry;
    const secondDivision = second && state.divisions.find(d => d.id === second.divisionId);
    if (second && (source || !secondDivision || typeof second !== "object" || Array.isArray(second))) return Response.json({ error: "Choose a valid division for the second entry. Only two entries are allowed." }, { status: 400 });
    if (second && !["black", "tournament"].includes(second.secondShirt || "")) return Response.json({ error: "Choose the second-entry shirt." }, { status: 400 });
    if (second && secondDivision?.mode === "doubles" && !clean(second.samePartner ? form.partnerName : second.partnerName)) return Response.json({ error: "Enter a partner for the second entry." }, { status: 400 });
    if (second?.samePartner && (!clean(form.partnerName) || division.mode === "singles")) return Response.json({ error: "The first entry has no partner to reuse." }, { status: 400 });
    if (second?.samePartner && secondDivision?.mode !== "singles" && !["black", "tournament"].includes(second.partnerSecondShirt || "")) return Response.json({ error: "Choose the partner’s second-entry shirt." }, { status: 400 });
    let editPin = "";
    let registrationPinHash = "";
    for (let attempt = 0; attempt < 20; attempt++) {
      editPin = makeRegistrationEditPin();
      registrationPinHash = await sha(editPin);
      if (!state.registrations.some((registration) => registration.registrationPinHash === registrationPinHash)) break;
    }
    if (state.registrations.some(registration => registration.registrationPinHash === registrationPinHash)) return Response.json({ error: "Unable to allocate a unique registration PIN. Please try again." }, { status: 503 });
    const registeredLevel = clean(form.desiredLevel, 30) || "Beginner";
    const registration = { ...makeUniqueRegistration(division.id, state.registrations.length, state.registrations), name: source?.name || clean(form.name), club: clean(form.club), personId: source ? source.personId || source.id : undefined, secondShirt: source ? form.secondShirt : undefined, partnerName: "", shirtSize: clean(form.shirtSize, 8) || "M", playerLevel: registeredLevel, desiredLevel: registeredLevel, teamName: clean(form.teamName), registrationPinHash, registrationPinRecovery: editPin, selfRegistered: true };
    const newRegistrations: PlayerRegistration[] = [registration];
    const partnerName = division.mode === "singles" ? "" : clean(form.partnerName);
    if (partnerName) {
      const partnerRegisteredLevel = clean(form.partnerDesiredLevel, 30) || registeredLevel;
      const partner = { ...makeUniqueRegistration(division.id, state.registrations.length + 1, [...state.registrations, ...newRegistrations]), name: sourcePartner?.name || partnerName, club: clean(form.partnerClub), personId: sourcePartner ? sourcePartner.personId || sourcePartner.id : undefined, secondShirt: sourcePartner ? form.partnerSecondShirt : undefined, shirtSize: clean(form.partnerShirtSize, 8) || "M", playerLevel: partnerRegisteredLevel, desiredLevel: partnerRegisteredLevel, teamName: clean(form.teamName), partnerId: registration.id, selfRegistered: true };
      registration.partnerId = partner.id;
      newRegistrations.push(partner);
    }
    const paymentGroupId = source?.paymentGroupId || source?.id || registration.id;
    newRegistrations.forEach(r => { r.paymentGroupId = paymentGroupId; });
    let existingRegistrations = state.registrations;
    if (source && !source.paymentGroupId) existingRegistrations = state.registrations.map(r => r.id === source.id || r.id === sourceOwner?.id ? { ...r, paymentGroupId } : r);
    if (second && secondDivision) {
      const linked: PlayerRegistration = { ...makeUniqueRegistration(secondDivision.id, state.registrations.length + newRegistrations.length, [...state.registrations, ...newRegistrations]), name: registration.name, club: registration.club, personId: registration.id, secondShirt: second.secondShirt, shirtSize: clean(second.shirtSize, 8) || registration.shirtSize, desiredLevel: registration.desiredLevel, playerLevel: registration.playerLevel, teamName: clean(second.teamName), registrationPinHash, registrationPinRecovery: editPin, paymentGroupId, selfRegistered: true };
      newRegistrations.push(linked);
      const firstPartner = newRegistrations.find(r => r.id === registration.partnerId);
      const secondPartnerName = secondDivision.mode === "singles" ? "" : clean(second.samePartner ? firstPartner?.name : second.partnerName);
      if (secondPartnerName) {
        const partner: PlayerRegistration = { ...makeUniqueRegistration(secondDivision.id, state.registrations.length + newRegistrations.length, [...state.registrations, ...newRegistrations]), name: secondPartnerName, club: second.samePartner ? firstPartner?.club : clean(second.partnerClub), personId: second.samePartner ? firstPartner?.id : undefined, secondShirt: second.samePartner ? second.partnerSecondShirt : undefined, shirtSize: clean(second.partnerShirtSize, 8) || firstPartner?.shirtSize || "M", desiredLevel: second.samePartner ? firstPartner?.desiredLevel || "Beginner" : clean(second.partnerDesiredLevel, 30) || "Beginner", playerLevel: second.samePartner ? firstPartner?.playerLevel || "Beginner" : clean(second.partnerDesiredLevel, 30) || "Beginner", teamName: linked.teamName, partnerId: linked.id, paymentGroupId, selfRegistered: true };
        linked.partnerId = partner.id; newRegistrations.push(partner);
      }
    }
    const divisionIds = new Set(newRegistrations.map(r => r.divisionId));
    const next = syncRegistrationsToEntries({ ...state, divisions: state.divisions.map(item => divisionIds.has(item.id) ? { ...item, registrationManaged: true } : item), registrations: [...existingRegistrations, ...newRegistrations] });
    const saved = await saveStateAtRevision(next, row.revision);
    if (!saved) return Response.json({ error: "Registration changed at the same time. Please submit once more." }, { status: 409 });
    return Response.json({ ok: true, registration: editableRegistration(registration, next), registrations: registrationsForHash(next, registrationPinHash), editPin, revision: saved.revision });
  }
  if (body.action === "updateRegistration") {
    if (state.status !== "registration") return Response.json({ error: "Registration changes are locked once the tournament is no longer in the registration phase." }, { status: 423 });
    const existing = body.pin ? await registrationForPin(state, body.pin, body.registrationId) : null;
    const form = body.registration ?? {};
    if (!existing) return Response.json({ error: "Registration PIN did not match." }, { status: 401 });
    const divisionId = clean(form.divisionId) || existing.divisionId;
    const division = state.divisions.find((item) => item.id === divisionId);
    if (!division || !clean(form.name ?? existing.name)) return Response.json({ error: "A player name and division are required." }, { status: 400 });
    if (division.mode === "doubles" && !clean(form.partnerName ?? state.registrations.find(r => r.id === existing.partnerId)?.name)) return Response.json({ error: "Both player names are required." }, { status: 400 });
    const registeredLevel = clean(form.desiredLevel ?? existing.desiredLevel, 30) || "Beginner";
    const existingPartner = state.registrations.find((candidate) => candidate.id === existing.partnerId);
    const partnerRegisteredLevel = clean(form.partnerDesiredLevel ?? existingPartner?.desiredLevel ?? registeredLevel, 30) || registeredLevel;
    const partnerName = division.mode === "singles" ? "" : clean(form.partnerName ?? existingPartner?.name);
    let updatedPartner: PlayerRegistration | null = existingPartner && partnerName ? { ...existingPartner, divisionId, name: partnerName, club: clean(form.partnerClub ?? existingPartner.club), secondShirt: existingPartner.secondShirt ? ((form.partnerSecondShirt ?? existingPartner.secondShirt) === "black" ? "black" as const : "tournament" as const) : undefined, shirtSize: clean(form.partnerShirtSize ?? existingPartner.shirtSize, 8) || "M", desiredLevel: partnerRegisteredLevel, teamName: clean(form.teamName ?? existingPartner.teamName) } : null;
    if (!updatedPartner && partnerName) updatedPartner = { ...makeRegistration(divisionId, state.registrations.length), name: partnerName, club: clean(form.partnerClub), shirtSize: clean(form.partnerShirtSize, 8) || "M", desiredLevel: partnerRegisteredLevel, playerLevel: partnerRegisteredLevel, teamName: clean(form.teamName), partnerId: existing.id, paymentGroupId: existing.paymentGroupId, selfRegistered: true };
    const updated: PlayerRegistration = { ...existing, divisionId, name: clean(form.name ?? existing.name), club: clean(form.club ?? existing.club), secondShirt: existing.secondShirt ? ((form.secondShirt ?? existing.secondShirt) === "black" ? "black" : "tournament") : undefined, partnerName: "", partnerId: updatedPartner?.id ?? null, shirtSize: clean(form.shirtSize ?? existing.shirtSize, 8), desiredLevel: registeredLevel, teamName: clean(form.teamName ?? existing.teamName) };
    if (updatedPartner) updatedPartner.partnerId = updated.id;
    let registrations = state.registrations.map((registration) => registration.id === existing.id ? updated : updatedPartner && registration.id === updatedPartner.id ? updatedPartner : registration);
    if (updatedPartner && !registrations.some((registration) => registration.id === updatedPartner!.id)) registrations = [...registrations, updatedPartner];
    if (!updatedPartner && existingPartner) registrations = registrations.filter((registration) => registration.id !== existingPartner.id);
    const next = syncRegistrationsToEntries({ ...state, divisions: state.divisions.map((item) => item.id === divisionId ? { ...item, registrationManaged: true } : item), registrations });
    const saved = await saveStateAtRevision(next, row.revision);
    if (!saved) return Response.json({ error: "Registration changed at the same time. Please save once more." }, { status: 409 });
    return Response.json({ ok: true, registration: editableRegistration(updated, next), registrations: registrationsForHash(next, updated.registrationPinHash), revision: saved.revision });
  }
  return Response.json({ error: "Unsupported action" }, { status: 400 });
}

export async function PUT(request: Request) {
  const row = await ensureRow();
  const current = hydrateTournament(JSON.parse(row.payload) as TournamentState);
  const pin = request.headers.get("x-organizer-pin");
  if (!(await authorized(pin, current))) return Response.json({ error: "Organizer PIN required" }, { status: 401 });
  const body = (await request.json()) as { state?: TournamentState; expectedRevision?: number };
  if (!body.state) return Response.json({ error: "State is required" }, { status: 400 });
  if (body.expectedRevision !== row.revision) return Response.json({ error: "State changed on another device", state: organizerState(current), revision: row.revision }, { status: 409 });
  const proposed = hydrateTournament(body.state);
  proposed.registrations = proposed.registrations.map(r => { const previous = current.registrations.find(p => p.id === r.id); return { ...r, registrationPinHash: previous?.registrationPinHash, registrationPinRecovery: previous?.registrationPinRecovery, paymentGroupId: previous?.paymentGroupId }; });
  const next = { ...proposed, organizerPinHash: current.organizerPinHash, umpirePinHash: current.umpirePinHash, updatedAt: new Date().toISOString() };
  const revision = row.revision + 1;
  const db = await database();
  const saved = await db.prepare("UPDATE tournament_state SET revision = ?, payload = ?, updated_at = ? WHERE id = ? AND revision = ?").bind(revision, JSON.stringify(next), next.updatedAt, ROW_ID, row.revision).run();
  if (saved.meta.changes !== 1) {
    const latest = await db.prepare("SELECT revision, payload FROM tournament_state WHERE id = ?").bind(ROW_ID).first<{ revision: number; payload: string }>();
    return Response.json({ error: "State changed on another device", state: organizerState(latest ? hydrateTournament(JSON.parse(latest.payload) as TournamentState) : current), revision: latest?.revision ?? row.revision }, { status: 409 });
  }
  return Response.json({ state: organizerState(next), revision });
}

export async function PATCH(request: Request) {
  const row = await ensureRow();
  const current = hydrateTournament(JSON.parse(row.payload) as TournamentState);
  if (!(await umpireAuthorized(request, current))) return Response.json({ error: "Umpire page access is required." }, { status: 401 });
  const body = (await request.json()) as { matchId?: string; pin?: string; sets?: Array<{ a: number; b: number; complete: boolean }>; status?: "ready" | "live" | "finished" };
  const match = current.matches.find((item) => item.id === body.matchId);
  if (!match || !body.pin || match.pin !== body.pin) return Response.json({ error: "Valid match PIN required" }, { status: 401 });
  if (match.validated) return Response.json({ error: "Organizer-validated games are locked" }, { status: 409 });
  const cap = match.format === "single_31" ? 35 : 30;
  const sets = (body.sets ?? match.sets).slice(0, match.format === "best_of_3_21" ? 3 : 1).map((set, index) => {
    const savedSet = match.sets[index];
    if (savedSet?.complete && set.complete) return savedSet;
    const sanitized = { a: Math.max(0, Math.min(cap, Math.floor(Number(set.a) || 0))), b: Math.max(0, Math.min(cap, Math.floor(Number(set.b) || 0))), complete: false };
    return { ...sanitized, complete: Boolean(set.complete) && isSetWon(sanitized, match.stage, match.format) };
  });
  const next = { ...current, matches: current.matches.map((item) => item.id === match.id ? { ...item, sets, status: body.status === "finished" ? "live" as const : body.status ?? "live" } : item), updatedAt: new Date().toISOString() };
  const revision = row.revision + 1;
  const db = await database();
  const saved = await db.prepare("UPDATE tournament_state SET revision = ?, payload = ?, updated_at = ? WHERE id = ? AND revision = ?").bind(revision, JSON.stringify(next), next.updatedAt, ROW_ID, row.revision).run();
  if (saved.meta.changes !== 1) return Response.json({ error: "Tournament changed at the same time. Please retry the score update." }, { status: 409 });
  return Response.json({ state: publicState(next), revision });
}
