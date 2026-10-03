# Projector court overview and settings QA — 2026-10-03

final result: passed (local browser and available Windows checks; Linux release verification runs separately)

## Source and evidence

Selected reference: Venue Overview, revised to match the shared light theme, `exec-21c2f924-ee2a-4d68-a1e8-96e28376017c.png` (1254 × 1254). Both projector and organizer settings regions were used. The fixture uses the same fictional people and scores: 12 courts, seven in play, two reserved and three available. Game numbers follow actual fixture state order (1–9) instead of the illustrative 17–25.

The full projector comparison `outputs/projector-comparison-full.png`, first-court comparison `outputs/projector-comparison-detail.png`, and organizer comparison `outputs/projector-settings-comparison.png` were opened together and inspected. Reference and implementation were proportionally normalized to the same content width. The in-app browser's fullscreen screenshots include unused black canvas; the complete 1440 CSS pixel app region was cropped to 1209 × 860 screenshot pixels for comparison. CSS viewport and screenshot pixels differ, so these are visual comparisons rather than pixel-exact overlays. `outputs/projector-courts-reviewed.png` preserves the complete light display; dark evidence is `outputs/projector-courts-dark-1440.png`.

## Fidelity and comparison findings

- Typography: shared screen font and tokens retained. Large navy court headers, individual full player names and aligned bold scores preserve the hierarchy. Long names wrap on narrower cards without truncation; a modest long-name font adjustment prevents unnecessary wrapping on large displays.
- Layout: two rows of six courts fit at 1440 × 1024 and 1920 × 1080 CSS pixels in fullscreen, at scale 1. The title and state counts share the header. Existing fullscreen controls, tournament title and page/timing footer remain. Smaller screens use whole-row pagination (three columns on tablet, one on narrow phones).
- Color: shared paper/card/ink tokens support light and dark slides. Lime marks in-play/available courts and amber marks reservations. Available cards have a pale lime surface in light mode. The organizer retains the existing navy navigation instead of replacing it with the illustration's white navigation.
- Artwork: generated transparent court-line raster, `public/projector-court-lines.png`, inspected before use. Low-opacity lines sit behind the readable content; no screenshot is used as the UI.
- Controls: accessible Move up/down buttons replace illustrative drag handles so keyboard and touch users can reorder. Native labeled checkboxes replace illustrated switches. Save and Preview remain beside the settings content and stack on phones; controls are at least 44px high and duration inputs use 16px text.
- Content: the court card shows real physical occupancy/reservation, current set scores, division/game number and awaiting-player status. Planned-only assignments and released/completed sets are available. PINs, private contacts, receipts and staff notifications do not render in projector or preview.

P2 found during phone QA: the shared backdrop padding pushed the 100dvh dialog/footer below the screen. Removed mobile backdrop padding and locked background scrolling while preview is open. Rechecked at 360 × 800: dialog top 0/bottom 800, footer bottom 788, zero horizontal overflow. Revised evidence: `outputs/projector-courts-phone-fixed.png`. No unresolved actionable P0/P1/P2 findings remain in inspected surfaces.

## Interactions and responsive verification

All mutations used disposable in-memory preview data. Slide order moved up/down correctly. Saved preferences survived reload. A five-second court duration advanced into live matchups while the parent continued polling. All four court detail toggles changed an unsaved preview; hiding available courts showed the nine occupied/reserved courts. Preview focused Close, trapped the dialog and made background navigation inert; Escape restored the Preview trigger. Staff alerts were hidden. Light and dark fullscreen showed all 12 courts.

Settings and projector checked at 1440, 834, 390 and 360 CSS pixel widths with no page-level horizontal overflow. Tablet preview displayed six courts per page; phones preserved a whole court card per page. Existing umpire at 360 and short 844 × 390 landscape, registration and spectator at 390 retained zero page overflow; registration correctly showed its Live-phase lock. No browser application errors/warnings were observed. These are emulated browser widths, not physical-device tests; native fullscreen fallback remains supported but requestFullscreen rejection was not forced.

Automated regression coverage verifies grid row pagination, canonical preferences, physical court occupancy/current sets, public-safe rendering, organizer-only saves, stale revision rejection and preservation of matches/entries/registrations/hashes. Windows `npm test` reports 98 passed and two known pre-assertion React ESM loader failures (`registration-ui` and `print-match-card` importing C: paths); these unrelated tests were not weakened. Lint, production build, two built-Worker render tests and whitespace checks pass. Linux CI is required before release.

README's existing mandatory opening PIN and local-preview D1 statements disagreed with code/context. Corrected those descriptions; this update does not change either existing access behavior or development runtime.

## Release and recovery

Release uses upstream `carldominick/racketeers`, the existing `racketeers` Worker, D1 `racketeers-db` and private R2 `racketeers-payments` bindings, confirmed against the last successful deployment. No binding, schema or initialization credential changes are included. No tournament data or preferences are written during release; old v5 states hydrate defaults, and an organizer saves preferences explicitly. The last production source is `c8b9267857b981b72bbfbca682b5b2474f58204f`; recover by reverting this feature and redeploying through the same workflow or rolling back the previous Worker version with unchanged storage. No live D1/R2 commands are used for tests or migration.

## Implementation checklist

- [x] Approved court composition and shared light/dark palette.
- [x] Accurate in-play/reserved/available state and public-safe content.
- [x] Organizer slide selection, ordering, per-page timing and detail controls.
- [x] Explicit revision-checked save and unsaved preview with keyboard focus handling.
- [x] Full and focused source comparisons, responsive checks and phone repair recapture.
- [x] Local automated checks completed with documented Windows baseline limitation.
- [ ] Linux CI and authorized production release verification (recorded in the pull request).

---

# Half-letter print-card implementation QA — 2026-10-03

**Findings**
No actionable P0/P1/P2 findings remain after two visual fixes. The second displayed design is the implementation target.

## Evidence and comparison state
- Source: `/workspace/scratch/302884b9ef26/generated_images/exec-122897a9-2ab1-4283-8a2d-7ac09de5b415.png`.
- Final browser implementation: `/workspace/scratch/302884b9ef26/Racketeers-Updated-Match-Card.jpg`.
- Full-view source/implementation comparison: `/workspace/scratch/302884b9ef26/print-card-comparison-final.jpg`.
- Focused metadata, winner and validation comparison: `/workspace/scratch/302884b9ef26/print-card-comparison-detail.jpg`.
- Letter-sheet view with two cards: `/workspace/scratch/302884b9ef26/print-card-letter-preview.jpg`.
- Long-name stress case, revised: `/workspace/scratch/302884b9ef26/print-card-long-names-final.jpg`.
- State: Game 17, Level D/E, Championship final, Alex/Sam versus Chris/Pat, best of three to 21, win by two, cap 30. Court, PIN, scores and signatures are blank.
- Viewport: card content 816 × 528 CSS pixels at density 1. Source 1559 × 1009 pixels normalized proportionally to 816 × 528. Final browser capture is 816 × 528 pixels. Two cards are 816 × 1056 CSS pixels, exactly letter portrait at 96 CSS pixels per inch.
- Browser: cloud Chrome. Local-only QA uses the production print component and exact print CSS declarations as screen media so the printed content can be captured. The temporary QA files are excluded from publication. Production print behavior still invokes the native browser print function.

## Required fidelity surfaces
- Fonts/typography: existing Arial/Helvetica sans-serif print stack; bold tournament/game identifiers, matchup, section headings, set numbers and winner controls preserve the source hierarchy. Body fields are 10.5–11 pt, instructions 9 pt. Long names remain complete and use Pair A/B in the smaller score/winner fields when needed; this prevents wrapping collisions while retaining all individual names and signatures.
- Spacing/layout: two columns for scores and signatures, thin metadata separators, centered matchup, simple officials footer. All cards are 8.5 × 5.5 inches with 0.23-inch padding. Cards cannot split, and a new page starts before each third card. No forced break follows the last card. Nonprint organizer content is removed from print flow to prevent empty pages.
- Colors/tokens: white paper, #111 text, #777 thin rules, restrained #f7f7f7 table header. No ink-heavy panels or color dependency.
- Image/asset fidelity: the target is entirely editable form text, native checkboxes, tables and rules; no raster artwork is required or substituted. Existing Phosphor Printer icons are retained only in the screen controls.
- Copy/content: the selected fields, final scores only, winner, four player signatures for doubles, Umpire and Checked by lines are present. Rules and set count follow the actual match. Court and Umpire PIN always print as empty write-in lines even for assigned, completed or validated matches. Singles provide one signature per player. Unresolved entrants have distinct A/B labels and blank player lines.

## Comparison history
1. Initial comparison `/workspace/scratch/302884b9ef26/print-card-comparison-initial.jpg`: P2 metadata grouping drift and weak winner/set-number emphasis. Fixed grid proportions, vertical separators, type weight/size and final-score spacing. The final full-view and focused comparison show those fixes.
2. Long-name capture `/workspace/scratch/302884b9ef26/print-card-long-names.jpg`: P2 full names in table/winner controls collided with neighboring content. Fixed adaptive Pair A/B labels, tighter long-name table padding and signature label allocation. Revised capture shows all six blank score cells at approximately 37 CSS pixels tall, all four signatures, no overlaps and no card overflow.

## Primary interactions and checks
- Game Day Desk Print all games: one click generates all 12 fixture games, 24 blank Court/PIN fields, blank score cells and matching signature sections. Card sizes are exactly 816 × 528; positions increase by 528. All 12 cards have zero measured overflow. Named letter page and odd-card break rules are parsed by Chrome.
- Print game card on an assigned/live court: one click generates only that game's card with empty Court/PIN fields, correct single-set row and four signatures. Print request fires; afterprint restores the desk.
- Existing match-editor, umpire and Tournament Progress print entry points share the same PrintSheet/PrintMatchCards renderer.
- Phone view at 390 CSS pixels: screen content width and scroll width both 375, without page overflow. Bulk print control is 46 pixels high; court print controls retain the existing 40-pixel control sizing and remain inside the card.
- Browser console checked: no application errors or warnings. Browser-extension metadata errors are unrelated to the app.
- 108 automated tests pass with TZ=Asia/Manila, plus two built-Worker rendering tests (110 total). Production build, targeted ESLint and git diff --check pass. An existing next-Saturday scheduling test depends on the timezone and fails under this container's UTC default; no scheduling behavior was changed.
- Native print dialog pagination, physical paper output and real devices were not exercised. Browser geometry and production page/break declarations were verified; printer settings should use Letter portrait at 100% scale.

**Open Questions**
None blocking this update.

**Implementation Checklist**
- [x] Selected side-by-side layout implemented.
- [x] Blank Court/PIN fields and blank final-score cells across print actions.
- [x] Individual signature lines and match-specific scoring formats.
- [x] One-click single and bulk printing.
- [x] Half-letter dimensions and two-card letter-page layout.
- [x] Visual fixes recaptured and compared with the source.
- [x] Automated checks and build complete.

**Follow-up Polish**
P3: the generated source uses slightly narrower lettering and larger checkbox outlines; the existing print font and native browser checkboxes are accepted for consistent real printing.

final result: passed

---

# Compact court layout — design QA (2026-10-03)

final result: passed

## Scope and visual evidence

Implement the user's approved latest court layout only. The print sheet remains a separate mockup awaiting review. Source visual: `/workspace/scratch/302884b9ef26/generated_images/exec-3541001c-3103-4006-ae12-f348745c6064.png` (1065 × 1476). Browser implementation: `/workspace/scratch/302884b9ef26/Racketeers-Compact-Court-Preview.jpg` (1348 × 1955), with a 1440 × 2300 CSS iframe at 0.85 scale. The longer frame exposes the unchanged queue and all footer content without an inner scrollbar.

State: light theme, organizer Game day desk, isolated sample tournament. Court 1 is live at 18–16; Court 2 is available with a 31–28 result awaiting validation; Court 3 is empty; Court 4 is live at 14–16 with help requested. No production records were used or modified.

Full-view comparison: `/workspace/scratch/302884b9ef26/compact-courts-comparison.jpg`. The mock's app region (958px wide) is normalized to the implementation's 1224px-wide app region. Focused comparison: `/workspace/scratch/302884b9ef26/compact-courts-detail.jpg`, with both court rows normalized to 1170px wide. Both combined inputs were opened and inspected.

## Findings and comparison history

- Initial spacing inspection: the existing cards were 415.625 CSS px tall. Reduce card padding, gaps, score-row padding, PIN padding and the help badge height. Preserve every action and allow long names and extra actions to wrap rather than clipping them.
- Cascade correction: the shared primary-button selector initially retained its 46px minimum. A scoped court selector now gives desktop actions a 36px minimum and phone actions a 44px minimum. The revised desktop capture and focused comparison confirm aligned primary buttons in all four cards, including the empty card.
- Final cards are 314.359 CSS px tall in the desktop sample, a 24.4% reduction. Their natural height can grow for long names, large PINs or additional state. The empty card reserves the secondary-action row space without showing print/reset controls for a nonexistent game.
- No actionable P0/P1/P2 differences remain. The existing typography, queue spacing and operational alert panel are retained; the user approved compact courts rather than a redesign of those regions. The sample rest expiry differs from the illustration because it is calculated from real elapsed time.

## Required fidelity surfaces

| Surface | Result |
| --- | --- |
| Fonts and typography | Existing font system retained. Player names remain 16px, court controls 12px desktop / 13px phone, and metadata remains readable. Score and PIN numerals use compact 16px styling. No truncation or hidden information. |
| Spacing and layout | Four columns desktop, two tablet, one phone. Less internal whitespace, equal desktop card heights, full-width Track/Assign actions and a single secondary-action row where space permits. Natural wrapping is retained. |
| Colors and tokens | Existing navy, lime, paper, border and semantic court-state colors are preserved. Awaiting validation and help status remain visible in amber. |
| Assets and image quality | Existing Racketeers brand treatment and Phosphor icons remain. No new raster assets or approximations were introduced. The empty-court icon is reduced to 28px. |
| Copy and content | Match identifiers, brackets, pairs, scores, PIN/copy, availability, pending-validation/help messages and all existing controls remain. No print-sheet or match-data changes. |

## Browser and automated validation

Desktop: 1440 CSS px client and scroll width; card actions align and stay within their containers. Track game opens the existing score dialog; Escape closes it and restores focus. Both Standard scorecard and Umpire handoff with PIN remain accessible through the print menu.

Tablet: 834 × 1194 CSS frame, 819px client and scroll width after the scrollbar; four 314.359px cards in two columns. Controls have no horizontal overflow. Evidence: `/workspace/scratch/302884b9ef26/compact-courts-tablet.jpg` (outer browser viewport capture).

Phone: 390 × 844 CSS frame, 375px client and scroll width; card widths are 343px and Track/Assign actions are 44px high. Scores, PIN/copy and all three game actions remain readable. The sample help request was cleared and its notification dismissed to inspect unobstructed cards. Evidence: `/workspace/scratch/302884b9ef26/compact-courts-phone.jpg` (outer browser viewport capture).

Console logs were checked. No current application errors were found; older Vite errors from before this request and browser-extension metadata errors are not application regressions. A tablet full-page screenshot timed out once; the documented viewport screenshot API recovered successfully.

102 existing automated tests and 2 built-Worker rendering tests pass. Lint, production build and whitespace checks pass. No new tests were added for this CSS-only refinement. Physical devices and printing are not part of this court-layout validation.

## Implementation checklist

- Compact court spacing and score/PIN styling: complete.
- Preserve statuses and all existing game actions: complete.
- Desktop/tablet/phone browser check and visual comparison: complete.
- Publish the approved court CSS only; print redesign awaits review.

## Previous Game Day Desk validation

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
