# Racketeers Badminton Tournament Tracker

Standalone Cloudflare deployment of the Racketeers application. Includes tournament setup, individual registrations and pairing, pools and knockout draws, umpire scoring, organizer PIN controls, schedules, projector views, and printable scorecards.

## Dedicated court window and receipt review

Organizer → Run tournament → Game day desk → **Open court view** launches `/courts` separately. Keep the main desk open to assign courts while the display shows usage, reservations and available courts. Live Venue supports 12 courts in a four-by-three layout, selectable badminton courts, current players/scores, rotate/zoom/reset, and a 2D list. Player artwork shows illustrative positions, not tracking. Narrow screens start in 2D; unavailable WebGL falls back to it. Enter fullscreen hides its button; Escape exits. Light, Dark and Pure black follow the tournament theme.

Organizer credentials remain in the main window. A temporary random BroadcastChannel carries whitelisted display fields for pre-Live staff preview while that window remains open. Independently opened `/courts` uses public `/api/courts`, withholding courts until Live/Completed even when staff headers are supplied. Failed polling retains the last update with a reconnecting message. Assignments stay in the main desk.

Organizer → Prepare → Registration shows **Amount & reference** beneath an uploaded screenshot. Choose **Read payment screenshot**, review/correct the amount, reference, provider and optional date, then **Save reviewed details**. Missing or ambiguous readings remain empty; manual entry is available. Saved amount/reference appears in the summary. Tesseract.js runs in a browser worker using same-origin WebAssembly and English language data, without sending receipts to an external OCR service. The first reading downloads engine/language files and can take longer on slow connections/devices.

Reviewed fields are organizer-only and shared across linked players/entries. Separate revision checks and screenshot versions reject stale saves; replaced screenshots require renewed review. References reused across unrelated payment groups show a warning. OCR never marks anyone paid: **Confirm payment received** remains separate. The existing registration phase lock still applies to this interface.

### Read all registration screenshots

In **Organizer → Prepare → Registration**, use **Read all payment screenshots** above the division/player list. It checks all divisions, reads each shared payment screenshot once, and skips registrations without an upload. Saved reviews are skipped unless their image changed; select **Also read screenshots with saved details** to reread them explicitly.

A single Tesseract.js worker processes images sequentially on this device, reusing its loaded English engine. Progress and **Stop reading** are shown. Completed readings remain available after stopping; **Read remaining payment screenshots** continues without replacing staged results. Keep the tab open: these readings stay in memory until saved. Clearing local results does not remove saved details or screenshots.

Open **Amount & reference** beneath each result, use **View screenshot for review**, correct any missing/uncertain fields and click **Save reviewed details**. Batch scanning never posts extracted values or changes payment confirmation automatically. Each explicit save retains the existing organizer authorization, screenshot-version and review-revision checks. A screenshot/review changed during scanning is discarded for rereading; a later change is rejected on save. Linked registration cards refresh the shared saved review without replacing unsaved edits. OCR is not a bank/payment verification service, and no external OCR service receives the image.

Private D1 table `payment_receipt_details` is created lazily after authorization, separately from tournament-state saves. Reviews are retained after screenshot removal but cannot be retrieved through this endpoint without a current authorized receipt. These fields are excluded from current tournament JSON and registration spreadsheet exports; back up this table separately for migration. No new Cloudflare resource/binding is needed. Development checks never run remote migrations.

Development/build scripts prepare ignored `public/ocr/` assets from locked npm dependencies. Run `npm ci` first. For the disposable 12-court and synthetic receipt fixture, set PowerShell `$env:RACKETEERS_PREVIEW_COURTS = '1'`, then run `npm run dev -- --host 127.0.0.1`. Open `http://127.0.0.1:5173/?role=organizer`. The fixture starts Live; switch Setup to Registration to exercise receipt review. Data disappears on preview restart. This does not test production authentication. Verification is recorded in `design-qa.md` and `outputs/court-ocr-verification.md`.

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

The locked runtime uses Vinext 1.3.0, React/React DOM/RSC 19.3.1 and `@vitejs/plugin-rsc` 0.5.37. The existing Cloudflare Worker entry and bindings are retained. Client assets now use `/_next/static/`; both `/_next/image` and the legacy `/_vinext/image` are supported. Without an Images binding, image requests return the original file. The interface uses its existing Arial stack; unused Geist downloads and tracked generated font caches have been removed.

Built-Worker checks use pinned Miniflare 4.20260730.0 with real local workerd, synthetic credentials and disposable D1. The test reads built static files locally and does not load production resource identifiers or connect to remote storage. It verifies pages/assets and actual registration requests. Plain Node cannot import this build's `cloudflare:workers` module. The older Miniflare transitively supplied by Wrangler cannot run the configured August compatibility date; this dedicated test dependency preserves that date and the existing deployment configuration.

The header starts **Connecting…**, then shows **Synced** after a valid server response. HTTP errors and a 10-second refresh timeout show **Offline**. An overdue confirmed update shows **Update delayed**, using the current role's polling interval. Successful saves also confirm the timestamp. This indicator does not add durable offline storage or change score retry behavior.

Public registration has separate per-network limits over 15 minutes: 300 successful submission requests and 1,200 attempts. One request may contain multiple linked player records. Failed validation, conflicts and locked-phase responses return their reserved success slot; they still count toward the attempt ceiling. Verified organizer registration bypasses these public quotas, with a fresh authorization check in the registration handler. Invalid organizer headers return 401 rather than falling back to public creation. Existing failed-credential protection remains separate at 15 failures per network/window, including second-entry PIN checks. Its precheck is not a strict ceiling for simultaneous credential attempts; this change is not a replacement for stronger organizer authentication.

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
- Registration has three steps: **Division & players → Entries & shirts → Review & payment**. Choose a division using the selection buttons and enter the participating players on the same first page. The event details, Tournament rules & regulations, and Disclaimer & waiver remain in the left sidebar on desktop and above the form on smaller screens throughout the flow.
- Every participating player needs a full name, club/group, Facebook profile link and phone/mobile number. Changing division preserves entered player details, including Player 2. Singles hides partner fields and excludes them from submission; switching back restores the partner draft. Shirt sizes are selected on the second step.
- **Add a second entry (optional)** on Entries & shirts keeps the first entry unchanged. First choose **Who is entering again?** using either original player's name, then select the division and **Same partner** or **Different partner** for doubles/team entries. Same partner means the other player from the first entry, including when Player 2 is entering again. Both choices start unselected; the selected player and valid required details are needed to continue. Switching between players preserves their separate second-entry drafts and shirt choices. Singles offers only the participating player and does not submit hidden partner fields. Second-entry shirts can be black or a second tournament shirt.
- Each player can have at most two linked entries. Entries submitted together share one private edit PIN and payment proof. After saving, or reopening a registration with its PIN, Add second entry can create a later entry for either eligible player; that new entry receives its own PIN while retaining the shared player identity and payment group.
- Organizer Add Player opens the same registration form. New or duplicated divisions do not create player records. Legacy placeholder entries without registration IDs are not recovered as registrations.
- Registration, access, and UI tests use isolated in-memory fixtures and never modify the production database.


## Clubhouse Clarity design preview

`npm run dev` opens an isolated frontend preview using the production UI components and demo tournament data. Demo submissions and payment storage stay in memory; production storage and staff access are not connected. `npm run dev:worker` starts the actual Cloudflare/Vinext development runtime using local bindings. `npm run build` and `npm run deploy` still build and deploy the production Worker and its real APIs.

Preview-only viewport checks: append `?viewport=390`, `?viewport=834`, or `?viewport=1440` to the preview address. The desktop fixture scales a 1440 × 1024 frame uniformly for visual comparison. These fixtures are not production routes.

### Clubhouse theme and venue

The color-mode control cycles Light, Dark and Pure black (OLED/AMOLED). Pure black uses #000 for the page, panels, navigation and projector surfaces while retaining high-contrast text and lime accents. The shared navy/lime theme covers Registration, Organizer, Umpire, Spectator and Projector views. Setup includes an optional Location / venue field (200 characters), which is shown on registration and spectator pages when populated. Venue edits follow the existing setup phase lock. The isolated preview supports `?role=organizer`, `?role=umpire`, and `?role=projector` with demo-only data; these query parameters have no effect on the production Worker.

### Game Day queue recommendations, holds and no-shows

Organizer → Run tournament → Game day desk recommends ready games for each free court. Recommendations follow bracket rotation, player overlap, rest and earlier-result validation; they refresh with shared state and are checked again on assignment. Selecting an assignment reserves the court and advances rotation. Recommendations alone make no changes.

Hold game removes an unstarted game from the ready queue and releases its reservation. An optional organizer-only note explains the delay. Return to queue checks eligibility again and requires a new court assignment. Games already opened for play or scored cannot be held through this queue control.

No-show / forfeit asks which entry is absent and awards the opponent the match. In doubles, this applies to the pair. The absent entry receives 0 and the opponent receives the configured winning score (31–0 by default, or the stage override). Best-of-three awards two winning sets, such as 21–0 and 21–0. The winning points are captured when the forfeiture is recorded. Played scores remain separately available for correction; clearing the forfeiture restores them. Older forfeitures without a captured award derive it from their match rule. Validate the result before its win/loss and awarded points count in standings or advance players. An unplayed no-show adds no rest delay. Clear forfeiture is available before validation; unvalidate first to correct a locked result. These actions use organizer authorization and revision checks. Held and forfeited games reject umpire scoring.

### Projector court overview and slideshow settings

Organizer → Run tournament → Projector settings controls which slides appear, their order, and 5–300 seconds per page. Save explicitly to update the shared display preferences, or preview unsaved settings first. Court details can show player names, live scores, division/game numbers and available courts. Auto-advance can be paused. Timing applies to every page of a slide, including each division/pool standings page.

The court overview uses the configured number of courts; 12 courts fit in two rows of six on a large fullscreen display. Smaller displays paginate whole court rows. Fullscreen hides projector controls and site navigation; press Escape to exit. The same clean projection layout is retained when native fullscreen is unavailable. In play means physical occupancy, Reserved means a dispatched game awaiting players, and Available means neither; a planned schedule assignment alone does not occupy a court. Completed sets release their court independently of organizer result validation. The slide follows the shared Light, Dark or Pure black mode and never displays PINs, contacts, receipts or staff alerts.

Projector-sized displays scale the complete presentation proportionally from a 1920 × 1080 reference using both available dimensions. This supports 720p, HD/1080p, 2K, 3K and 4K without capping text or score size. Other aspect ratios use their available logical space; narrow organizer previews keep their responsive layout and pagination.

Existing v5 tournament data receives default display preferences during hydration without a schema migration. Preference saves require organizer access and the current revision, and update only preferences. A conflict retains the draft for review and retry. The optional `RACKETEERS_PREVIEW_COURTS=1` environment flag selects a fictional 12-court fixture for `npm run dev` only.

Feature branches and pull requests run the Linux verification workflow (tests, lint, build and built-Worker rendering) before release. Production still deploys through the existing main-branch Cloudflare workflow and its existing Worker, D1 and R2 bindings. This display change requires no data migration; recovery is a source revert/redeployment or rollback to the previous Worker version with the same storage bindings.

### Projector sponsors

Organizer → Run tournament → Projector settings includes a Sponsors slide and a Sponsor images library. Select multiple PNG/JPG/WebP files (up to 2 MB each), edit their public names, then upload. Add more at any time or remove an image from the display. Each image gets its own page, using the Sponsors timing (15 seconds by default), visibility and order controls. Empty libraries are skipped. Open projector screens refresh the library every 15 seconds. Images fit without cropping and keep transparency during browser conversion to PNG, up to 2000 pixels on the longest side.

`/api/sponsors` permits public reads of listed sponsor images; upload/removal requires the organizer PIN and the shared same-origin/rate/size protections. The separate D1 `sponsor_images` table is created lazily, with immutable images at `sponsors/<UUID>.png` in the existing private `PAYMENT_PROOFS` bucket. Concurrent additions do not overwrite each other or tournament saves. Removal hides the database listing and public endpoint access but retains the object for recovery. Failed database inserts may leave an unlisted object; the public endpoint cannot read it. Receipts and payment QR keys/access remain separate. Sponsor metadata and objects need separate backup from tournament JSON; source rollback leaves them intact. The isolated design preview also supports in-memory sponsor uploads, which disappear when the preview server restarts.
