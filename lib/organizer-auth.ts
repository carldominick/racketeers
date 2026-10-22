/** Shared server-side organizer PIN verification. Never log supplied PINs. */
export async function organizerPinMatches(pin: string | null, hash: string | undefined): Promise<boolean> {
  if (!pin || !hash || !/^\d{4,10}$/.test(pin)) return false;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("") === hash;
}
