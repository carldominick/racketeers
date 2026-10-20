# Feature: <name>

Status: Draft / Ready / In progress / Review / Released
Issue: <link>
Planning owner/device: <name, MateBook>
Implementation owner/device: <name, desktop>
Source baseline: <main commit SHA>
Selected concept: <accessible sanitized reference, or not applicable>
User decision: <approval reference; pending until selected>

## Problem and outcome

Who needs this, what happens today, and what should happen after the change?

## Scope

Included:
- <behavior>

Excluded:
- <explicit boundary>

## Roles and rules

Describe Organizer, Umpire, Registration and Spectator/Projector behavior as relevant. Include server authorization and private-data boundaries, not only hidden UI controls. For scoring, distinguish legal score, set completion, match winner and organizer validation. State any effects on standings, bracket advancement, forfeits, holds, reservations and physical occupancy. Mark unchanged areas explicitly.

## Acceptance criteria

- [ ] Given <role/state>, when <action>, then <observable result>.
- [ ] Unauthorized and locked-state requests fail without changing data.
- [ ] Stale/concurrent saves and failed/offline saves behave as specified.
- [ ] Existing tournament/registration identities and storage remain compatible.
- [ ] Relevant mobile, tablet, desktop, projector or print cases are checked.

## Design and implementation notes

Selected layout/copy, relevant source paths, API/data contracts, dependencies and accessibility needs. Label assumptions. Mockups are references, not production data.

## Verification

List meaningful regression scenarios and checks, expected results and evidence. Include the standard checks from AGENTS.md for application changes. Distinguish mocked preview, local runtime, Linux CI and live read-only checks.

## Release and recovery

Production/data impact: <none expected / details>
Storage/schema impact and recovery: <details; separate backup plan if needed>
Deployment/settings/secrets approval: <not requested / explicit reference>
Release approval: pending
Post-release verification: <read-only checks>

## Handoff

Branch + exact commit:
Completed:
Open questions:
Next owner/device and action:
