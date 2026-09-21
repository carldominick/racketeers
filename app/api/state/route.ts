import { hydrateTournament, initialTournament, isSetWon, makeRegistration, makeRegistrationEditPin, syncRegistrationsToEntries, type PlayerRegistration, type TournamentState } from "../../../lib/tournament";

const ROW_ID = "racketeers";

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
  safe.registrations = [];
  safe.matches = safe.matches.map((match) => ({ ...match, pin: "" }));
  return safe;
}

async function authorized(pin: string | null, state: TournamentState) {
  return Boolean(pin && state.organizerPinHash && (await sha(pin)) === state.organizerPinHash);
}

function clean(value: unknown, max = 80) {
  return String(value ?? "").trim().slice(0, max);
}

function editableRegistration(registration: PlayerRegistration, state?: TournamentState) {
  const { registrationPinHash: _secret, ...safe } = registration;
  void _secret;
  const partner = state?.registrations.find((candidate) => candidate.id === registration.partnerId);
  return { ...safe, partnerName: partner?.name ?? safe.partnerName, partnerShirtSize: partner?.shirtSize ?? "M", partnerDesiredLevel: partner?.desiredLevel ?? safe.desiredLevel };
}

async function registrationForPin(state: TournamentState, value: string) {
  const pinHash = await sha(value);
  return state.registrations.find((registration) => registration.registrationPinHash === pinHash);
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
  return Response.json({ state: isOrganizer ? state : publicState(state), revision: row.revision, organizer: isOrganizer, updatedAt: row.updated_at });
}

export async function POST(request: Request) {
  const row = await ensureRow();
  const state = hydrateTournament(JSON.parse(row.payload) as TournamentState);
  const body = (await request.json()) as { action?: string; pin?: string; newPin?: string; matchId?: string; registration?: Partial<PlayerRegistration> & { partnerShirtSize?: string; partnerDesiredLevel?: string } };
  if (body.action === "verifyOrganizer") {
    const ok = await authorized(body.pin ?? null, state);
    return Response.json({ ok }, { status: ok ? 200 : 401 });
  }
  if (body.action === "changeOrganizerPin") {
    if (!(await authorized(body.pin ?? null, state))) return Response.json({ error: "Current organizer PIN did not match." }, { status: 401 });
    const newPin = clean(body.newPin, 10);
    if (!/^\d{4,10}$/.test(newPin)) return Response.json({ error: "The new organizer PIN must contain 4–10 digits." }, { status: 400 });
    const saved = await saveStateAtRevision({ ...state, organizerPinHash: await sha(newPin) }, row.revision);
    if (!saved) return Response.json({ error: "Tournament settings changed at the same time. Please try again." }, { status: 409 });
    return Response.json({ ok: true, revision: saved.revision });
  }
  if (body.action === "verifyMatch") {
    const matches = state.matches.filter((item) => item.pin === body.pin && !item.validated);
    if (matches.length > 1) return Response.json({ error: "This PIN matches more than one game. Ask the organizer to regenerate the match PINs." }, { status: 409 });
    const match = matches[0];
    return Response.json({ ok: Boolean(match), match: match ? { ...match, pin: "" } : null }, { status: match ? 200 : 401 });
  }
  if (body.action === "lookupRegistration") {
    const registration = body.pin ? await registrationForPin(state, body.pin) : null;
    return Response.json({ ok: Boolean(registration), registration: registration ? editableRegistration(registration, state) : null }, { status: registration ? 200 : 401 });
  }
  if (body.action === "registerPlayer") {
    if (state.status !== "registration") return Response.json({ error: "Player registration is not currently open." }, { status: 423 });
    const form = body.registration ?? {};
    const division = state.divisions.find((item) => item.id === form.divisionId);
    if (!division || !clean(form.name)) return Response.json({ error: "A player name and division are required." }, { status: 400 });
    let editPin = "";
    let registrationPinHash = "";
    for (let attempt = 0; attempt < 20; attempt++) {
      editPin = makeRegistrationEditPin();
      registrationPinHash = await sha(editPin);
      if (!state.registrations.some((registration) => registration.registrationPinHash === registrationPinHash)) break;
    }
    const registeredLevel = clean(form.desiredLevel, 30) || "Beginner";
    const registration = { ...makeRegistration(division.id, state.registrations.length), name: clean(form.name), partnerName: "", shirtSize: clean(form.shirtSize, 8) || "M", playerLevel: registeredLevel, desiredLevel: registeredLevel, teamName: clean(form.teamName), registrationPinHash, selfRegistered: true };
    const newRegistrations: PlayerRegistration[] = [registration];
    const partnerName = division.mode === "singles" ? "" : clean(form.partnerName);
    if (partnerName) {
      const partnerRegisteredLevel = clean(form.partnerDesiredLevel, 30) || registeredLevel;
      const partner = { ...makeRegistration(division.id, state.registrations.length + 1), name: partnerName, shirtSize: clean(form.partnerShirtSize, 8) || "M", playerLevel: partnerRegisteredLevel, desiredLevel: partnerRegisteredLevel, teamName: clean(form.teamName), partnerId: registration.id, selfRegistered: true };
      registration.partnerId = partner.id;
      newRegistrations.push(partner);
    }
    const next = syncRegistrationsToEntries({ ...state, divisions: state.divisions.map((item) => item.id === division.id ? { ...item, registrationManaged: true } : item), registrations: [...state.registrations, ...newRegistrations] });
    const saved = await saveStateAtRevision(next, row.revision);
    if (!saved) return Response.json({ error: "Registration changed at the same time. Please submit once more." }, { status: 409 });
    return Response.json({ ok: true, registration: editableRegistration(registration, next), editPin, revision: saved.revision });
  }
  if (body.action === "updateRegistration") {
    if (state.status !== "registration") return Response.json({ error: "Registration changes are locked once the tournament is no longer in the registration phase." }, { status: 423 });
    const existing = body.pin ? await registrationForPin(state, body.pin) : null;
    const form = body.registration ?? {};
    if (!existing) return Response.json({ error: "Registration PIN did not match." }, { status: 401 });
    const divisionId = clean(form.divisionId) || existing.divisionId;
    const division = state.divisions.find((item) => item.id === divisionId);
    if (!division || !clean(form.name ?? existing.name)) return Response.json({ error: "A player name and division are required." }, { status: 400 });
    const registeredLevel = clean(form.desiredLevel ?? existing.desiredLevel, 30) || "Beginner";
    const existingPartner = state.registrations.find((candidate) => candidate.id === existing.partnerId);
    const partnerRegisteredLevel = clean(form.partnerDesiredLevel ?? existingPartner?.desiredLevel ?? registeredLevel, 30) || registeredLevel;
    const partnerName = division.mode === "singles" ? "" : clean(form.partnerName ?? existingPartner?.name);
    let updatedPartner = existingPartner ? { ...existingPartner, divisionId, name: partnerName, shirtSize: clean(form.partnerShirtSize ?? existingPartner.shirtSize, 8) || "M", desiredLevel: partnerRegisteredLevel, teamName: clean(form.teamName ?? existingPartner.teamName) } : null;
    if (!updatedPartner && partnerName) updatedPartner = { ...makeRegistration(divisionId, state.registrations.length), name: partnerName, shirtSize: clean(form.partnerShirtSize, 8) || "M", desiredLevel: partnerRegisteredLevel, playerLevel: partnerRegisteredLevel, teamName: clean(form.teamName), partnerId: existing.id, selfRegistered: true };
    const updated: PlayerRegistration = { ...existing, divisionId, name: clean(form.name ?? existing.name), partnerName: "", partnerId: updatedPartner?.id ?? null, shirtSize: clean(form.shirtSize ?? existing.shirtSize, 8), desiredLevel: registeredLevel, teamName: clean(form.teamName ?? existing.teamName) };
    if (updatedPartner) updatedPartner.partnerId = updated.id;
    let registrations = state.registrations.map((registration) => registration.id === existing.id ? updated : updatedPartner && registration.id === updatedPartner.id ? updatedPartner : registration);
    if (updatedPartner && !registrations.some((registration) => registration.id === updatedPartner!.id)) registrations = [...registrations, updatedPartner];
    if (!updatedPartner && existingPartner) registrations = registrations.filter((registration) => registration.id !== existingPartner.id);
    const next = syncRegistrationsToEntries({ ...state, divisions: state.divisions.map((item) => item.id === divisionId ? { ...item, registrationManaged: true } : item), registrations });
    const saved = await saveStateAtRevision(next, row.revision);
    if (!saved) return Response.json({ error: "Registration changed at the same time. Please save once more." }, { status: 409 });
    return Response.json({ ok: true, registration: editableRegistration(updated, next), revision: saved.revision });
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
  if (body.expectedRevision !== row.revision) return Response.json({ error: "State changed on another device", state: current, revision: row.revision }, { status: 409 });
  const next = { ...hydrateTournament(body.state), organizerPinHash: current.organizerPinHash, updatedAt: new Date().toISOString() };
  const revision = row.revision + 1;
  const db = await database();
  const saved = await db.prepare("UPDATE tournament_state SET revision = ?, payload = ?, updated_at = ? WHERE id = ? AND revision = ?").bind(revision, JSON.stringify(next), next.updatedAt, ROW_ID, row.revision).run();
  if (saved.meta.changes !== 1) {
    const latest = await db.prepare("SELECT revision, payload FROM tournament_state WHERE id = ?").bind(ROW_ID).first<{ revision: number; payload: string }>();
    return Response.json({ error: "State changed on another device", state: latest ? hydrateTournament(JSON.parse(latest.payload) as TournamentState) : current, revision: latest?.revision ?? row.revision }, { status: 409 });
  }
  return Response.json({ state: next, revision });
}

export async function PATCH(request: Request) {
  const row = await ensureRow();
  const current = hydrateTournament(JSON.parse(row.payload) as TournamentState);
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
  await db.prepare("UPDATE tournament_state SET revision = ?, payload = ?, updated_at = ? WHERE id = ?").bind(revision, JSON.stringify(next), next.updatedAt, ROW_ID).run();
  return Response.json({ state: publicState(next), revision });
}
