# Development workflow

Use an approved Issue or spec to carry the chosen design, scope and acceptance checks from planning to desktop implementation. Keep private tournament exports, contacts, receipt images and credentials out of Issues, pull requests and Git.

## Start from a verified base

1. Run `git status --short --branch`, inspect staged and unstaged changes, and record the current commit and upstream. Preserve existing work and untracked guidance files before switching branches.
2. Agree on the exact base commit. Local `origin/main` is only the last recorded remote reference; do not assume it is fresh or that local `main` matches it.
3. Create a focused `codex/<task>` branch from that base. Avoid inheriting an unrelated upstream; `git switch --no-track -c` supports creating a branch without one.
4. Read `AGENTS.md`, `PROJECT_CONTEXT.md`, README, relevant code and tests. Define the expected behavior and regression checks before editing.

Keep changes limited to the approved task. Preserve scoring and validation rules, player/payment identities, authorization, revision checks, court occupancy and print contracts. Do not regenerate matches or alter storage as incidental cleanup.

## Local runtime and verification

Use the committed npm lockfile with Node 22.16 or newer, including a compatible Node 24 runtime. CI uses Node 22. Run the repository's npm directly; do not switch package managers or rewrite the lockfile incidentally.

For an application change or a fresh development baseline, run from the repository root in PowerShell:

```powershell
$env:TZ = 'Asia/Manila'
npm ci
npm test
npm run lint
npm run build
npm run test:render
git diff --check
```

`test:render` requires the preceding build. It runs the built Worker in local Miniflare/workerd with disposable D1 and local assets. Do not substitute a plain Node import or point tests at remote D1/R2. Report the operating system and actual results; Windows checks do not establish Linux CI results. For documentation-only changes, review the documents, links and whitespace instead of adding tests that repeat their text.

| Command | Purpose |
| --- | --- |
| `npm run dev -- --host 127.0.0.1` | Disposable frontend preview with mocked staff access and in-memory payment storage. |
| `npm run dev:worker` | Actual Worker development runtime with local bindings. Keep synthetic local secrets in ignored `.dev.vars`. |
| `npm run build` | Production build into `dist/client` and `dist/server`; it does not deploy. |

Development/build hooks prepare ignored `public/ocr/` assets from npm dependencies. Preview `?role=` and `?viewport=` fixtures are preview-only and do not verify production authorization.

For affected UI flows, check 360, 390, 834 and 1440 CSS pixels plus short landscape scoring. Include keyboard/touch operation and the relevant registration, organizer, umpire, spectator, projector or print checks from `AGENTS.md`.

## Review and release

Review the complete diff, including intended untracked files, and report exact files changed, checks and limitations. Commit, push or create a draft PR only when requested. PR verification and `codex/**` pushes run Linux tests, lint, build and built-Worker rendering.

Pushing or merging `main` triggers production deployment, including documentation-only changes. The deployment workflow omits lint/render checks and bypasses the package deploy preflight, whose database-placeholder check is not comprehensive release protection.

Before an explicitly authorized release, verify the target account, Worker, D1 database, R2 bucket, checks and rollback approach. Preserve existing bindings and production data. Storage changes, resets or recovery also need the complete verified recovery set and isolated restore checks in [Backup and recovery](backup-recovery.md); tournament JSON alone omits separate tables and uploaded objects.
