/** Only the isolated /demo document can install an in-memory API transport. */
type DemoTransport = { send: typeof globalThis.fetch; assetUrl(path: string): string; close(): void };
let demo: DemoTransport | null = null;
export function installDemoTransport(transport: DemoTransport) {
  if (typeof window === "undefined" || window.location.pathname !== "/demo") throw new Error("Demo transport requires the demo page.");
  demo?.close(); demo = transport;
  return () => { transport.close(); if (demo === transport) demo = null; };
}
export const demoModeActive = () => Boolean(demo);
export function apiAssetUrl(path: string) { return demo ? demo.assetUrl(path) : path; }
export const apiFetch: typeof globalThis.fetch = (input, init) => {
  if (demo) return demo.send(input, init);
  // A pending/expired demo must never fall through to production APIs.
  if (typeof window !== "undefined" && window.location.pathname === "/demo") return Promise.resolve(Response.json({ error: "Sign in again to start a fresh demo." }, { status: 401 }));
  return globalThis.fetch(input, init);
};
