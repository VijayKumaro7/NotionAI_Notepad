# Security Architecture Recommendations

Audited commit `d436c16` · 2026-11-03. Companion to `SECURITY_AUDIT_REPORT.md`.
These are design-level recommendations; none has been implemented.

## 1. What the architecture gets right

Worth preserving, because they are the reason there are no High findings:

- **One choke point per concern.** `establishSession` for every sign-in path (so 2FA cannot be skipped by a new method), `authenticateRequest` for every protected call, `collabAccess.ts` for every collaboration decision, `requireSameOrigin` mounted at `/api/trpc` rather than per-procedure.
- **Revocable sessions.** A signed JWT is _not_ the source of truth; a DB row is. That makes logout, password change and "sign out other devices" real.
- **Zero-knowledge default for notes.** The server stores ciphertext; the key is never sent. Published (collaborative) notes and saved chats are the explicit, documented exceptions.
- **Fail closed.** Access reads return "no access" when the DB is unavailable; startup refuses unsafe configuration (`assertStartupConfig`).
- **The browser names an operation, not a prompt.** AI endpoints are not an open relay.

## 2. Weak architectural decisions and trust-boundary gaps

| #   | Observation                                                                                                                        | Consequence                                                                         | Linked finding |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------- |
| A-1 | Authorization is a **point-in-time** decision for long-lived connections.                                                          | Revocation does not reach open sockets.                                             | VULN-02        |
| A-2 | Abuse controls are **per-process memory**.                                                                                         | Controls vanish on restart and don't compose across instances.                      | VULN-07        |
| A-3 | Resource limits exist for _rate_ but not for _volume_ (bytes/rows per account).                                                    | Cost-exhaustion by a cheap account.                                                 | VULN-03        |
| A-4 | Two sign-in families with **different CSRF rigor** (Google strong, portal weak).                                                   | Weakest door sets the floor.                                                        | VULN-01        |
| A-5 | Ciphertext integrity is **not bound to identity**; the server is "untrusted" for confidentiality but trusted for integrity.        | A hostile server can substitute or replay blobs.                                    | VULN-08        |
| A-6 | Data lifecycle is **append-mostly**: soft-delete without purge, plaintext collab copy outliving the note.                          | Larger breach blast radius; privacy expectation gap.                                | VULN-09        |
| A-7 | The encryption key sits **beside** the data it protects (IndexedDB).                                                               | Any same-origin script execution (or local access) reads everything.                | INFO-01        |
| A-8 | One secret (`JWT_SECRET`) is the root for session signing, OAuth-flow signing, TOTP encryption, recovery-code HMAC and IP hashing. | Single point of failure; rotation signs everyone out and invalidates 2FA enrolment. | INFO-05        |
| A-9 | Capability tokens (share links) travel in URLs.                                                                                    | Logged by proxies.                                                                  | VULN-11        |

## 3. Recommended improvements (ordered by value)

### 3.1 Make authorization continuous for real-time channels

- Give each socket a **principal** (`userId`, `sid`, optional `linkToken`) and re-validate on a **short interval** and on **events** (collaborator removed, role changed, link revoked, session revoked, note deleted).
- Introduce a tiny in-process event bus (`access:changed(noteId|userId)`) so mutations _push_ revocation instead of waiting for a sweep.
- When scaling past one instance, publish the same events over Redis/MySQL LISTEN-style polling.

### 3.2 Put abuse controls in shared storage and add volume quotas

- One `RateLimiter` interface with two implementations: in-memory (dev/test) and DB- or Redis-backed (production). Select by env.
- Add **quotas** as first-class policy: notes per user, bytes per user, backups per user, concurrent sockets per user, chats per user. Enforce at write time with a clear error, and surface usage in the account panel.
- Treat `registerLimiter` + email verification as the only cost barrier to account creation; if quotas are generous, consider an invite/allow-list mode for small deployments.

### 3.3 Unify sign-in security

- Define a single `AuthFlow` contract (state binding, redirect-URI derivation from config, nonce/PKCE where the provider supports it, error mapping) and implement the portal flow against it, as Google already does. Delete portal sign-in if it isn't used in production.

### 3.4 Bind ciphertext to identity and version the format

- AES-GCM `additionalData` = `"<purpose>:<id>"` for notes, versions, bin entries, and backups; prefix payloads with a format version (`v2.`) so old data stays readable.
- Verify `payload.id === row.clientId` on pull. Consider a signed **manifest** (HMAC over `{clientId, updatedAt}` list, key-derived) so a server cannot silently drop or roll back notes — it is the only integrity property still missing from "untrusted server".

### 3.5 Treat the key like a key

- Offer an optional **passphrase wrap** (PBKDF2/Argon2 → AES-KW) so the at-rest key is not raw on disk; keep the current zero-friction mode as the default.
- Prefer a **non-extractable** `CryptoKey` for day-to-day use (a code comment shows this is considered) and keep export behind an explicit user action.
- Document the threat model in `SECURITY.md`: encryption defends against server/DB compromise, _not_ against same-origin script execution or an unlocked device.

### 3.6 Key and token hygiene

- Derive **separate secrets** per purpose from `JWT_SECRET` with HKDF (already done for TOTP/recovery/IP-hash) — extend it to session signing and the OAuth-flow cookie, add `typ`/`aud`, pin `appId`.
- Plan **key rotation**: accept a `JWT_SECRET_PREVIOUS` for a grace window so rotation does not sign everyone out or break 2FA.
- Consider hashing share-link tokens at rest and sending them in headers/first-message rather than URLs.

### 3.7 Data lifecycle

- Define retention per table (notes bin, collab docs, chats, security events, expired sessions) and implement a scheduled purge. Make "delete" of a published note delete the plaintext collaborative copy immediately.
- Put multi-statement deletions (`deleteAccountData`) in a transaction where the engine allows; keep the retry-safe ordering.
- Add foreign keys with `ON DELETE CASCADE` where ownership is intended; it also simplifies erasure.

### 3.8 Detection and response

- Attribute failed sign-ins to the target account when it exists, so users can see attempts.
- Emit **structured** security logs (JSON) for auth events, rate-limit trips, revocations, quota rejections; ship them off-box. Today events live only in the app database that an attacker would also touch.
- Alert on: spike in `sign_in_failed`, many `two_factor_failed` for one user, `rate_limited` bursts, large backup writes, new-device sign-ins (email notice).

### 3.9 Pipeline and supply chain

- Add SAST (CodeQL + Semgrep) and a ZAP baseline against an ephemeral stack; pin GitHub Actions to commit SHAs; enable Dependabot/Renovate for actions and npm.
- Generate an **SBOM** (CycloneDX) in CI and attach it to releases.
- Run the e2e suite in CI (the project notes this is a deliberate cost decision; revisit as the suite is the strongest regression net for the wiring-level bugs recorded in `CLAUDE.md`).

### 3.10 Deployment hardening

- Require TLS to MySQL in production (`ssl` in the URL; enforce at startup).
- Run with a **least-privilege DB user** (no DDL at runtime; migrations under a separate role).
- Terminate TLS at the proxy, set `TRUSTED_PROXY_HOPS` to the exact topology, and add `Strict-Transport-Security: preload` only once every subdomain is HTTPS-only.
- Keep the Netlify/Render/nginx header policies generated from **one source** to avoid drift (today they are hand-copied).
- Never run the Vite dev server (with its session-replay collector and `allowedHosts: true`) on a reachable host.

### 3.11 AI-specific controls

- Keep prompts server-side and tools absent — preserve this invariant explicitly in docs; if tools/agents are ever added, introduce an allow-list, per-tool authorization, and human confirmation for writes.
- Use a per-request random delimiter for untrusted note context and treat shared-note text as untrusted input.
- Add org-level spend caps with the provider as the final backstop behind in-app limits.

## 4. Target architecture (summary)

```
Client ── same-origin only, strict CSP, key wrapped (opt.) ──► Edge/proxy (TLS, header policy from one source, structured logs without tokens)
   │                                                              │
   │                                                              ▼
   │                                              App instances (stateless)
   │                                              ├─ AuthFlow contract (state/PKCE/nonce) for every IdP
   │                                              ├─ Access service (authz decisions + change events)
   │                                              ├─ Quota & limiter service ─► shared store (DB/Redis)
   │                                              └─ Realtime hub (re-validates on events + sweep)
   ▼                                                              │
IndexedDB (ciphertext, AAD-bound)                                 ▼
                                                  MySQL (TLS, least-priv, retention jobs, FKs) · S3 (SSE, per-user prefix, quotas)
```

## 5. Single points of failure

| Component             | Failure                                              | Mitigation                                                               |
| --------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `JWT_SECRET`          | Disclosure forges sessions and decrypts TOTP secrets | Purpose-separated secrets; rotation with grace period; secret manager    |
| Browser IndexedDB key | Loss = permanent data loss; theft = full read        | Recovery phrase (exists); optional wrap; prompt users to save the phrase |
| Single app process    | Limiters reset; rooms lost; WS state in memory       | Shared limiter store; sticky or stateless realtime                       |
| Single DB             | Holds all plaintext exceptions                       | TLS, encryption at rest, retention, backups with restore tests           |

## 6. What not to change

- Don't replace the DB-backed session design with stateless JWTs.
- Don't add server-side key escrow for convenience — `SECURITY.md` is right that a server route to plaintext is the one thing this design must not have.
- Don't move AI prompt construction to the client.
