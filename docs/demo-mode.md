# Organizer demo mode

Open **Organizer → Prepare → Setup → Open organizer demo**. It opens `/demo` in a separate tab and asks for the current real organizer PIN. Spectator, umpire and registration PINs cannot authorize entry. The server checks the stored organizer hash; the normal same-origin, size and failed-credential limits apply. A direct URL shows the sign-in gate, and preview query parameters do not unlock it.

The demo contains fictional players, a doubles division, ready matches and three sample screenshots in the first shared payment group. It copies no live tournament records, settings or receipts. Use fictional information and sample images while practicing.

- Start in Registration to test player registration, pairing, prices, shirts, photo addition/replacement, receipt review and OCR.
- The first payment group has three screenshots, leaving one slot to exercise the four-photo limit.
- Change the phase to Live to practice court dispatch and scoring. Initial match PINs are `4317`; initial registration PINs are `12345678`. The demo's own organizer PIN is `98765432` and shared umpire PIN is `87654321`. These are fictional credentials used by the local simulator, separate from the PIN required to enter it.
- Test sponsor images, payment instructions, projector slides and print/export actions in the same tab. Exported receipt links are temporary blob URLs and stop working when the demo tab closes or resets. They are not public seven-day share links.
- Use Projector in this tab to test displays. The separate `/courts` popup is intentionally unavailable in demo mode because it polls the real public court API.

The banner identifies demo mode throughout the session. Changes and uploaded images stay in that tab's memory. Reloading, resetting, leaving or the 30-minute session expiry discards them. Reset asks before discarding changes and returns to organizer sign-in. Separate demo tabs have separate records; they do not simulate shared cross-device storage or durable offline saves.

## Isolation and implementation

`POST /api/demo` only verifies organizer access and returns an expiry time. It does not return live state or create a demo row/bucket. The real entry PIN is cleared from the form after authorization and is not passed to the simulator.

After authorization, the `/demo` document installs its own API transport before mounting the application. State and payment handlers run against a browser-only database/object-store adapter. Unknown requests, expired sessions and closed transports return errors without falling back to live APIs. Leaving uses a full document navigation so the live app starts with its normal transport. QR/sponsor previews and receipt exports use local blob URLs. The initial synthetic receipt and OCR assets are static files.

The state handlers were extracted unchanged into `lib/state-handlers.ts` with injected database/initial-PIN access. The production route supplies the actual Cloudflare environment; demo sessions supply independent memory stores. Shared scoring, registration, revision/CAS, proof ownership, limits and receipt-review logic are exercised through these handlers. The demo is a functional practice environment, not evidence that real Cloudflare credentials, D1/R2 durability, multi-device concurrency, delivery networks or every bank receipt have been tested.

No new Cloudflare binding, production storage table, database migration or live tournament mutation is needed. Existing deployment safeguards still apply when releasing this code.
