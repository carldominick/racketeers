# Racketeers engineering instructions

## Scope and starting point

This repository is the Racketeers Badminton Tournament Tracker, upstream `carldominick/racketeers`. Read `PROJECT_CONTEXT.md`, `README.md`, relevant tests, and the current implementation before changing behavior. The context document describes observed behavior; this file specifies engineering safeguards. When they disagree, investigate the code and tests and explicitly explain the discrepancy.

Start each task with `git status --short --branch` and inspect existing changes. Preserve user edits. Make focused changes; do not reset, clean, replace the checkout, regenerate brackets, change production data, rotate credentials, or delete stored receipts as part of ordinary development. Do not assume ChatGPT history or local Downloads patches represent the current source. Keep these documents current when behavior changes.

## Architecture and code ownership

- React 19 / TypeScript application using Next-style App Router files through Vinext and Vite, deployed to Cloudflare Workers. This is not a conventional Next hosting deployment.
- `app/page.tsx`: role navigation, organizer workflow, registration wizard, client sync, score queue, schedule, draw, standings and print triggers.
- `lib/tournament.ts`: shared data contracts, hydration, roster derivation, scoring, standings, generation and championship reseeding. Use shared helpers instead of duplicating rules in components.
- `lib/game-day.ts`, `lib/staff-events.ts`: eligibility, rest, rotation, dispatch, physical occupancy, near-cap signals and durable staff notifications.
- `app/api/state/route.ts`: D1 state, revision checks, staff/registration authorization and score mutation. `lib/payment-proof-server.ts` and payment API routes manage separate payment settings and R2 files.
- `worker/index.ts` / `lib/request-security.ts`: runtime boundary, security headers, same-origin checks, request sizes and persistent rate limits.
- `app/components/*` / `app/globals.css`: reusable role interfaces, projector and print layout. `preview/*` / `vite.preview.config.ts` are isolated demo tooling.
- `db/` and `drizzle/` describe the state table, but API handlers also create runtime tables directly. Review both before proposing schema changes.

## Development and verification

Use the committed npm lockfile and `npm ci`; do not switch package managers or rewrite the lockfile incidentally. `package.json` declares Node >=22.13; README deployment guidance requests >=22.16, and CI uses Node 22. Prefer a compatible Node 22 or 24 runtime. Check actual scripts before running them.

For application changes run:

```text
npm test
npm run lint
npm run build
npm run test:render
git diff --check
```

`test:render` requires the preceding build and exercises `dist/server/index.js` in Miniflare/workerd, with local asset delivery and disposable D1. Vinext 1.3 imports `cloudflare:workers`; do not replace this runtime check with a plain Node import or a fabricated runtime module. Keep the test runtime new enough for the configured compatibility date, without changing production bindings. The default tests cover tournament logic, mocked D1/R2 APIs, security, access, registration UI/exports, projector, Game Day/printing, court/OCR and sync behavior. Add meaningful regression coverage for changed behavioral contracts. Documentation-only changes need document review and diff checks; do not add tests that merely repeat text.

Use `TZ=Asia/Manila` for scheduling tests (PowerShell: `$env:TZ = 'Asia/Manila'`). An existing next-Saturday fixture is timezone-sensitive; distinguish baseline limitations from regressions. Never point tests at live D1/R2. Use disposable fixtures without real contacts or credentials.

Windows test portability: React external imports in `tests/registration-ui.test.mjs` and `tests/print-match-card.test.mjs` now use `pathToFileURL(require.resolve(...)).href`, avoiding the former `ERR_UNSUPPORTED_ESM_URL_SCHEME` failure. Keep the assertions intact and report the operating systems actually verified; local Windows success does not imply Linux CI ran.

`npm run dev` is an in-memory frontend design preview. It deliberately mocks access and payment capabilities and is not evidence that production authorization works. `npm run dev:worker` starts the real runtime with local bindings; any needed `.dev.vars` must stay ignored. Do not add production PINs to a local preview. Demo `?role=` and `?viewport=` parameters must remain preview-only.

## Role and privacy contracts

- Organizer can manage setup, registrations, pairing, draws, schedules, courts, score correction/validation and PIN controls; server authorization must accompany UI gates.
- Umpire gets Umpire and Spectator views, with a valid shared staff PIN plus the selected match's four-digit PIN for scoring/help. The organizer may use the umpire route but still needs the match PIN.
- Spectator is read-only. Before Live/Completed, ordinary public state omits matchups and roster entries and shows the countdown. Staff can preview earlier.
- Projector is a display mode exposed in organizer navigation, not a separate authenticated server role. It must never render PINs, private contacts, receipt data or staff alerts. Preserve fullscreen and navigation-free fallback behavior.
- Public state must remove organizer/umpire hashes, registrations, recovery PINs, match PINs and staff-only signals. Do not save filtered public state back as organizer state.
- Registration IDs are references, not authorization. Preserve registration/group ownership checks for receipts, including signed export links. Never log PINs, tokens, request bodies containing contacts, or proof images.

## Scoring, brackets and compatibility

- Retain distinct concepts: legal winning score, explicitly completed set, match winner, organizer-validated result, tournament phase, planned court, reserved dispatch and physical occupancy.
- Defaults: regular single set to 31, win by two, cap 35; championships best of three to 21, cap 30. Stage overrides support first-to-target or capped win-by-two. Legacy `win_by_two` normalizes to the capped system. Preserve sliding score bounds and rejection of tied cap scores.
- Stop plus taps after a winning score; allow subtraction before completion. Completed sets require explicit reopening; validated matches remain locked to umpires. Rapid taps must accumulate and queued saves must not overwrite newer local taps.
- Standings use validated regular matches only: wins, point difference, points for, then name. Do not introduce head-to-head or federation rules implicitly.
- Preserve manual championship assignments and never silently reseed a started/scored/validated match. Test all formats, pool qualifiers, byes, semifinals, bronze and ladderized sizes 2–64 when changing generation/reseeding.
- `regenerateMatches` replaces IDs, PINs, scores and schedule. Treat regeneration/import/roster moves as data-affecting actions requiring a reviewed plan and backups when authorized. Do not do them for a cosmetic change.
- Maintain v5 hydration and legacy IDs, reciprocal partners, person identity, payment groups, shirt fields and overrides. Do not reconstruct placeholder entries as real registrations or recreate deleted players.
- Keep compare-and-swap D1 revision writes and 409 handling. Test concurrent organizer/umpire saves, two devices dispatching the same court, stale state, failed saves and PIN rotation. Organizer full-state autosave stops on 409 and retains the complete local draft. Require loading the latest authorized state before reapplying edits; never automatically merge or resubmit a stale snapshot at the returned revision.
- Game Day eligibility includes player overlap across divisions, rest time and earlier validation. Rotation advances on successful dispatch, never on refresh. Court release on set completion does not mean organizer validation; resuming play must recheck occupancy.

## UI, mobile, tablet and print requirements

Preserve Clubhouse Clarity navy/lime styling, light/dark themes, high contrast and plain tournament language. Organizer navigation is Prepare / Run tournament / Results. Registration opens without an obligatory PIN dialog; staff access is explicit.

Check representative widths 390, 834 and 1440 CSS pixels plus a narrow 360px phone and short landscape scoring view. Test registration, organizer desk, umpire, spectator, projector and modals. Avoid page-level horizontal overflow; contain wide brackets/tables or stack rows. Keep full player names readable and controls operable with touch and keyboard. Preserve mobile input text at 16px, visible focus, labels, dialog focus handling, status announcements and reduced-motion support. Primary touch controls should be at least 44px; preserve the deliberately large umpire controls and do not shrink existing compact desk controls further without reviewing usability.

Umpire focus mode shows one court/game heading, active set and large scores; secondary actions stay in More. Keep help, saved/saving/offline indicators, retry, unload warning and disabled exit while unsaved. Offline scores are in memory, not a durable offline store; never claim otherwise.

All scorecard entry points must use the shared `PrintMatchCards` renderer. Each card is 8.5 × 5.5 inches, two per Letter portrait sheet, .23-inch padding, no splitting, page break before every third card, no trailing empty page. Court # and Umpire PIN are ALWAYS blank write-in fields, even for assigned/completed games. Scores and winner checkboxes also remain blank. Print actual match target/cap/set count, final scores only, individual player signatures (four for doubles; two for singles), Umpire and Checked by. Preserve distinct A/B placeholders and long-name adaptive labels. Keep paper white and ink use low. Bulk print includes every match in schedule order while game numbers remain based on state order. Verify odd/even batches, long names, unresolved entrants and browser print geometry. Distinguish browser QA from real printer verification.

## Cloudflare and GitHub safeguards

`wrangler.json` already names real-looking D1 and R2 resources (`DB`, `PAYMENT_PROOFS`); treat them as production until verified. Do not replace IDs or create a new database as part of opening this repository in Codex. A checkout contains source only, not live players, scores, credentials or receipts. New storage creates a separate tournament, not a migration.

Never deploy, push, merge or invoke a deployment workflow without explicit user authorization. **Pushing `main` triggers `.github/workflows/deploy-cloudflare.yml` and deploys automatically.** A merge to main is therefore a deployment action. Prefer local work and reviewable branches; follow user direction for commits/PRs. Before an authorized release verify target account, Worker, database, bucket, backup/recovery approach and checks. Never use remote D1 commands for tests.

The deployment workflow runs npm ci, tests and build, then wrangler-action `deploy`; it currently does not run lint/render checks and bypasses the `npm run deploy` preflight script. `scripts/check-deploy.mjs` only catches the specific placeholder database ID, not missing build output, wrong-account or data migration risks. Do not regard it as comprehensive protection.

`INITIAL_ORGANIZER_PIN` initializes only a missing state row and does not rotate an existing PIN. Keep it and Cloudflare/GitHub secrets outside Git. R2 remains private; payment QR is intentionally served publicly through an API, receipts require authorization or a time-limited bearer link. JSON source/state transfers do not carry R2 images or separately stored payment settings. Plan and verify those independently for any future migration.

Report exact files changed, checks run and failures/limitations. Do not imply live deployment, physical-device testing or migration occurred when it did not.
