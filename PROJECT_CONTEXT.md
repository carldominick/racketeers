# Racketeers repository map

Shared starting point for both computers. Reviewed against `main` at `6bb4b7c` on 2026-10-20. This describes source, not live tournament data or a fresh security audit.

- Product: badminton registration, pairing/draws, schedules, court dispatch, umpire scoring, organizer validation, standings, projector and printed cards. One tournament state per deployment.
- Stack: React/TypeScript, Next-style App Router through Vinext/Vite, Cloudflare Worker, D1 and private R2. Use the existing npm lockfile.
- `app/page.tsx` coordinates roles and workflows; `app/components/` contains role interfaces and print/projector components.
- `lib/tournament.ts` owns hydration, scoring, standings and bracket rules. `lib/game-day.ts` owns eligibility, holds, forfeits, dispatch and occupancy. `lib/registration-draft.ts` owns registration drafts and second-entry ownership.
- `app/api/state/route.ts` enforces staff access, score mutations and revision writes. Payment and sponsor APIs have separate storage. `worker/index.ts` and `lib/request-security.ts` provide runtime protections.
- `tests/` covers domain rules, API boundaries, registration UI, projection and printing; `preview/` is isolated in-memory demo tooling.
- `wrangler.json` already binds `DB` and `PAYMENT_PROOFS`. Do not replace these resources to set up another computer. A source checkout does not copy D1 data, R2 objects, secrets or payment settings.

`AGENTS.md` defines safeguards. [The workflow guide](docs/development-workflow.md) explains planning, implementation and release. Specifications start from [the feature template](docs/specs/FEATURE_TEMPLATE.md).

## Current release path

`.github/workflows/verify.yml` runs on every PR and pushes to `codex/**`: Node 22 on Linux, Asia/Manila timezone, npm install, tests, lint, build, built rendering and diff checks. `.github/workflows/deploy-cloudflare.yml` runs on pushes to `main` and manual dispatch; it installs, tests, builds and deploys. It does not run lint/render checks. Merging a PR to main therefore releases production, including a documentation PR. Neither workflow is changed by this setup.

## Product contracts to preserve

Organizer controls setup, registrations, draws and result validation. Umpire scoring requires shared staff access plus the selected match PIN, and rejects validated, held or forfeited games. Public/projector output excludes private contacts, credentials and receipts. Registration IDs are references, never credentials.

Default regular games are one set to 31, win by two with cap 35; championships are best of three to 21 with cap 30. Per-stage rules override defaults. Legal winning scores, completed sets and organizer validation are distinct. Validated regular results count toward standings; review existing progression code/tests before changing bracket advancement. Court schedule, reservation and physical occupancy are separate concepts.

Second entries explicitly select either original player, then same/different partner as applicable; preserve each player's draft. Avoid inferring the owner from Player 1.

## Inspection limits

Local source was on `codex/second-entry-player-choice` with untracked `AGENTS.md` and `PROJECT_CONTEXT.md`; those originals were preserved. Remote main contains PR #5. Remote feature branches include prior forfeit, Game Day, projector, registration and second-entry work; branch existence alone does not indicate active work. No open PRs or Issues were returned during inspection. No live website, production data, external Cloudflare build triggers or repository protection settings were verified. Historical local documents are not fresh test evidence.
