# Security Remediation Plan

Audited commit `d436c16` · 2026-11-03.
**Nothing in this plan has been applied.** The audit rules forbade modifying application code; every item below is a recommendation.

Complexity scale: **S** ≤ half a day · **M** 1–3 days · **L** > 3 days (includes tests and review).

## Priority summary

| Priority | Meaning | Items |
|---|---|---|
| **P0** | Fix immediately (Critical) | *None identified* |
| **P1** | Next release (High) | *None identified* |
| **P2** | Within the next sprint or two (Medium) | VULN-01, VULN-02, VULN-03 |
| **P3** | Backlog / hardening (Low) | VULN-04 … VULN-11, INFO items |
| **P-V** | Verification debt — do first, it is cheap | V-1 … V-4 |

## P-V — Close the verification gap first

These are not vulnerabilities; they are the reason several conclusions are "code-confirmed" rather than "exploit-confirmed".

| # | Task | Complexity | Validation |
|---|---|---|---|
| V-1 | Run `pnpm install --frozen-lockfile && pnpm check && pnpm test` and record the result | S | All green, or a list of failures to triage |
| V-2 | Run `pnpm test:e2e` (real Chromium) | S | Green |
| V-3 | Add Semgrep (`p/typescript`, `p/owasp-top-ten`) and CodeQL to CI | S–M | A scan runs on PRs; baseline triaged |
| V-4 | Run an OWASP ZAP baseline against a local `pnpm start` with a throwaway DB (authorised, local only) | M | Report archived; no new High |

## P2 — Medium

| ID | Recommended change | Complexity | Affected modules | Validation procedure |
|---|---|---|---|---|
| **VULN-01** | Replace client-built `state=btoa(redirectUri)` with a server-issued random `state` in a sealed HttpOnly `SameSite=Lax` cookie (10 min), verified with `sameSecret`; derive `redirectUri` from `ENV.publicOrigin`; add `/api/oauth/start`. If the portal sign-in is unused, remove it instead. | M | `client/src/const.ts`, `server/_core/oauth.ts`, `server/_core/sdk.ts`, new tests beside `googleAuth.test.ts` | (1) Callback with no state cookie → redirect to `/login?auth_error=…`, no `Set-Cookie`. (2) Mismatched state → same. (3) Happy path still signs in. |
| **VULN-02** | Store `userId`, `sid`, `linkToken` on `Member`; add `enforceAccess(noteId)` that re-resolves access and closes (4403) or downgrades; call it from `removeCollaborator`, `setCollaboratorRole`, `revokeShareLink`, note soft-delete, `revokeAll`, `endSession`; add a 30 s sweep that also calls `checkSession`. | M | `server/_core/collaboration.ts`, `server/collab.ts`, `server/session.ts`, `server/db.ts` | Extend `server/_core/collaboration.test.ts`: after each revocation the socket closes within the sweep interval and a subsequent `update` is rejected; role downgrade editor→viewer blocks writes immediately. |
| **VULN-03** | Add `backupLimiter` (≈10/h/user); cap backups per user (evict oldest) and total bytes; cap notes per user and total synced bytes; paginate `listBackups`. Make caps configurable via env with sane defaults. | M | `server/rateLimit.ts`, `server/storage.ts`, `server/db.ts` (`upsertNoteByClientId`), `server/routers.ts` | Unit tests: (n+1)th backup evicts oldest; over-quota write refused; limiter blocks the 11th request in an hour; sync of a normal workspace still succeeds. |

## P3 — Low and hardening

| Priority | ID | Recommended change | Complexity | Affected modules | Validation procedure |
|---|---|---|---|---|---|
| P3 | **VULN-04** | Uniform response for unknown/known emails on invite (or pending-invite-by-email); add per-owner `inviteLimiter` (~20/h). | S | `server/collab.ts`, `server/rateLimit.ts`, `ShareModal`/`CollaboratorsPanel` copy | Same body for both cases; limiter test. |
| P3 | **VULN-05** | `setCollaboratorRole` → `UPDATE … WHERE noteId AND userId`, fail on 0 rows; add FK constraints (`noteCollaborators.userId → users.id`, etc.) via migration. | S–M | `server/collab.ts`, `server/db.ts`, `drizzle/schema.ts` + migration | Test: setRole for non-collaborator → `not_found`; migration applies on a copy of prod data. |
| P3 | **VULN-06** | Key lockout on `(email, address)`; keep a higher per-email ceiling; consider CAPTCHA step-up rather than hard lock. | S | `server/emailAuth.ts`, `server/rateLimit.ts` | 10 failures from IP A do not block a correct sign-in from IP B. |
| P3 | **VULN-07** | Move limiter state to MySQL (atomic upsert on `(key, windowStart)`) or Redis; otherwise document single-instance and warn at startup if `WEB_CONCURRENCY`/replica hints are >1. | M–L | `server/rateLimit.ts`, `server/_core/apiRateLimit.ts`, `server/googleRoutes.ts` | Restart test: counters persist; two-process test shares counters. |
| P3 | **VULN-08** | Pass `additionalData = "note:<id>"` to AES-GCM; version the payload (prefix) for back-compat; in `decryptRemoteNotes` treat `note.id !== row.clientId` as unreadable. Apply to versions/bin/backups with their own AAD labels. | M | `client/src/lib/storage.ts`, `client/src/lib/syncService.ts`, `keyImport.ts` | Tests: swapped blob rejected; old-format blobs still readable; re-seal during key import keeps working. |
| P3 | **VULN-09** | On soft-delete: delete `collaborativeDocuments`, collaborators, share links. Add a scheduled purge (soft-deleted notes > 30 d; `securityEvents` > 180 d); offer chat retention setting. Update `Privacy.tsx`. | M | `server/db.ts`, `server/collab.ts`, new job, `client/src/pages/Privacy.tsx` | Deleting a published note removes its collab row; purge job test with fake clock. |
| P3 | **VULN-10** | Per-user (~10) and per-address connection caps; rate-limit upgrades with `clientAddress`; test oversize updates on a cloned `Y.Doc` before applying to the room. | M | `server/_core/collaboration.ts` | 11th concurrent socket refused; repeated oversize updates do not grow room memory. |
| P3 | **VULN-11** | Move share token out of the WS URL (first message or subprotocol); log `$uri` not `$request_uri` in nginx; encourage finite link expiry (default 30 days in UI). | S–M | `server/_core/collaboration.ts`, `client/src/lib/collaborationClient.ts`, `deploy/nginx/notepad.conf`, `ShareModal` | Token absent from a sample access log; links still connect. |
| P3 | INFO-13 | Pin Actions to commit SHAs; add CodeQL job (see V-3). | S | `.github/workflows/*` | CI green; Dependabot/Renovate for action bumps. |
| P3 | INFO-05 | Add `typ`/`aud` to session and flow JWTs; compare `appId` to `ENV.appId` in `verifySession`. | S | `server/_core/sdk.ts`, `server/googleAuth.ts` | Flow cookie rejected as session and vice versa; old sessions handled by grace period. |
| P3 | INFO-07 | Require TLS for `DATABASE_URL` in production (startup check). | S | `server/_core/startupChecks.ts` | Boot fails without `ssl` param in production. |
| P3 | INFO-10 | Randomise the `<note>` delimiter per request and strip it from `noteContext`. | S | `server/chat.ts` | Test: note containing `</note>` cannot close the wrapper. |
| P3 | INFO-11/12 | Attribute failed sign-ins to the user when the email exists; throttle `lastSignedIn` writes to e.g. once per 5 minutes. | S | `server/routers.ts`, `server/_core/sdk.ts` | Activity feed shows failed attempts; DB writes per request drop. |
| P3 | INFO-01/04/06/08/09/14/15 | Document in `SECURITY.md` / harden as listed in the register. | S | docs / config | Review. |

## Suggested sequencing

1. **Week 0:** V-1…V-4 (establish baseline).
2. **Sprint 1:** VULN-01 (or remove portal path), VULN-02, VULN-03.
3. **Sprint 2:** VULN-05, VULN-04, VULN-06, VULN-10, VULN-11.
4. **Sprint 3:** VULN-08 (needs payload versioning), VULN-09, then VULN-07 if scaling beyond one instance.
5. Fold INFO items into routine maintenance.

## Regression-test rule

Per the project's own convention (`CLAUDE.md`, "Check that a regression test fails without its fix"): for each item above, write the test first, watch it fail against the current code, then make it pass.
