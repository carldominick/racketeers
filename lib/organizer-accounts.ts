import { organizerPinMatches } from './organizer-auth';
import { describeOrganizerRequest, readableAuditDescription } from './organizer-audit-description';

export type AccountDB = { prepare(sql: string): { run(): Promise<unknown>; bind(...args: unknown[]): { first<T>(): Promise<T | null>; run(): Promise<unknown> } } };
export type OrganizerAccount = { id: string; username: string; manager: number; read_only: number; must_change: number; version: number };
const cookieName = '__Host-racketeers-organizer';
const viewerStateActions = ['verifyAccess', 'verifyOrganizer'];
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
export const digest = async (value: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
export async function passwordHash(password: string, salt = random()) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  // Workers bounds PBKDF2 at 100,000 iterations. Salted, versioned, never a plain digest.
  return `pbkdf2-sha256:100000:${salt}:${hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, key, 256))}`;
}
export async function passwordMatches(password: string, stored: string) {
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256' || parts[1] !== '100000') return false;
  const candidate = await passwordHash(password, parts[2]);
  let difference = candidate.length ^ stored.length;
  for (let i = 0; i < candidate.length; i++) difference |= candidate.charCodeAt(i) ^ (stored.charCodeAt(i) || 0);
  return difference === 0;
}
export async function accountSchema(db: AccountDB) {
  await db.prepare('CREATE TABLE IF NOT EXISTS organizer_accounts (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, manager INTEGER NOT NULL, read_only INTEGER NOT NULL DEFAULT 0, must_change INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS organizer_sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, version INTEGER NOT NULL, expires INTEGER NOT NULL)').run();
  await db.prepare('CREATE TABLE IF NOT EXISTS organizer_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, username TEXT NOT NULL, happened_at TEXT NOT NULL, action TEXT NOT NULL, outcome TEXT NOT NULL)').run();
}
export async function accountActor(request: Request, db: AccountDB): Promise<OrganizerAccount | null> {
  const token = request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return db.prepare('SELECT a.id, a.username, a.manager, a.read_only, a.must_change, a.version FROM organizer_accounts a JOIN organizer_sessions s ON s.user_id = a.id AND s.version = a.version WHERE s.token_hash = ? AND s.expires > ?').bind(await digest(token), Date.now()).first<OrganizerAccount>();
}
export async function organizerRequestMatches(request: Request, db: AccountDB, state: { organizerPinHash?: string; organizerAccountsEnabled?: boolean }, legacyPin = request.headers.get('x-organizer-pin'), readOnlyAction?: string) {
  if (!state.organizerAccountsEnabled) return organizerPinMatches(legacyPin, state.organizerPinHash);
  if (legacyPin !== 'session') return false;
  const actor = await accountActor(request, db);
  if (!actor || actor.must_change) return false;
  if (actor.read_only && !['GET','HEAD'].includes(request.method)) {
    if (new URL(request.url).pathname !== '/api/state') return false;
    if (readOnlyAction) return viewerStateActions.includes(readOnlyAction);
    if (request.bodyUsed) return false;
    const body = await request.clone().json() as {action?:string};
    return viewerStateActions.includes(body.action || '');
  }
  return true;
}
const reply = (value: unknown, status = 200, cookie?: string) => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
const sessionCookie = (token: string, age: number) => `${cookieName}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;
export async function auditStart(db: AccountDB, actor: OrganizerAccount, action: string) {
  return db.prepare("INSERT INTO organizer_audit (user_id, username, happened_at, action, outcome) VALUES (?, ?, ?, ?, 'Pending') RETURNING id").bind(actor.id, actor.username, new Date().toISOString(), action.slice(0, 300)).first<{ id: number }>();
}
export async function accountState(db: AccountDB) {
  return db.prepare('SELECT revision, payload FROM tournament_state WHERE id = ?').bind('racketeers').first<{ revision: number; payload: string }>();
}
export async function handleAccounts(request: Request, db: AccountDB): Promise<Response> {
  try {
    const row = await accountState(db), state = row ? JSON.parse(row.payload) : {};
    const actor = state.organizerAccountsEnabled ? await accountActor(request, db) : null;
    if (request.method === 'GET') {
      if (!actor) return reply({ configured: Boolean(state.organizerAccountsEnabled), error: 'Sign in to organizer access.' }, 401);
      const url = new URL(request.url);
      if (url.searchParams.has('audit')) {
        if ((!actor.manager && !actor.read_only) || actor.must_change) return reply({ error: 'Organizer history access required.' }, 403);
        const before = Number(url.searchParams.get('before') || Number.MAX_SAFE_INTEGER);
        const data = await db.prepare('SELECT json_group_array(json_object(\'id\',id,\'username\',username,\'at\',happened_at,\'action\',action,\'outcome\',outcome)) AS items FROM (SELECT * FROM organizer_audit WHERE id < ? ORDER BY id DESC LIMIT 100)').bind(Number.isSafeInteger(before) ? before : Number.MAX_SAFE_INTEGER).first<{ items: string }>();
        const events = JSON.parse(data?.items || '[]') as { action: string }[];
        return reply({ events: events.map(event => ({ ...event, action: readableAuditDescription(event.action) })) });
      }
      const data = !actor.must_change ? await db.prepare("SELECT json_group_array(json_object('id',id,'username',username,'manager',manager,'read_only',read_only,'must_change',must_change)) AS items FROM organizer_accounts").bind().first<{ items: string }>() : null;
      return reply({ actor, users: data ? JSON.parse(data.items) : [actor] });
    }
    if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405);
    const body = await request.json() as Record<string, unknown>;
    if (body.action === 'login') {
      if (!state.organizerAccountsEnabled) return reply({ error: 'Username or password did not match.' }, 401);
      const username = String(body.username || '').trim().toLowerCase(), password = String(body.password || '');
      if (username.length > 80 || password.length > 256) return reply({ error: 'Username or password did not match.' }, 401);
      // Atomic per-account admission also limits distributed attempts against one username.
      await db.prepare('CREATE TABLE IF NOT EXISTS organizer_login_limits (id TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL)').run();
      const now = Date.now();
      await db.prepare('DELETE FROM organizer_sessions WHERE expires <= ?').bind(now).run();
      await db.prepare('DELETE FROM organizer_login_limits WHERE expires <= ?').bind(now).run();
      const slot = await db.prepare('INSERT INTO organizer_login_limits VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN expires <= ? THEN 1 ELSE count+1 END, expires=CASE WHEN expires <= ? THEN excluded.expires ELSE expires END WHERE expires <= ? OR count < 15 RETURNING count').bind(await digest(username), now + 900000, now, now, now).first();
      if (!slot) return reply({ error: 'Too many sign-in attempts. Try again in 15 minutes.' }, 429);
      const user = await db.prepare('SELECT * FROM organizer_accounts WHERE username = ?').bind(username).first<OrganizerAccount & { password_hash: string }>();
      const valid = await passwordMatches(password, user?.password_hash || `pbkdf2-sha256:100000:${'0'.repeat(64)}:${'0'.repeat(64)}`);
      if (!user || !valid) return reply({ error: 'Username or password did not match.' }, 401);
      const token = random();
      await db.prepare('INSERT INTO organizer_sessions VALUES (?,?,?,?)').bind(await digest(token), user.id, user.version, now + 8 * 60 * 60 * 1000).run();
      return reply({ actor: { id: user.id, username: user.username, manager: user.manager, read_only: user.read_only, must_change: user.must_change, version: user.version } }, 200, sessionCookie(token, 28800));
    }
    if (body.action === 'logout') {
      if (actor) await db.prepare('DELETE FROM organizer_sessions WHERE user_id = ?').bind(actor.id).run();
      return reply({ ok: true }, 200, sessionCookie('', 0));
    }
    if (body.action === 'activate') {
      if (state.organizerAccountsEnabled || !row || !await organizerPinMatches(request.headers.get('x-organizer-pin'), state.organizerPinHash)) return reply({ error: 'Existing organizer access required; accounts must not already be active.' }, 403);
      await accountSchema(db);
      const batchDB = db as AccountDB & { batch(statements: unknown[]): Promise<{ meta: { changes: number } }[]> };
      const activation = crypto.randomUUID();
      const next = { ...state, organizerPinHash: undefined, organizerAccountsEnabled: true, organizerAccountsActivation: activation, paymentProofShareKey: random() };
      const credentials = await Promise.all(['carl.taboada', 'erin.kizel', 'regin.povz', 'racketeers'].map(async username => { const password = random().slice(0, 32); return { id: crypto.randomUUID(), username, password, hash: await passwordHash(password) }; }));
      const statements = [db.prepare('UPDATE tournament_state SET payload = ?, revision = revision + 1 WHERE id = ? AND revision = ?').bind(JSON.stringify(next), 'racketeers', row.revision), ...credentials.map(user => db.prepare("INSERT INTO organizer_accounts SELECT ?,?,?,?,?,1,1 WHERE EXISTS (SELECT 1 FROM tournament_state WHERE id = 'racketeers' AND json_extract(payload,'$.organizerAccountsActivation') = ?)").bind(user.id, user.username, user.hash, user.username === 'racketeers' ? 0 : 1, user.username === 'racketeers' ? 1 : 0, activation)), db.prepare("INSERT INTO organizer_audit (user_id,username,happened_at,action,outcome) SELECT 'setup','Initial setup',?,'Activated named organizer accounts','Succeeded' WHERE EXISTS (SELECT 1 FROM tournament_state WHERE json_extract(payload,'$.organizerAccountsActivation') = ?)").bind(new Date().toISOString(), activation)];
      const result = await batchDB.batch(statements);
      if (!result[0].meta.changes) return reply({ error: 'Tournament changed. Reload before activating accounts.' }, 409);
      return reply({ credentials: credentials.map(({ username, password }) => ({ username, password })) });
    }
    if (!actor) return reply({ error: 'Organizer sign-in required.' }, 401);
    const id = String(body.id || actor.id);
    if (actor.read_only && !actor.must_change) return reply({error:'This account has view-only access.'},403);
    if ((id !== actor.id && !actor.manager) || (actor.must_change && id !== actor.id)) return reply({ error: 'Account manager access required.' }, 403);
    const target = await db.prepare('SELECT * FROM organizer_accounts WHERE id = ?').bind(id).first<OrganizerAccount & { password_hash: string }>();
    if (!target) return reply({ error: 'Account not found.' }, 404);
    if (!['update', 'reset'].includes(String(body.action))) return reply({ error: 'Unknown account action.' }, 400);
    const actingUser = id === actor.id ? target : await db.prepare('SELECT password_hash FROM organizer_accounts WHERE id=?').bind(actor.id).first<{password_hash:string}>();
    if (!actingUser || !await passwordMatches(String(body.currentPassword || ''), actingUser.password_hash)) return reply({ error: 'Current password did not match.' }, 401);
    const username = String(body.username || target.username).trim().toLowerCase();
    if (actor.read_only && username !== target.username) return reply({error:'This account has view-only access.'},403);
    if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(username)) return reply({ error: 'Use 3–80 letters, digits, dots, underscores or hyphens.' }, 400);
    const password = body.action === 'reset' && id !== actor.id ? random().slice(0,32) : String(body.password || '');
    if (password && (password.length < 14 || password.length > 256)) return reply({ error: 'Use a password of 14–256 characters.' }, 400);
    if (password && await passwordMatches(password, target.password_hash)) return reply({error:'Choose a different password from the current password.'},400);
    if (actor.must_change && !password) return reply({ error: 'Choose a new password before continuing.' }, 400);
    const audit = await auditStart(db, actor, `${password ? 'Changed password' : 'Changed username'} for account ${target.username}`);
    try {
      const batchDB = db as AccountDB & { batch(statements: unknown[]): Promise<{meta:{changes:number}}[]> };
      const results = await batchDB.batch([db.prepare('UPDATE organizer_accounts SET username=?, password_hash=?, must_change=?, version=version+1 WHERE id=? AND version=?').bind(username, password ? await passwordHash(password) : target.password_hash, password ? id !== actor.id ? 1 : 0 : target.must_change, id, target.version), db.prepare("UPDATE organizer_audit SET outcome='Succeeded' WHERE id=? AND changes() > 0").bind(audit?.id)]);
      const updated = results[0];
      if (!updated.meta.changes) return reply({error:'Account changed at the same time. Reload before retrying.'},409);
    } catch { return reply({ error: 'Account could not be updated. The username may already be in use.' }, 409); }
    return reply({ ok: true, ...(id !== actor.id && password ? { initialPassword: password } : {}) }, 200, id === actor.id ? sessionCookie('', 0) : undefined);
  } catch { return reply({ error: 'Account service unavailable. Please retry.' }, 503); }
}

/** Durable intent precedes a write. Pending means outcome unknown, never a claim of success. */
export async function auditedOrganizerRequest(request: Request, db: AccountDB, next: (request: Request) => Promise<Response>) {
  if (!new URL(request.url).pathname.startsWith('/api/') || ['GET','HEAD'].includes(request.method)) return next(request);
  const row = await accountState(db);
  if (!row || !JSON.parse(row.payload).organizerAccountsEnabled) return next(request);
  const actor = await accountActor(request, db);
  if (!actor) return next(request);
  const url = new URL(request.url);
  const body = request.headers.get('content-type')?.startsWith('application/json')
    ? await request.clone().json() as { action?: unknown; state?: unknown; expectedRevision?: unknown } : {};
  const details = request.method === 'PUT' && body?.expectedRevision !== row.revision ? {} : body || {};
  const action = describeOrganizerRequest(request.method, url, details, JSON.parse(row.payload));
  const audit = await auditStart(db, actor, action);
  if (!audit) return reply({error:'Audit recording unavailable. No change was attempted.'},503);
  let allowed = true;
  if (actor.read_only) {
    const requestedAction = typeof body?.action === 'string' ? body.action : '';
    allowed = url.pathname === '/api/organizers' && ['login','logout','update'].includes(requestedAction) || url.pathname === '/api/state' && viewerStateActions.includes(requestedAction);
  }
  const response = allowed ? await next(request) : reply({error:'This organizer account is view-only.'},403);
  try { await db.prepare('UPDATE organizer_audit SET outcome=? WHERE id=?').bind(response.ok ? 'Succeeded' : `Rejected (${response.status})`, audit.id).run(); }
  catch { /* Keep durable Pending intent; do not turn a committed write into an unsafe retry. */ }
  return response;
}
