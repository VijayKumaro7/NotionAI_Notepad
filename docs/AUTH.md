# Authentication, end to end

Internal reference for the auth surface: what each procedure takes, what it
answers, what it refuses and how hard it can be pushed. It is written for
whoever has to change one of them next.

The reasoning behind each decision lives in the file that implements it — this
document says _what_, the code says _why_. Where the two disagree the code is
right and this file is stale.

---

## Architecture

Sessions are a **signed cookie naming a database row**. Both halves are load
bearing:

| Half                               | File                     | What it provides                                                                                                                        |
| ---------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| A signed JWT in an httpOnly cookie | `server/_core/sdk.ts`    | Integrity. A forged cookie is rejected on the signature, before any query runs, so unauthenticated traffic cannot become database load. |
| A row in `userSessions`            | `server/sessionStore.ts` | Revocation, idle timeout, absolute expiry, and a list someone can look at. A signature can never express "valid, except now".           |

The cookie carries a `sid` claim: 256 bits from the CSPRNG, stored only as a
SHA-256 hash. A token with no `sid` does not authenticate — it names no session,
so nothing could ever revoke it, which is the shape of cookie this design exists
to stop honouring.

Every sign-in path — the Manus portal callback, email and password, Google —
ends in `establishSession` (`server/session.ts`), so the two-step verification
gate, the session row and the audit event are each written once rather than
three times.

### Clocks

|          | Full session | Half-signed-in (`pending_2fa`)         |
| -------- | ------------ | -------------------------------------- |
| Absolute | 90 days      | 10 minutes                             |
| Idle     | 30 days      | n/a — the absolute deadline is shorter |

`lastSeenAt` is written at most every 5 minutes, so an authenticated request is
not also a write. The idle check runs _before_ the touch: a request arriving
after the window has closed must not extend the window it missed.

### Rotation

The session secret is replaced, keeping the row, whenever the session's standing
changes:

- clearing the second factor — otherwise a value planted in the browser before
  the code was entered is the value that authenticates afterwards, which is
  session fixation;
- setting a new password — so a copy of the cookie taken before the change is
  dead too, while the person who made the change stays signed in.

### Revocation

| Event                        | Effect                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| Sign out                     | This session only.                                                                        |
| `auth.sessions.revoke`       | One named session, owner checked inside the query.                                        |
| `auth.sessions.revokeOthers` | Everything but the one in hand.                                                           |
| Password change              | Everything but the one in hand, which is rotated.                                         |
| Password reset               | **Everything, no exception.** A reset is the remedy for "somebody else is in my account". |
| Account deletion             | The rows go with the account.                                                             |
| Idle timeout                 | The row is closed, not merely refused for that request.                                   |

---

## Endpoints

All of these are tRPC procedures under `/api/trpc`. "Auth" is what the procedure
requires of the caller.

### Sign-in and registration

| Procedure                         | Auth            | Input                                           | Answers                                                 | Refuses                                        | Limit                                     |
| --------------------------------- | --------------- | ----------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------- |
| `auth.email.register`             | none            | `email`, `password`, `name?`, `recaptchaToken?` | One fixed message, whatever happened                    | Weak password, unconfigured email              | 5/h per address                           |
| `auth.email.signIn`               | none            | `email`, `password`, `recaptchaToken?`          | `{ needsSecondFactor, destination }`                    | One message for every cause                    | 10/15min per account, 30/15min per origin |
| `auth.email.verify`               | none            | `token`                                         | `{ success }`                                           | Invalid, expired or spent token                | —                                         |
| `auth.email.requestPasswordReset` | none            | `email`, `recaptchaToken?`                      | One fixed message                                       | —                                              | 5/h per address                           |
| `auth.email.resetPassword`        | none            | `token`, `password`                             | `{ success }`                                           | Invalid, expired or spent token; weak password | —                                         |
| `auth.twoFactor.verifyLogin`      | pending session | `code`                                          | `{ success, usedRecoveryCode, recoveryCodesRemaining }` | Wrong code; expired attempt                    | 5/15min                                   |

Register, sign-in and forgot-password answer identically for an address that has
an account and one that does not — **including how long they take**. Sign-in
hashes the supplied password against a decoy when there is no account, and
register hashes before the branch that discovers the address is taken. A reply
that is identical in wording and half a second apart in timing is not identical.

### Session lifecycle

| Procedure                    | Auth | Input       | Answers                                                      | Limit    |
| ---------------------------- | ---- | ----------- | ------------------------------------------------------------ | -------- |
| `auth.me`                    | none | —           | The user, or null                                            | —        |
| `auth.loginState`            | none | —           | `signed_in` / `pending_2fa` / `signed_out`                   | —        |
| `auth.methods`               | none | —           | Which sign-in methods this deployment offers                 | —        |
| `auth.logout`                | none | —           | `{ success }`                                                | —        |
| `auth.sessions.list`         | full | —           | Device, first seen, last used, expiry, and which one is this | 60/10min |
| `auth.sessions.revoke`       | full | `sessionId` | `{ revoked }`                                                | 60/10min |
| `auth.sessions.revokeOthers` | full | —           | `{ revoked }`                                                | 60/10min |
| `auth.activity`              | full | —           | The last 20 security events on this account                  | —        |

`auth.logout` is public deliberately: a session that has gone bad is exactly the
one someone needs to end, and requiring a valid session to end a session is a
trap.

`auth.sessions.revoke` answers `NOT_FOUND` with one message for a session that
is already revoked, one that does not exist, and one belonging to someone else.
Different answers would make it a way of asking which session ids exist on other
accounts.

### Account

| Procedure                | Auth | Input                                | Answers                                               | Limit    |
| ------------------------ | ---- | ------------------------------------ | ----------------------------------------------------- | -------- |
| `account.changePassword` | full | `currentPassword`, `newPassword`     | `{ success, otherSessionsRevoked }`                   | 5/h      |
| `account.requirements`   | full | —                                    | What deletion will ask for; whether a password exists | —        |
| `account.export`         | full | —                                    | Saved chats, for the archive                          | 10/10min |
| `account.delete`         | full | `confirmation`, `code?`, `password?` | A summary of what was erased                          | 5/h      |

`account.changePassword` asks for the current password even though the caller
holds a session. A session is the thing that gets stolen; the password is what
decides who can come back tomorrow.

### Error behaviour

Procedures answer with a `TRPCError` whose code is chosen so the UI can act, and
whose message is safe to display verbatim. Nothing carries a stack trace, a
query, a hash, or which of several causes applied. `TOO_MANY_REQUESTS` says how
long to wait; `SERVICE_UNAVAILABLE` distinguishes "this deployment has not
configured email" from "you got it wrong", which is the difference between a
retry and a support ticket.

---

## Database

Added by this work (`drizzle/0008_bitter_paladin.sql`):

**`userSessions`** — one row per session.
`tokenHash` (unique), `userId`, `scope`, `device`, `ipHash`, `createdAt`,
`lastSeenAt`, `expiresAt`, `revokedAt`, `revokedReason`.
Indexed on `tokenHash` (unique — lookup is by hash alone, so nothing about who a
session belongs to is trusted from the request), `(userId, createdAt)` for the
list and the revoke-all sweep, and `expiresAt` for the purge.

**`securityEvents`** — the audit trail.
`userId` (nullable), `type`, `ipHash`, `device`, `detail`, `createdAt`.
Indexed on `(userId, createdAt)` and `(type, createdAt)`.

Both are erased by `deleteAccountData`, before the `users` row.

### What is deliberately not stored

- **The session secret.** Only its SHA-256. A leaked dump is not a pile of
  working sessions.
- **IP addresses.** An HMAC under a key derived via HKDF from `JWT_SECRET`,
  which cannot be reversed and cannot be matched against a guess without the
  key. Null when there is no secret — an unkeyed hash of an IPv4 address is a
  lookup table, not a pseudonym.
- **User agent strings.** A label from a fixed vocabulary ("Chrome on macOS"),
  never a slice of the input. Enough to recognise a session; not a fingerprint.
- **The address behind a failed sign-in.** Writing it down would assemble, out
  of failed guesses, exactly the list of addresses the identical error messages
  refuse to confirm.

The audit row has **no free-text column**. Its shape is the control: every field
is an id, a member of a closed union, or a keyed hash, so there is nowhere for a
password, a token or a cookie to end up — including at a call site written in a
hurry.

---

## Transport and browser controls

| Control          | Where                             | Value                                                                                                                                                                                                           |
| ---------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cookie flags     | `server/_core/cookies.ts`         | `httpOnly`, `SameSite=Lax`, `Secure` (forced in production), host-only, `path=/`                                                                                                                                |
| CSRF             | `server/_core/csrf.ts`            | Origin/Referer check on every non-GET API request, mounted before the router                                                                                                                                    |
| CORS             | none, by design                   | No `Access-Control-Allow-Origin` is ever sent, so browsers refuse every cross-origin read. Stricter than an allowlist; asserted in `securityHeaders.test.ts` so adding a permissive one later is a failing test |
| CSP              | `server/_core/securityHeaders.ts` | No `unsafe-inline` script, `frame-ancestors 'none'`, `form-action 'self'`, `object-src 'none'`                                                                                                                  |
| HSTS             | same                              | `max-age=31536000; includeSubDomains`, only over TLS                                                                                                                                                            |
| Others           | same                              | `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, COOP, CORP                                                                                                                |
| HTTPS            | same                              | 308 redirect in production; non-GET gets 403 rather than a redirect that would lose its body                                                                                                                    |
| Global flood cap | `server/_core/index.ts`           | 600 requests/minute per address                                                                                                                                                                                 |

No credential is in `localStorage`. The session lives in an httpOnly cookie, and
the session list marks the current device server-side rather than telling the
page its own session id.

---

## Passwords

scrypt, N=2¹⁶ r=8 p=1 (~64MB per hash, the OWASP floor), 16-byte salt, 32-byte
key. The stored hash carries its own parameters, so the cost can be raised later
without a forced reset — `needsRehash` reports weaker hashes and sign-in
upgrades them once the plaintext is in hand.

Length only: 12–200 characters, in `shared/password.ts` so the form and the
procedure read the same numbers. Composition rules push people towards
`Passw0rd!`, which is short, predictable, and satisfies all of them.

The 200-character cap is not an algorithm limit — scrypt does not truncate — it
stops a megabyte of input tying up 64MB of RAM per request.

---

## Deployment

Required:

- `JWT_SECRET` — signs session cookies, derives the TOTP encryption key and the
  IP-hash key. Rotating it ends every session and every two-step enrolment.
- `DATABASE_URL` — sign-in needs it. Without it, sessions cannot be recorded and
  `establishSession` refuses rather than issuing a cookie nothing can revoke.

Optional, each gating one feature that reports itself unavailable when unset:
`EMAIL_API_*` (registration and reset need it), `GOOGLE_CLIENT_*`,
`RECAPTCHA_*`, `PUBLIC_ORIGIN`, `TRUSTED_PROXY_HOPS`, `S3_*`.

`PUBLIC_ORIGIN` is worth setting explicitly behind a custom domain: it decides
the CSRF origin check, the Google `redirect_uri` and the links inside email,
none of which may be built from a request header.

Run `pnpm db:push` (or `drizzle-kit migrate` in production) before deploying —
until `userSessions` exists, no sign-in can complete.

**Sessions minted before this change no longer authenticate.** They carry no
`sid`, so everyone signs in again once. That is the intended cost of the cookie
becoming revocable.
