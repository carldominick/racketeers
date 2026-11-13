# Personal umpire access and match workflow

The organizer opens **Run tournament → Umpire roster** and enables personal umpire access for the active tournament. If setup is pending, the roster explains the missing prerequisite and keeps the button disabled. Existing tournaments can finish their shared-PIN assignments before enabling it. Activation retires the shared umpire credential, clears stored game PINs, removes their controls from Game Day Desk and their write-in field from printouts, and disables the old scoring endpoints for the managed tournament.

For production, a Cloudflare administrator must add the Worker secret `UMPIRE_CREDENTIAL_SECRET` to `racketeers` under **Settings → Variables and Secrets** and deploy the settings. Generate a unique random value (32 random bytes encoded as text). Do not reuse an umpire PIN or the organizer password. Adding the secret prepares the Worker; it does not switch the tournament. With no current shared-PIN game in progress or assigned, refresh the roster and select **Enable personal umpire access**. See [Cloudflare Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

Add an umpire to issue a six-digit PIN, give it to the umpire privately, then assign a court. The umpire signs in through **Staff access → Umpire**, starts duty and keeps the dashboard open. Game Day Desk explains why a court is unavailable. Assign an eligible game, acknowledge it on the umpire dashboard, confirm the players and start scoring. At a legal winning score, complete the deciding set. Check both teams’ verbal confirmation and confirm that the court is clear, then submit. The game updates standings and brackets and the umpire returns to waiting.

Use **Report incorrect players** to block the start. The organizer can resolve the report or record why the match is returning to the queue. Use **Report score dispute** to record the disputing side and reason. Corrected scores require a new confirmation from both teams. An escalation holds the court until the organizer confirms it is clear. The dispute stays open after release and appears in Game Day Desk, even if the court receives another game. A ruling can confirm a legal result, void it or queue a replay. A void in a knockout round has no winner, so dependent matches still require a result or an explicit organizer matchup decision. Replays keep the original game number and archive the dispute.

To replace the umpire on an active court, choose a connected, on-duty replacement in the roster, enter a reason and select **Hand off current game**. The game stays on that court with its scores and history. The previous session loses scoring rights to it.

## Local review on Windows

From the `codex/umpire-workflow` worktree, using Node 22 or newer:

```powershell
npm ci
$practiceSecret = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
@("INITIAL_ORGANIZER_PIN=45678901", "UMPIRE_CREDENTIAL_SECRET=$practiceSecret") | Set-Content .dev.vars -Encoding ascii
$env:MINIFLARE_WORKERD_PATH = (Resolve-Path node_modules/miniflare/node_modules/@cloudflare/workerd-windows-64/bin/workerd.exe).Path
npm run dev:worker -- --host 127.0.0.1 --port 5189 --strictPort
```

The workerd override selects the newer runtime from the lockfile. The Vite plugin’s nested runtime cannot run the configured compatibility date. Use the sample PIN only on a fresh disposable local database. The state and presence tables initialize on demand, so there is no manual local migration command. The worker persists local data under its ignored Wrangler directory.

- Open [local Racketeers](http://localhost:5189/) and use **Staff access → Organizer → Use existing organizer PIN** with the local sample PIN. Set up a draw, enable personal access in **Umpire roster**, and switch the tournament to **Live**.
- Open the same local origin on the umpire browser, choose **Staff access → Umpire**, and enter the generated personal PIN. The Umpire navigation item also opens the dashboard after a refresh.
- Open [local Demo Mode](http://localhost:5189/demo) and start it with the local organizer PIN. The practice tournament already has matches. Enable personal access, create two fictional umpires, and sign in to the two practice consoles below the organizer interface. Both consoles see the same in-memory tournament. Use **Reset demo** to start fresh.

## Storage and security

Roster names, tournament credential scope, assignments, session hashes, and match history use the existing revision-checked tournament row. The only new D1 table, `umpire_presence`, holds hashed session IDs and last-seen timestamps. Presence updates run separately from score revisions. A session is treated as disconnected after 45 seconds, and sessions expire after 12 hours. There is one active session per umpire. Reissuing or revoking a PIN invalidates the session. The PIN lookup uses a tournament-scoped HMAC with a Worker secret and a salted PBKDF2 verifier. The Worker limits guesses by source and across the tournament. Demo sessions use separate in-memory tokens and a random demo secret.

Racketeers still hosts one active tournament per deployment. The roster can be reused by rotating the credential scope once active assignments and disputes are resolved. This preserves names and historical match records while clearing tournament assignments and credentials. It does not add a multi-event manager or automate creating a fresh draw.

The organizer’s private state backup contains the umpire directory and dispute history. Store it as sensitive data. Backup exports clear duty flags and session hashes so a restore requires umpire sign-in. Presence timestamps can expire or be recreated and are not needed to restore results. Keep `UMPIRE_CREDENTIAL_SECRET` stable across deployments: changing it invalidates existing personal PINs.

## Implementation map

- `app/api/umpires/route.ts` and `lib/state-handlers.ts` connect the umpire API, shared tournament writes, and the existing Worker authorization boundary.
- `lib/umpire-auth.ts`, `lib/umpire-service.ts`, `lib/umpire-types.ts`, and `lib/umpire-workflow.ts` hold credential handling, presence, the directory, and the match transitions. `db/schema.ts` describes the presence table.
- `app/components/umpire-roster.tsx`, `umpire-dashboard.tsx`, `umpire-workflow.css`, `game-day-desk.tsx`, `staff-access-dialog.tsx`, `umpire-scorecard.tsx`, `print-match-card.tsx`, `projector.tsx`, and `app/page.tsx` connect the roster, match controls, and existing views.
- `lib/game-day.ts`, `lib/tournament.ts`, `lib/staff-events.ts`, `lib/organizer-safety.ts`, `lib/organizer-accounts.ts`, `lib/organizer-audit-description.ts`, and `lib/request-security.ts` integrate dispatch, scoring, public display, result processing, audit and rate limits.
- `lib/demo-runtime.ts` and `app/demo/page.tsx` run the same API in isolated browser memory. `tests/demo.test.mjs` and `tests/rendered-html.test.mjs` exercise the workflow with disposable data.

Live updates use polling. On the personal umpire dashboard, select **Enable match alerts** for the Soft Chimes assignment sound. On **Game Day Desk**, select **Enable court chimes** for separate help-request and game-finished sounds. The control enables audio for the open page; the browser requires another click after reloading. Old alerts remain quiet on the initial poll. A set ending or a disputed game's court being released does not play the game-finished sound; a later ruling that finalizes the result does. If several events of one kind arrive together, the desk plays one chime for that group. The app retries transient score conflicts against the same match version. Pending taps live in browser memory and the scorecard warns before leaving while they are unsaved.
