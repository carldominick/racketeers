# Racketeers Badminton Tournament Tracker

Standalone Cloudflare deployment of the Racketeers application. Includes tournament setup, individual registrations and pairing, pools and knockout draws, umpire scoring, organizer PIN controls, schedules, projector views, and printable scorecards.

## Deploy from the connected GitHub repository

1. In Cloudflare, create a D1 database named `racketeers-db`.
2. Copy its database ID into `wrangler.json`, replacing the placeholder `database_id`. Keep the binding name `DB`.
3. In Workers & Pages, connect this repository with these settings:
   - Worker name: `racketeers`
   - Production branch: `main`
   - Root directory: repository root
   - Build command: `npm run build`
   - Deploy command: `npm run deploy`
   - Node version: 22.16.0 or newer (Node 24 is also supported).
4. After the Worker is created, go to its Settings → Variables and Secrets. Add a **secret** named `INITIAL_ORGANIZER_PIN`, with a private 4–10 digit PIN. Save/deploy the setting before opening the application.
5. Open the Worker URL and unlock organizer access using that PIN. The application creates its tournament table and initial state on first use. The PIN can subsequently be changed inside the app; changing the secret does not replace a PIN already stored in the database.

The deploy command deliberately refuses deployment while the database ID is still the placeholder. The first API request will fail until the initial PIN secret is configured; this prevents creating a public instance with a known default PIN. Never put PINs, API tokens, or tournament exports into this repository.

## Existing tournament data

This repository contains source code only. It does not include current player records, registration PINs, payment details, or scores from the existing site. A new D1 database begins with a new tournament. Keep using the existing site until a separate data migration has been completed and verified. Do not enter the same event independently on both sites.

## Local development and checks

```sh
npm ci
npm test
npm run lint
npm run build
npm run test:render
```

`npm run dev` runs an isolated in-memory UI preview with mocked staff access and payment capabilities. For the actual Worker with local D1 bindings, use `npm run dev:worker` and keep any local `.dev.vars` ignored. Neither mode is evidence that production authorization has been tested.

## Architecture

React and TypeScript, with Vinext/Vite on Cloudflare Workers and D1. The `DB` binding stores the tournament state. Wrangler deploys the generated Vite Worker configuration and static assets. No ChatGPT sign-in or ChatGPT hosting metadata is required.

Cloudflare documentation:
- https://developers.cloudflare.com/workers/vite-plugin/get-started/
- https://developers.cloudflare.com/d1/get-started/
- https://developers.cloudflare.com/workers/configuration/secrets/

## Payment screenshots (optional)

Players can select a payment screenshot during registration or upload/replace it later with their registration PIN while registration is open. Organizers can view and download proofs from each player card in Registration. For a pair registered together, the proof belongs to the primary registration ID. Proofs do not automatically mark either player as paid.

PNG/JPG/WebP input is limited to 2 MB and converted in the browser to a PNG (maximum 2000 pixels on the longest side). The private storage key is `payments/<registration-ID>.png`. A replacement overwrites that key. PIN authorization is required to read screenshots; no public bucket URL is used. Screenshot storage is separate from tournament JSON saves to avoid sync conflicts.

### Enable storage

1. Enable Cloudflare R2 under Storage & databases → R2. Standard storage includes a free monthly allowance; billing setup is required and excess usage is billable. See https://developers.cloudflare.com/r2/pricing/.
2. Create a **private Standard** bucket named `racketeers-payments`. Leave public access disabled.
3. Add this top-level property to `wrangler.json`, commit, and redeploy:

```json
"r2_buckets": [
  { "binding": "PAYMENT_PROOFS", "bucket_name": "racketeers-payments" }
]
```

Create the bucket before committing the binding. Until it is connected, registration continues to work and upload controls show that storage is unavailable. No API keys are needed in the browser or repository. Do not enable public access on the bucket.

After activation, verify a disposable registration upload, organizer preview, and PIN-based replacement. Automated API tests use isolated mock storage; they do not write to the production database or R2 bucket.

Removing a registration blocks its file from being retrieved through the application. Files remain in the private bucket until the organizer removes them there; tournament JSON export/import does not include screenshots.

### Organizer payment instructions and confirmation

The organizer Registration tab includes Player payment details: bank/provider, account number (stored as text to preserve leading zeroes), account holder, and instructions. These fields are stored in a separate D1 table and can be saved even before R2 is enabled. An optional QR/payment image is uploaded to the same private R2 bucket at `payment-instructions/qr.png` and served publicly through the payment-settings endpoint so registrants can see it. Receipt screenshots remain PIN-protected.

Organizers use View payment screenshot and Confirm payment received on each registration card. Confirmation is reversible and uses the existing protected registration save flow. For a pair, review which players the payment covers and confirm each applicable individual record. Uploading or replacing a screenshot never changes the paid status automatically.

New registration IDs use REG followed by a cryptographically generated UUID with no separators (35 alphanumeric characters). Public registration ignores supplied IDs and generates them on the server, checks current registration collisions, and retains the same ID during PIN-authorized edits. IDs are references, not passwords: matching registration PIN authorization is required for private receipts. Existing IDs are retained so existing pairings and screenshots continue working. Both receipt and QR uploads are capped at 2 MiB on the client and server, including images converted to PNG.

## Registration and page access

- The site opens Registration without a mandatory PIN prompt. Staff access opens the organizer or umpire PIN dialog. Organizer access includes every view. Umpire access includes Umpire and Spectator only.
- Set the shared umpire page PIN in Organizer → Setup → Umpire page access (8–10 digits, different from the organizer PIN). Rotating it immediately rejects the previous PIN on scoring APIs. Individual match PINs are still required.
- Club/group is optional for each player. After saving an entry, or reopening it using its private PIN, choose Add second entry for the appropriate player. Select the same or another division, keep or change the partner, and choose a black or second tournament shirt. Each entry has its own registration ID and edit PIN; the records retain a shared player identity. Linked players can have at most two entries.
- Organizer Add Player opens the same registration form. New or duplicated divisions do not create player records. Legacy placeholder entries without registration IDs are not recovered as registrations.
- Registration, access, and UI tests use isolated in-memory fixtures and never modify the production database.


## Clubhouse Clarity design preview

`npm run dev` opens an isolated frontend preview using the production UI components and demo tournament data. Demo submissions stay in memory; payment storage and staff access are not connected. `npm run dev:worker` starts the actual Cloudflare/Vinext development runtime using local bindings. `npm run build` and `npm run deploy` still build and deploy the production Worker and its real APIs.

Preview-only viewport checks: append `?viewport=390`, `?viewport=834`, or `?viewport=1440` to the preview address. The desktop fixture scales a 1440 × 1024 frame uniformly for visual comparison. These fixtures are not production routes.

### Clubhouse theme and venue

The shared navy/lime theme covers Registration, Organizer, Umpire, Spectator and Projector views. Setup includes an optional Location / venue field (200 characters), which is shown on registration and spectator pages when populated. Venue edits follow the existing setup phase lock. The isolated preview supports `?role=organizer`, `?role=umpire`, and `?role=projector` with demo-only data; these query parameters have no effect on the production Worker.

### Game Day queue recommendations, holds and no-shows

Organizer → Run tournament → Game day desk recommends ready games for each free court. Recommendations follow bracket rotation, player overlap, rest and earlier-result validation; they refresh with shared state and are checked again on assignment. Selecting an assignment reserves the court and advances rotation. Recommendations alone make no changes.

Hold game removes an unstarted game from the ready queue and releases its reservation. An optional organizer-only note explains the delay. Return to queue checks eligibility again and requires a new court assignment. Games already opened for play or scored cannot be held through this queue control.

No-show / forfeit asks which entry is absent and awards the opponent the match. In doubles, this applies to the pair. Existing points remain; no target–0 score is invented. Validate the result before it counts as a win/loss in standings or advances players. An unplayed no-show adds zero points and no rest delay. Clear forfeiture is available before validation; unvalidate first to correct a locked result. These actions use organizer authorization and revision checks. Held and forfeited games reject umpire scoring.

### Projector court overview and slideshow settings

Organizer → Run tournament → Projector settings controls which slides appear, their order, and 5–300 seconds per page. Save explicitly to update the shared display preferences, or preview unsaved settings first. Court details can show player names, live scores, division/game numbers and available courts. Auto-advance can be paused. Timing applies to every page of a slide, including each division/pool standings page.

The court overview uses the configured number of courts; 12 courts fit in two rows of six on a large fullscreen display. Smaller displays paginate whole court rows. In play means physical occupancy, Reserved means a dispatched game awaiting players, and Available means neither; a planned schedule assignment alone does not occupy a court. Completed sets release their court independently of organizer result validation. The slide follows the shared light/dark theme and never displays PINs, contacts, receipts or staff alerts.

Projector-sized displays scale the complete presentation proportionally from a 1920 × 1080 reference using both available dimensions. This supports 720p, HD/1080p, 2K, 3K and 4K without capping text or score size. Other aspect ratios use their available logical space; narrow organizer previews keep their responsive layout and pagination.

Existing v5 tournament data receives default display preferences during hydration without a schema migration. Preference saves require organizer access and the current revision, and update only preferences. A conflict retains the draft for review and retry. The optional `RACKETEERS_PREVIEW_COURTS=1` environment flag selects a fictional 12-court fixture for `npm run dev` only.

Feature branches and pull requests run the Linux verification workflow (tests, lint, build and built-Worker rendering) before release. Production still deploys through the existing main-branch Cloudflare workflow and its existing Worker, D1 and R2 bindings. This display change requires no data migration; recovery is a source revert/redeployment or rollback to the previous Worker version with the same storage bindings.

### Projector sponsors

Organizer → Run tournament → Projector settings includes a Sponsors slide and a Sponsor images library. Select multiple PNG/JPG/WebP files (up to 2 MB each), edit their public names, then upload. Add more at any time or remove an image from the display. Each image gets its own page, using the Sponsors timing (15 seconds by default), visibility and order controls. Empty libraries are skipped. Open projector screens refresh the library every 15 seconds. Images fit without cropping and keep transparency during browser conversion to PNG, up to 2000 pixels on the longest side.

`/api/sponsors` permits public reads of listed sponsor images; upload/removal requires the organizer PIN and the shared same-origin/rate/size protections. The separate D1 `sponsor_images` table is created lazily, with immutable images at `sponsors/<UUID>.png` in the existing private `PAYMENT_PROOFS` bucket. Concurrent additions do not overwrite each other or tournament saves. Removal hides the database listing and public endpoint access but retains the object for recovery. Failed database inserts may leave an unlisted object; the public endpoint cannot read it. Receipts and payment QR keys/access remain separate. Sponsor metadata and objects need separate backup from tournament JSON; source rollback leaves them intact. The isolated design preview also supports in-memory sponsor uploads, which disappear when the preview server restarts.
