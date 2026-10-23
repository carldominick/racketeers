# Backup and recovery

This is an operating procedure, not an automated migration. Development tests use disposable local storage. No production backup or restore has been performed as part of the site-improvement work.

## Copies available in the organizer interface

Prepare → Setup → **Download tournament state backup** downloads the exact stored tournament payload, its revision, SHA-256 digest and export time. Organizer authorization is required and the response is private/no-store. The file contains registrations, contacts, recovery data, access hashes, match PINs, pairings, games, scores and tournament preferences. Keep it in restricted storage; never commit it or attach it to a public issue. It is a recovery copy, not an import file or a complete site backup.

Prepare → Registration → CSV/XLSX exports include saved reviewed payment amount, reference, source bank/app, date, screenshot transfer status, review status/time, duplicate-reference warning, payment group and screenshot version. These are administrative exports, not raw database backups. The amount repeats for each player in the same payment group: deduplicate by payment group before totaling. XLSX stores reference numbers as text; import the CSV reference column as text to retain leading zeroes. Receipt links are private bearer links valid for seven days and become invalid after organizer PIN rotation.

Bracket regeneration requires downloading the current state copy, checking that the file is saved, and typing REGENERATE. Any revision change invalidates that approval. The server rejects regeneration in Live/Completed or after a game has started, even if the phase is subsequently changed. This protects the reviewed regeneration path; it is not a universal backup requirement for all organizer corrections or roster operations.

## Complete recovery set

Before any separately authorized release that changes storage, migration, reset or recovery, verify the account, Worker, D1 database and private R2 bucket against the intended environment. Record the deployed source/version and establish a consistent capture window with staff so writes cannot change the data between captures.

| Storage | Required content |
| --- | --- |
| D1 `tournament_state` | Exact payload, revision and timestamp, including private recovery/access data. |
| D1 `payment_settings` | Separate payment instructions and account information. |
| D1 `payment_receipt_details` | Group identity, reference key, payload, screenshot version, review revision and timestamp. Include rows whose images were removed; they are absent from ordinary receipt exports. |
| D1 `sponsor_images` | Image IDs, names and creation metadata. |
| Private R2 | Original object keys, image bytes and available metadata for payment proofs, payment QR and sponsor images. Include legacy individual/pair proof keys as well as payment-group keys. |

Use a full database backup to retain additional operational tables such as rate-limit data. Preserve R2 keys exactly, including `payments/...`, `payment-instructions/qr.png` and `sponsors/...`. Do not infer an object inventory from the public sponsor list or current registrations alone: retained/unlisted objects may exist. Record counts, byte lengths and content digests in a private manifest. Database/state JSON and Git/source copies do not contain R2 images. Application secrets and infrastructure bindings require their own secure recovery arrangements; never put them in this repository.

## Verify before relying on a backup

Check that the downloaded files exist and can be parsed, and that the state payload digest matches its wrapper. Confirm database table counts and the object manifest against the captured environment. Restore a copy into isolated disposable D1/R2 first, using test access controls and without publishing receipt images. Verify linked-player ownership, receipt access, reviewed fields, sponsor images, payment QR, scores and schedule. Screenshot versions can change after restoring objects; require a fresh review where the saved version no longer matches. A download success message or matching hash alone does not establish that the whole site is recoverable.

## Authorized recovery

Agree on the exact recovery point, affected records, maintenance window and rollback plan before writing production data. Take a fresh complete recovery set first. Prevent staff/public writes during recovery, restore the approved database and object set together, and preserve monotonically advancing state revisions so old open clients cannot write stale snapshots. Review access hashes/recovery PINs separately: a historical snapshot must not silently reinstate superseded credentials. Verify private endpoints and public filtering, record the restored version/counts, then have staff reload before resuming. Do not use bracket regeneration as a restore operation, and do not delete retained receipts to make a restore fit. There is deliberately no one-click production restore in the UI.
