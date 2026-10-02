# Game Day Desk — design QA

final result: passed

Source: selected single concept, `exec-17ff8fa1-e132-4000-87f0-342c3dbd0f03.png`, 1024 × 1536. Desktop preview: 1440 CSS px, displayed at 0.85 scale. Both artifacts were opened in `game-day-comparison-before.jpg`, normalized to the same content width.

The implementation retains a secondary Game day desk / Schedule navigation row to preserve access to scheduling. Fixture queue order reflects the saved rotation cursor and actual eligible games. These are intentional differences from the illustrative mockup.

## First comparison findings

- P2: Queue controls wrapped into three rows, stretching the queue and pushing waiting games farther down than the selected concept. Select and Print now share one controls group, with Reset PIN and Reset game below.
- P2: Court and queue control text was too small at the normalized reference scale. Queue controls now use 13px; compact court controls use 12px at desktop and 13px on phone. Matchup text uses 15px and court player names 16px.
- P2: The court help button added an extra row and inflated all four court cards. It now sits beside the help request label; empty-court spacing is compact.
- P2: The simplified assignment card used a separate full-width Reset PIN row. PIN and reset now share one row, following the selected concept.

## Revised comparison and repairs

The source and revised desktop page were compared together in `game-day-comparison-final.jpg`. The 1440 × 2300 CSS preview is displayed at 0.85 scale, captured at 1348 × 1955 pixels, and its 1224px-wide app region is normalized to 1024px for comparison. Court cards, even rotation, ready/waiting rows, visible PINs, the simplified assignment card, and result review follow the selected composition. Bulk printing remains the global action. Existing brand colors, Manrope typography and Phosphor icons are retained.

The second comparison confirmed that queue controls now occupy two rows, court controls fit their cards, and the PIN reset sits beside the assignment PIN. The extra Schedule navigation, actual bracket ordering, automatically chosen first available court, and validated-history disclosure are intentional operational differences. The page has additional height for these controls and readable real player names.

- P2 found during phone QA: the desktop first-column width overrode the ready/waiting section label width, breaking its text into short fragments. An explicit phone section-label width fixes it. The repaired label and row both measure 313px; `game-day-phone-queue-fixed.jpg` confirms readable labels and stacked game fields.
- Score dialog QA identified that a manually started reserved game must set physical occupancy, and that a reserved court must be disabled in the correction selector. Score edits now calculate occupancy from the scoring helper. The server also checks conflicting manual changes, returns the current revision, and lets the client restore the conflicting game without retrying an invalid assignment indefinitely.
- Score dialogs support Escape, trap keyboard focus, and restore the originating control.

No unresolved P0, P1, or P2 findings remain in the inspected surfaces.

## Browser verification

All interactive checks use disposable, isolated in-memory preview data. Production registration records, credentials, scores, and phases were not changed.

| Surface | Verified behavior |
| --- | --- |
| Desktop 1440 × 2300 CSS | Four court cards, complete ready/waiting queue, simplified assignment, visible PIN controls, result review; page client and scroll width both 1440px. |
| Tablet 834 × 900 CSS | Two court columns, paired assignment/review panels, readable queue; inner viewport client and scroll width both 819px (15px scrollbar). |
| Phone 390 × 844 CSS | One court column, stacked panels and labeled game rows; client and scroll width both 375px. Queue and assignment panels measure 343px; no horizontal overflow. |
| Queue and court assignment | Search filters player names; Court 3 reserves Game 5, removes it from the unassigned queue and advances the saved rotation. PIN copy returns the displayed demo PIN. Starting manual scoring changes Reserved to In use. |
| Score review | Existing score editor opens; changing the score updates the court; Escape closes it and restores focus. Validating the completed result moves it into validated history. |
| Setup during Live | Warning threshold, on/off switch and rest/rotation settings remain enabled while structural setup fields remain locked. At five points remaining, threshold 3 suppresses the public callout; threshold 5 displays it; Off suppresses it. |
| Notifications | The board names the next eligible matchup. The saved staff event is emitted once. Projector shows the same player-preparation callout, without PINs. |
| Projector fullscreen | Enter fullscreen removes the topbar and organizer alert panel (both DOM counts zero). The slideshow, next-player callout and Exit control remain visible. Escape restores the navigation and normal view. The slideshow advances and paginates while fullscreen. |
| Bulk printing | All 12 demo games generate one scorecard each. Standard scorecards have zero PIN labels; the separate handoff option has 12 PIN labels. |

Evidence: `Racketeers-Game-Day-Desk.jpg`, `game-day-comparison-final.jpg`, `game-day-phone-queue-fixed.jpg`, `game-day-tablet.jpg`, and `projector-fullscreen.jpg`. The final screenshot uses sample data for review; those records are excluded from the production bundle.

## Automated verification and limits

All 102 automated tests and both built-Worker rendering checks pass (104 total). ESLint, the production build, and Git whitespace checks pass. The production bundle contains no preview fixture, demo staff credential, or sample player marker. New API checks cover organizer-only dispatch, stale revisions, simultaneous assignment, reserved-court conflicts in match access and scoring, editable operational settings during Live, durable warnings, and public PIN privacy. Queue tests cover even rotation, independent pools, busy players across divisions, rest expiry, qualification dependencies, multi-set warnings, disabled warnings, and notification deduplication.

The standalone TypeScript command still encounters existing repository errors in Cloudflare ambient types, export-link unions and the Blob typing used for workbook downloads; it is not claimed as passing. Native/fullscreen behavior was verified in Chrome; unsupported native fullscreen uses a navigation-free viewport fallback. Physical printing, real devices, SMS/email delivery and a formal accessibility certification were not tested. Notifications are in-app callouts and organizer alerts. Historical games without completion timestamps do not acquire an invented rest start time.

