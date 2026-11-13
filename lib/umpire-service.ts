import { courtOccupant, gameNumber, isFinished } from "./game-day";
import { identifyUmpire, issueUmpirePin, newUmpireSession, sessionTokenHash, umpireCookie, umpireSummary, UMPIRE_SESSION_SECONDS } from "./umpire-auth";
import { applyWorkflowAction, PRESENCE_GRACE_MS, requireUmpire, UmpireError, type Presence, type WorkflowInput } from "./umpire-workflow";
import { isMatchUsingCourt, type TournamentState } from "./tournament";
import { appendStaffNotification, recordCourtCompletions } from "./staff-events";
import { digest } from "./organizer-accounts";
import type { StateDatabase } from "./state-handlers";

type Saved = { state: TournamentState; revision: number };
type Context = Saved & { db: StateDatabase; secret: string; organizer: string | null; demoSession?: { token?: string; setToken: (token: string) => void }; save: (state: TournamentState) => Promise<Saved | null> };

const initialized = new WeakSet<StateDatabase>();
const lastPresenceCleanup = new WeakMap<StateDatabase, number>();
async function presenceTable(db: StateDatabase) {
  if (initialized.has(db)) return;
  await db.prepare("CREATE TABLE IF NOT EXISTS umpire_presence (id TEXT PRIMARY KEY, seen INTEGER NOT NULL)").run();
  initialized.add(db);
}

export async function courtPresence(db: StateDatabase, state: TournamentState, now = Date.now()): Promise<Presence> {
  const hashes = state.umpireDirectory?.members.flatMap(member => member.session && member.session.expires > now ? [member.session.hash] : []) ?? [];
  if (!hashes.length) return {};
  await presenceTable(db);
  const row = await db.prepare("SELECT json_group_object(id, seen) AS presence FROM umpire_presence WHERE seen > ?").bind(now - PRESENCE_GRACE_MS).first<{ presence: string }>();
  const records: Presence = JSON.parse(row?.presence || "{}");
  return Object.fromEntries(hashes.flatMap(hash => records[hash] ? [[hash, records[hash]]] : []));
}

async function heartbeat(db: StateDatabase, hash: string, now: number) {
  await presenceTable(db);
  await db.prepare("INSERT INTO umpire_presence (id, seen) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET seen = MAX(seen, excluded.seen)").bind(hash, now).run();
  if (now - (lastPresenceCleanup.get(db) ?? 0) >= 60_000) {
    lastPresenceCleanup.set(db, now);
    try { await db.prepare("DELETE FROM umpire_presence WHERE seen <= ?").bind(now - 24 * 60 * 60_000).run(); }
    catch { lastPresenceCleanup.delete(db); }
  }
}

const response = (data: unknown, status = 200, cookie?: string) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store", ...(cookie ? { "Set-Cookie": cookie } : {}) } });
const publicUmpireActions = new Set(["login", "logout", "duty", "acknowledge", "incorrectPlayers", "start", "score", "submit", "reportDispute", "correct", "escalate", "help"]);
const organizerActions = new Set(["enable", "newTournament", "add", "rename", "issuePin", "revokePin", "deactivate", "assignCourt", "resolvePlayers", "requeuePlayers", "returnDispute", "releaseDispute", "rule"]);

export async function handleUmpire(request: Request, context: Context, body?: WorkflowInput) {
  const { state, db, secret, organizer, revision, save, demoSession } = context;
  const now = Date.now();
  const directory = state.umpireDirectory ?? { scope: "", members: [] };
  const replace = (members = directory.members, scope = directory.scope, issuedKey?: string): TournamentState => ({
    ...state, managedUmpires: true,
    umpireDirectory: { scope, members, issuedKeys: scope === directory.scope ? [...(directory.issuedKeys ?? []), ...(issuedKey ? [issuedKey] : [])] : [] },
  });
  const persist = async (next: TournamentState) => {
    if (next === state) return { state, revision };
    const saved = await save(next);
    requireUmpire(saved, "Tournament data changed. Refresh and try again.");
    return saved;
  };
  const roster = async (next = state) => {
    const presence = await courtPresence(db, next, now);
    return next.umpireDirectory?.members.map(member => umpireSummary(member, presence, now)) ?? [];
  };
  try {
    const action = body?.action ?? "";
    const organizerRequest = request.headers.has("x-organizer-pin");
    if ((!body && organizerRequest) || organizerActions.has(action)) {
      requireUmpire(organizer, "Organizer access is required.", 403);
      if (!body) return response({ managed: Boolean(state.managedUmpires), revision, roster: await roster() });
      requireUmpire(body.expectedRevision === revision, "Tournament data changed. Refresh and try again.");
      const target = directory.members.find(member => member.id === body.umpireId);
      const match = state.matches.find(item => item.id === body.matchId);
      let next = state, pin: string | undefined;
      const activeMatch = (court?: number) => court ? courtOccupant(state, court) : undefined;
      const cleanName = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
      switch (action) {
        case "enable":
          requireUmpire(!state.managedUmpires, "Personal umpire access is already enabled.");
          requireUmpire(!state.matches.some(match => !isFinished(match) && (match.status === "live" || match.dispatchedAt)), "Finish or unassign current games before enabling personal umpire access.");
          requireUmpire(secret.length >= 32, "Configure the umpire credential secret first.", 503);
          next = { ...replace([], crypto.randomUUID()), umpirePinHash: undefined, matches: state.matches.map(match => ({ ...match, pin: "" })) };
          break;
        case "newTournament":
          requireUmpire(state.managedUmpires && ["setup", "registration"].includes(state.status) && !state.matches.some(item => isMatchUsingCourt(item) || item.dispatchedAt || item.umpireWorkflow && !["completed", "finalized_by_ruling", "voided"].includes(item.umpireWorkflow.phase)), "Finish or resolve current assignments before rotating tournament credentials.");
          next = replace(directory.members.map(({ id, name, inactive }) => ({ id, name, inactive })), crypto.randomUUID());
          break;
        case "add":
        case "rename": {
          requireUmpire(state.managedUmpires && cleanName.length >= 2 && cleanName.length <= 100, "Enter an umpire name of 2–100 characters.", 400);
          requireUmpire(!directory.members.some(member => member.id !== target?.id && member.name.toLowerCase() === cleanName.toLowerCase()), "An umpire with this name is already on the roster.");
          if (action === "rename") {
            requireUmpire(target, "Umpire not found.", 404);
            next = replace(directory.members.map(member => member.id === target.id ? { ...member, name: cleanName } : member));
          } else {
            const credentials = await issueUmpirePin(directory, secret);
            pin = credentials.pin;
            next = replace([...directory.members, { id: crypto.randomUUID(), name: cleanName, pinKey: credentials.pinKey, pinHash: credentials.pinHash }], directory.scope, credentials.pinKey);
          }
          break;
        }
        case "issuePin":
        case "revokePin":
        case "deactivate": {
          requireUmpire(target, "Umpire not found.", 404);
          if (action === "deactivate") requireUmpire(!activeMatch(target.court), "Hand off the assigned game before changing this umpire’s roster status.");
          const credentials = action === "issuePin" ? await issueUmpirePin(directory, secret) : undefined;
          if (credentials) {
            requireUmpire(!target.inactive, "Reactivate this umpire before issuing a PIN.");
            pin = credentials.pin;
          }
          const inactive = action === "deactivate" ? body.inactive !== false : target.inactive;
          next = replace(directory.members.map(member => member.id === target.id ? { ...member, inactive, court: inactive ? undefined : member.court, onDuty: false, pinKey: credentials?.pinKey, pinHash: credentials?.pinHash, session: undefined } : member), directory.scope, credentials?.pinKey);
          break;
        }
        case "assignCourt": {
          requireUmpire(state.managedUmpires && Number.isInteger(body.court) && body.court! > 0 && body.court! <= state.courts, "Choose a valid court.", 400);
          const court = body.court!;
          requireUmpire(!body.umpireId || target && !target.inactive, "Choose an active umpire.");
          requireUmpire(!target?.court || target.court === court || !activeMatch(target.court), "Hand off this umpire’s current game first.");
          const current = activeMatch(court);
          const previous = directory.members.find(member => member.court === court);
          if (previous?.id === target?.id) return response({ revision, roster: await roster() });
          if (current) {
            const flow = current.umpireWorkflow;
            const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
            requireUmpire(flow && target && reason, "Choose a replacement umpire and enter a handoff reason.");
            const presence = await courtPresence(db, state, now);
            const replacement = umpireSummary(target, presence, now);
            requireUmpire(replacement.onDuty && replacement.connected, "The replacement umpire must be connected and on duty.");
            next = { ...state, matches: state.matches.map(item => item.id === current.id ? {
              ...item, umpireWorkflow: { ...flow, umpireId: target.id, version: flow.version + 1, lastScoreOperation: undefined, handoffs: [...(flow.handoffs ?? []), { at: new Date(now).toISOString(), from: flow.umpireId, to: target.id, actor: organizer, reason }] },
            } : item) };
          }
          next = { ...next, managedUmpires: true, umpireDirectory: { ...directory, members: directory.members.map(member => member.id === target?.id ? { ...member, court } : member.court === court ? { ...member, court: undefined } : member) } };
          break;
        }
        default:
          requireUmpire(match, "Game not found.", 404);
          next = applyWorkflowAction(state, match, body, organizer, true, now);
      }
      const saved = await persist(next);
      return response({ managed: true, revision: saved.revision, ...(pin === undefined ? {} : { pin }) });
    }

    requireUmpire(!body || publicUmpireActions.has(action), "Unsupported umpire action.", 400);
    if (!state.managedUmpires) return response({ managed: false, authenticated: false }, body ? 403 : 200);
    if (action === "login") {
      const member = await identifyUmpire(directory, typeof body?.pin === "string" ? body.pin : "", secret);
      requireUmpire(member, "That PIN did not match an active umpire.", 401);
      const { token, session } = await newUmpireSession(now);
      await heartbeat(db, session.hash, now);
      await persist(replace(directory.members.map(item => item.id === member.id ? { ...item, session } : item)));
      demoSession?.setToken(token);
      return response({ authenticated: true }, 200, demoSession ? undefined : umpireCookie(token, UMPIRE_SESSION_SECONDS));
    }

    const hash = demoSession ? (demoSession.token ? await digest(demoSession.token) : "") : await sessionTokenHash(request);
    const member = directory.members.find(item => !item.inactive && item.session?.hash === hash && item.session.expires > now);
    if (!member) {
      if (action === "logout") demoSession?.setToken("");
      if (!body || action === "logout") return response({ managed: true, authenticated: false }, 200, action === "logout" ? umpireCookie() : undefined);
      throw new UmpireError("Your umpire session ended. Sign in again.", 401);
    }
    const occupied = activeGame(state, member.id, member.court);
    if (!body) {
      const seen = (await courtPresence(db, state, now))[hash] ?? 0;
      if (now - seen >= 10_000) await heartbeat(db, hash, now);
      const match = occupied;
      const division = state.divisions.find(item => item.id === match?.divisionId);
      return response({ managed: true, authenticated: true, name: member.name, court: member.court, onDuty: Boolean(member.onDuty), tournamentName: state.tournamentName, phase: state.status,
        match: match ? safeMatch(match) : null, gameNumber: match ? gameNumber(state, match) : null,
        division: division ? { id: division.id, name: division.name, mode: division.mode, entries: division.entries.filter(item => item.id === match?.entryAId || item.id === match?.entryBId).map(({ id, name, players }) => ({ id, name, players })) } : null,
        help: Boolean(member.court && state.courtHelp?.[member.court]) });
    }
    requireUmpire(state.status !== "completed" || action === "logout" || action === "duty" && body.onDuty === false, "The tournament is complete.");
    if (action === "duty" || action === "logout") {
      requireUmpire(action === "logout" || typeof body.onDuty === "boolean", "Choose whether you are on duty.", 400);
      requireUmpire(action === "duty" && body.onDuty || !occupied, "Finish or hand off the current game before going off duty.");
      await persist(replace(directory.members.map(item => item.id === member.id ? { ...item, onDuty: action === "duty" && body.onDuty === true, session: action === "logout" ? undefined : item.session } : item)));
      if (action === "logout") demoSession?.setToken("");
      return response({ ok: true }, 200, action === "logout" && !demoSession ? umpireCookie() : undefined);
    }
    requireUmpire(member.onDuty, "Start duty before operating this court.", 403);
    requireUmpire(state.status === "live", "The tournament must be Live to operate a court.");
    const match = state.matches.find(item => item.id === body.matchId);
    requireUmpire(match?.umpireWorkflow?.umpireId === member.id && match.court === member.court, "This game is no longer assigned to you.", 403);
    if (action === "help") {
      requireUmpire(occupied?.id === match.id && typeof body.clear === "boolean" && member.court, "This court is no longer assigned to you.", 403);
      const courtHelp = { ...state.courtHelp };
      if (body.clear) delete courtHelp[member.court];
      else courtHelp[member.court] = { id: crypto.randomUUID(), court: member.court, requestedAt: new Date(now).toISOString(), matchId: match.id };
      await persist(appendStaffNotification({ ...state, courtHelp }, { kind: body.clear ? "help_cleared" : "help_requested", court: member.court, matchId: match.id, matchLabel: match.label }));
      return response({ ok: true });
    }
    const next = applyWorkflowAction(state, match, body, member.id, false, now);
    const saved = await persist(next !== state && action === "score" ? recordCourtCompletions(state, next) : next);
    const updated = saved.state.matches.find(item => item.id === match.id);
    return response({ ok: true, match: updated ? safeMatch(updated) : null });
  } catch (error) {
    if (error instanceof UmpireError) return response({ error: error.message }, error.status);
    throw error;
  }
}

function safeMatch(match: TournamentState["matches"][number]) {
  const { umpireHistory, ...safe } = match;
  void umpireHistory;
  return { ...safe, pin: "" };
}

function activeGame(state: TournamentState, umpireId: string, court?: number) {
  const match = court ? courtOccupant(state, court) : undefined;
  return match?.umpireWorkflow?.umpireId === umpireId ? match : undefined;
}
