# Compact umpire console — design QA

final result: passed

Selected direction: the first displayed Product Design option, Compact Court Console.
Reference: generated_images/exec-3b8986fb-11da-4557-9113-e982aa4d4869.png (853 × 1844, normalized to the 390 × 844 phone frame).
Implementation: app/components/umpire-scorecard.tsx, app/page.tsx and app/globals.css.

## Visual comparison

Reference and rendered implementation were inspected together in the same image comparison input, both at Alex / Sam 18 versus Chris / Pat 16, Court 1, single set, help off, More closed. The browser proof contains the centered 390 × 844 app iframe inside the larger browser canvas; comparisons use the iframe bounds.

The first comparison found a P2 vertical-spacing mismatch: the header and court area pushed scoring below the reference. Reduced header, saved-status, court-badge and first-pair spacing, then captured and compared the implementation again. Final headings, score blocks, divider and rule footer closely follow the reference. Navy header, pale page, lime point buttons, subdued correction buttons and existing Manrope typography preserve the site's brand. Standard Phosphor vector icons replace the conceptual mockup symbols; no raster assets are required.

Final proof: Racketeers-Compact-Umpire-Mobile.jpg and Racketeers-Compact-Umpire-Landscape.jpg. Landscape at 844 × 390 shows both pairs side by side; footer ends at 381.5px, within the viewport. Phone scroll width equals viewport width (390px): no horizontal overflow. Phone score targets measure 96 × 96px; help is 52px high. Tablet uses the bounded 650px console with the same stacked controls. Final tablet screenshot verification was unavailable because the existing tablet preview tab was an internal browser error page; responsive CSS and build were reviewed. Physical devices and screen readers were not tested.

## Behavior and accessibility

Verified in the isolated fixture: More disclosure, Escape dismissal, focus/full-site toggle, help request/cancel, repeated point entry, winning-score cap, set-completion confirmation, score locking, court release and game-complete message. Best-of-three defaults to the current unfinished set and allows viewing completed sets and returning to the current set. A P2 accessible-label issue in the set selector was fixed by separating its label from the current-set action.

Scores, help and notifications continue through the existing API callbacks. Saved/saving/offline states and retry remain visible. Exit is unavailable while a score is unsaved. Completion and validation states retain their lock/unlock rules. Player names wrap rather than overflow. Keyboard focus indicators and explicit point-button labels are retained. No WCAG certification is claimed.

## Validation

ESLint passed. Production build passed. All 87 automated tests and both rendered Worker checks passed (89 checks total). Git whitespace check passed. Browser logs include historical Vite hot-reload and browser-extension metadata errors during iteration; final layout rendered correctly after recovery, with successful production compilation.

No unresolved P0, P1 or P2 findings in the inspected layouts. The final tablet browser check and physical-device checks remain validation limitations, not observed defects.
