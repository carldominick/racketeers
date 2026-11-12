# Organizer accounts and audit history

Organizer access uses named accounts after activation. Deployment makes activation available through User management.

## Accounts

| Initial username | Access |
| --- | --- |
| carl.taboada | Tournament and account management |
| erin.kizel | Tournament and account management |
| regin.povz | Tournament and account management |
| racketeers | View-only organizer access |

Account IDs and privileges stay fixed when usernames change. Racketeers can navigate organizer tabs, read the roster, settings and audit history, and expand information. Editing buttons, fields, sponsor uploads, printing and other actions inside organizer tabs are disabled. Server checks independently reject mutations, including requests with alternate umpire credentials while signed in as this viewer. It must change its generated password at first sign-in, before entering the organizer; subsequent account edits require a manager.

Choose Organizer or Umpire in Staff access. Organizer opens the username and password form, with an existing organizer PIN option before account activation. Umpire opens the staff PIN form and asks for the match PIN when opening a scorecard. A signed-in named organizer can start the existing isolated demo from its entry page with the legacy PIN field blank; the viewer cannot start a demo. User management is hidden inside the isolated demo because it cannot modify live account storage.

## Activation and recovery

After reviewing and releasing the source, take a complete private D1 backup and verify recovery access. Existing organizer PIN access remains available until **Prepare → User management → Create the four organizer accounts** is explicitly used. This action requires the current organizer PIN and a clean/saved tournament. D1 activation and four account inserts run atomically with a tournament revision check. A racing tournament save rejects activation rather than overwriting data.

Initial passwords are generated with secure randomness at activation, displayed once to the authenticated organizer, and stored only as salted password hashes. They are not compiled into source or written into this document. Save and deliver them privately before leaving the screen. Each account must change its initial password before tournament access is granted. A manager can generate a new initial password if one is lost.

Activation retires the organizer PIN and switches receipt share links to a new private signing key. Links exported before activation expire immediately. Organizers can export fresh links, and uploaded receipts remain available through their normal authorized paths. Tournament writes preserve the server's activation and signing fields. Umpire and registration PINs keep their existing independent purpose. View-only accounts can read organizer data and audit history, with access to backups, registration edit PINs and match PINs reserved for managers.

In **Prepare → User management → Accounts**, account managers can add an organizer admin, rename accounts and reset another account's password after confirming their own password. The new admin appears in the account list and must replace the initial password at first sign-in. Own-account changes also require the current password. Passwords must be 14–256 characters. Initial passwords use 128 random bits. Credential changes increase an account version, invalidating every existing session for that account. The UI blocks account changes while tournament edits are unsaved.

Accounts, sessions, per-account login admission and audit events live in separate D1 tables: `organizer_accounts`, `organizer_sessions`, `organizer_login_limits`, `organizer_audit`. Runtime handlers create them; no production binding or existing table is replaced. Tournament JSON exports do not contain these tables. Retain a complete D1 backup and separately retain R2 and secret/binding recovery material. A JSON-only restore is not sufficient for an activated site. There is no public account reset or recovery-PIN bypass. Recovery of all manager accounts requires an explicitly authorized operator with D1 access and a reviewed recovery plan.

## Security properties

Sessions use random 256-bit tokens in a Secure, HttpOnly, SameSite=Strict, host-only cookie. D1 retains token hashes, account versions and an eight-hour absolute expiry. Logout revokes that account's sessions. Explicit organizer request markers keep public/projector state requests from accidentally becoming private just because the browser also has an organizer session.

Expired/revoked sessions pause organizer saves and authenticated polling. The complete unsaved draft remains in memory, with a Renew organizer sign-in action. Reauthentication retains the original compare-and-swap revision; it never substitutes a newer revision into a stale draft. Existing conflict resolution still requires loading the latest authorized state before reapplying changes. Queued umpire corrections are retained and use the existing retry flow. This remains memory-only recovery, not durable offline storage.

Password hashing uses versioned, uniquely salted PBKDF2-SHA256 at 100,000 iterations, respecting the [Cloudflare workerd iteration bound](https://github.com/cloudflare/workerd/issues/1346). This is a documented platform tradeoff, below OWASP's usual PBKDF2 work factor; it must not be advertised as the strongest available password storage or as hack-proof. Future stronger KDF or external identity/MFA work needs its own reviewed implementation and runtime/performance verification. Existing same-origin, size and persistent failed-IP protections apply. Atomic per-username admission caps sign-in attempts at 15 per 15 minutes across source IPs; unknown usernames receive the same password work and generic failure response.

## Audit semantics

Authenticated organizer write requests durably record an intent before the handler executes. Failure to create the intent prevents the write. The record contains stable user ID, username at that moment, UTC timestamp, a plain-language action description and the outcome. For example, a saved shared payment can read “Confirm payment for 2 player entries.” Older entries are translated for display using the detail originally recorded. The interface renders dates in Philippine time. Request bodies, passwords, PINs, contacts, receipt text and screenshots are not copied into audit rows.

Successful and rejected requests are distinguished. If a response outcome cannot be recorded after an operation, its durable intent remains **Pending**; it is not presented as proof that a change completed. The successful operation is not converted into a failure response that might provoke a duplicate retry. Account credential updates and their success marker use a D1 transaction with version checks. The UI has no edit/delete-history action. This is an application audit trail, not an independently signed or externally immutable forensic ledger; a database administrator can alter D1 directly.
