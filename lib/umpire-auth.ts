import { digest, passwordHash, passwordMatches } from "./organizer-accounts";
import type { UmpireDirectory, UmpireMember, UmpireSummary } from "./umpire-types";
import { PRESENCE_GRACE_MS, requireUmpire, type Presence } from "./umpire-workflow";

export const UMPIRE_SESSION_SECONDS = 12 * 60 * 60;
const cookieName = "__Host-racketeers-umpire";
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");

export function umpireCookie(token = "", age = 0) {
  return `${cookieName}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;
}

export async function sessionTokenHash(request: Request) {
  const token = request.headers.get("cookie")?.split(";").map(item => item.trim()).find(item => item.startsWith(cookieName + "="))?.slice(cookieName.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? digest(token) : "";
}

async function lookupKey(secret: string, scope: string, pin: string) {
  requireUmpire(secret.length >= 32, "Umpire sign-in is not configured. Ask the organizer.", 503);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${scope}:${pin}`))));
}

export function randomUmpirePin() {
  // Reject the incomplete range at the top to avoid modulo bias.
  const bound = Math.floor(2 ** 32 / 1_000_000) * 1_000_000;
  const value = new Uint32Array(1);
  do { crypto.getRandomValues(value); } while (value[0] >= bound);
  return String(value[0] % 1_000_000).padStart(6, "0");
}

export async function issueUmpirePin(directory: UmpireDirectory, secret: string, generate = randomUmpirePin) {
  const issued = new Set([...directory.members.map(member => member.pinKey), ...(directory.issuedKeys ?? [])]);
  for (let attempt = 0; attempt < 32; attempt++) {
    const pin = generate();
    const pinKey = await lookupKey(secret, directory.scope, pin);
    if (!issued.has(pinKey)) return { pin, pinKey, pinHash: await passwordHash(`${pinKey}:${pin}`) };
  }
  throw new Error("Unable to allocate a unique PIN.");
}

export async function identifyUmpire(directory: UmpireDirectory, pin: string, secret: string) {
  requireUmpire(/^\d{6}$/.test(pin), "Enter your six-digit umpire PIN.", 400);
  const key = await lookupKey(secret, directory.scope, pin);
  const member = directory.members.find(item => !item.inactive && item.pinKey === key && item.pinHash);
  if (!member?.pinHash || !await passwordMatches(`${key}:${pin}`, member.pinHash)) return null;
  return member;
}

export async function newUmpireSession(now: number) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  return { token, session: { hash: await digest(token), expires: now + UMPIRE_SESSION_SECONDS * 1000 } };
}

export function umpireSummary(member: UmpireMember, presence: Presence, now: number): UmpireSummary {
  const { id, name, inactive, court, onDuty } = member;
  return { id, name, inactive, court, onDuty, credential: Boolean(member.pinKey), connected: Boolean(member.session && member.session.expires > now && now - (presence[member.session.hash] ?? 0) < PRESENCE_GRACE_MS) };
}
