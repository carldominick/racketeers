# Two-computer workflow

GitHub is the shared record. The MateBook plans concepts; the desktop implements and verifies application changes. Each computer has its own clone and local Codex project pointing to that clone. Do not sync the working folder, dependencies, secrets or build output through a shared drive. Chat history is supporting context; committed specs and linked Issues carry decisions between computers.

## MateBook: plan and hand off

1. Fetch current `main`, read `AGENTS.md` and `PROJECT_CONTEXT.md`, and find any existing Issue for the idea.
2. Create a Feature concept Issue using the repository template. Record the problem, affected roles, acceptance criteria and explicit exclusions. Use fictional names and sanitized screenshots. Do not upload exports, contacts, PINs or receipts to this public repository.
3. Explore concepts locally. Mark proposals as Draft until the user selects the visual/behavioral direction. A concept is not permission to implement or release it.
4. For a durable spec, copy `docs/specs/FEATURE_TEMPLATE.md` to `docs/specs/<short-name>.md` on `codex/plan-<short-name>` from current main. Link selected mockups, state the selection and user approval, commit/push that branch when authorized, and open a draft PR. Do not merge just to share the plan: main deploys.
5. Hand off the Issue, spec PR/branch and exact commit SHA, approved reference, acceptance criteria, unresolved questions, and next action. Commit/push required assets before handing over; the desktop cannot read MateBook-local files. Use a sanitized public attachment or a separately accessible private reference as appropriate.

Keep planning work focused on docs/assets. Application changes belong to desktop development unless explicitly reassigned. Both computers may work at once on different branches and files; only one computer owns a given implementation branch at a time.

## Desktop: implement

Start with a clean status check. Preserve any local work; commit it on its own branch or use a separate checkout. Never reset/clean to get started.

```sh
git status --short --branch
git fetch origin
git switch -c codex/<issue-number>-<short-name> origin/main
```

Read the linked Issue, exact spec commit and selected reference. If the spec PR is unmerged, inspect its diff and cherry-pick only the agreed planning commit(s) onto the implementation branch, resolving any documentation conflicts deliberately. Do not blindly merge an old planning branch's application changes. Record any deviations and obtain a new decision when acceptance criteria change.

Install with `npm ci` using Node 22.16+ (Node 24 is also supported). `npm run dev` is an in-memory design preview with mocked access. Use `npm run dev:worker` only with local bindings and ignored development variables for runtime checks. Never use remote D1/R2 or production credentials for tests.

For application changes run `npm test`, `npm run lint`, `npm run build`, `npm run test:render`, and `git diff --check`, with `TZ=Asia/Manila` for scheduling tests. In PowerShell set `$env:TZ = 'Asia/Manila'`. Run relevant regression checks for scoring, authorization and concurrent saves. Documentation-only changes need content/link review and diff checks; existing PR CI still runs the application checks. Windows UI/print tests have a known drive-path ESM loader limitation; report it and use Linux CI for confirmation instead of weakening assertions.

Commit only intended files. Push the feature branch and open a draft PR when authorized by the task. Link the Issue and spec, state validation and production impact, and attach sanitized before/after evidence where useful. The existing PR workflow runs Linux verification for any branch name; `codex/**` also verifies on push. No deployment should be invoked for routine development.

Before review, fetch main and deliberately merge `origin/main` into the feature branch if needed; resolve conflicts, rerun affected checks and push. Do not force-push a branch another computer owns. Prefer a new branch when ownership or history is unclear.

## Review and release

- Move to Review only when acceptance criteria and CI pass, with limitations documented. The MateBook can review the desktop PR and compare it with the approved concept.
- Keep the PR unmerged until the user explicitly authorizes release. Approval of a concept, opening a PR and green CI do not authorize a merge. Main pushes and merges automatically deploy, even for docs.
- Before an authorized release verify the intended Cloudflare account/Worker and unchanged D1/R2 bindings, recovery approach and any data impact. Do not change deployment settings, tokens, secrets, storage or production data without explicit approval.
- After release check the deployment result and agreed read-only smoke checks. Record the released commit/version and results. Production test registrations or score writes need explicit authorization.
- Rollback is a separately authorized source revert/redeployment or previous Worker-version recovery with existing storage. A source rollback does not undo data changes. Never reset production state or regenerate draws to undo a UI change.

## Issues and optional Project board

Use one Issue per feature/bug; use checkboxes for small tasks. The Issue is the handoff record and links concept, implementation PR and release evidence. Before creating work, search for duplicates. Template changes become available from the default branch after release; until then copy the template from this PR.

Recommended board: **Racketeers delivery**, linked to this repository, with Status values **Ideas**, **Ready**, **In progress**, **Review**, **Done**. Use a built-in assignee only if another person owns the work; track the device in the Issue handoff field. Ready requires a selected concept (when visual), acceptance criteria and resolved blocking questions. In progress requires a branch and desktop owner. Done requires approved release and verification, not merely a finished local edit. For docs-only planning, record whether Done means delivered planning rather than deployed software.

GitHub Projects setup remains manual when the connected tools cannot access Projects: create/reuse a Project under the repository owner's account, link Racketeers, configure the statuses, add the setup Issue, and add a repository-filtered view. Keep optional auto-add rules limited to this repository. Do not add deployment automations. Check for an existing board before creating one.

Repository admin access does not prove Projects authorization. Project-board tools were unavailable during setup and local authentication did not complete; no board was created. Main protection/rulesets and external Cloudflare build hooks remain unverified. A repository administrator can review requiring PRs and the existing `verify` status check, blocking force pushes/deletion and bypasses as appropriate. Do not require a second person's approval in a solo workflow without deciding how reviews will work. These settings are proposals; this PR does not change them.

## Handoff note

```text
Issue / spec PR:
Branch + exact commit:
Current owner: MateBook planning / desktop development
Selected concept and approval reference:
Completed / checks and results:
Unresolved decisions or blockers:
Next action:
Release authorized: no / explicit approval reference
```

To move implementation between computers, finish or commit work, push the branch when authorized, and provide this note. The receiving computer fetches and checks out that exact branch/commit only after the previous owner stops editing it. Local environment files are configured separately and never included in the handoff.
