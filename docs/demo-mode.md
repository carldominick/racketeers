# Organizer demo mode

Sign in through **Staff access → Organizer**, then open **Prepare → Setup → Open organizer demo**. If named organizer accounts are active, leave the demo PIN field blank and select **Start demo**. The demo uses the signed-in organizer session and requires edit access. On installations that still use the legacy organizer PIN, enter the current organizer PIN at the demo gate. The normal same-origin, size and failed-credential limits apply.

The demo starts in Registration with five fictional doubles divisions, ready matches, a schedule, twelve courts and two personal umpire accounts assigned to courts 1 and 2. The setup includes round-robin and elimination draws, multiple pools, sample registration prices and a future registration deadline. Use fictional information and sample images while practicing.

- Use **Prepare → Setup** or **Draw** to practice moving divisions up or down. The organizer and registration selectors use the saved order for the rest of the session.
- Practice registration, pairing, prices and shirts. The first payment group has three screenshots, leaving one slot for an upload. Use OCR to review two sample transfers that cover the pair's fee and one pending transfer. Confirm each completed transfer to see the pair's balance update.
- Open **Practice umpire devices** in the banner. The consoles display the generated practice PINs. Sign in and start duty, then switch the tournament to Live and dispatch a game to the staffed court from Game Day Desk. The two devices can practice scoring, player checks, no-shows, disputes and handoffs. Existing practice registrations use PIN `12345678`.
- Test sponsor images, payment instructions, projector slides and print/export actions in the same tab. Exported receipt links are temporary blob URLs and stop working when the demo tab closes or resets. They are not public seven-day share links.
- Open **Court view** from Game Day Desk to see the practice courts in this tab. Use **Back to organizer** to return to the desk. Projector also runs on the practice data. Manage real organizer accounts through the tournament site's **User management** tab.

The banner identifies demo mode throughout the session. Changes and uploaded images stay in that tab's memory. Reloading, resetting, leaving or the 30-minute session expiry discards them. Reset asks before discarding changes and returns to organizer sign-in. Separate demo tabs have separate records; they do not simulate shared cross-device storage or durable offline saves.

## Isolation and implementation

`POST /api/demo` verifies organizer access and returns an expiry time. The simulator starts from fictional data and uses its own practice PINs.

After authorization, the `/demo` document installs its own API transport before mounting the application. State and payment handlers run against a browser-only database/object-store adapter. Unknown requests, expired sessions and closed transports return errors without falling back to live APIs. Leaving uses a full document navigation so the live app starts with its normal transport. QR/sponsor previews and receipt exports use local blob URLs. The initial synthetic receipt and OCR assets are static files.

The state handlers were extracted unchanged into `lib/state-handlers.ts` with injected database/initial-PIN access. The production route supplies the actual Cloudflare environment; demo sessions supply independent memory stores. Shared scoring, registration, revision/CAS, proof ownership, limits and receipt-review logic are exercised through these handlers. The demo is a functional practice environment, not evidence that real Cloudflare credentials, D1/R2 durability, multi-device concurrency, delivery networks or every bank receipt have been tested.

No new Cloudflare binding, production storage table, database migration or live tournament mutation is needed. Existing deployment safeguards still apply when releasing this code.
