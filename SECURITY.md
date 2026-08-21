# Security Policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report it privately through GitHub's [private vulnerability
reporting](https://github.com/VijayKumaro7/NotionAI_Notepad/security/advisories/new)
— the **Security** tab, then **Report a vulnerability**. That opens a draft
advisory only you and the maintainers can see.

Include what you need to make the problem reproducible: the affected version or
commit, the steps, and what an attacker gets out of it. A proof of concept helps
more than a description.

You should get an acknowledgement within a few days. If the report is valid,
expect a fix and a published advisory; if it is not, expect an explanation of
why rather than silence.

Please give a reasonable window to ship a fix before disclosing publicly.

## Supported versions

This is a single-deployment application, not a distributed library. Only the
current `main` branch receives security fixes. There are no maintained release
branches, and older commits are not patched.

## What the application protects, and how

Knowing the intended security model makes it much easier to tell a real
vulnerability from working-as-designed. Anything that breaks one of these
properties is worth reporting.

### Note content

Notes are encrypted in the browser with AES-GCM before they are persisted or
synced. The key is derived per user and never leaves the device. The server
stores and returns ciphertext, and cloud backups to S3 are ciphertext too.

**The server is not trusted with note content, and that is the point.** A
finding that the server can read notes is a serious one.

### Sessions

Session state is a signed JWT (HS256, `jose`) in an `HttpOnly`, `SameSite=Lax`
cookie, marked `Secure` over https. `JWT_SECRET` signs it.

The token carries a `scope` claim with two values:

- `full` — an ordinary signed-in session.
- `pending_2fa` — the first factor passed and nothing else. `authenticateRequest`
  refuses it, so it cannot reach any protected tRPC procedure.

Anything that lets a `pending_2fa` token act as a `full` one is an
authentication bypass.

### Sign-in methods

Three ways in — the Manus portal, email and password, and Google — and all
three finish in the same place, `server/session.ts`. The two-step verification
check lives there once, so a second factor cannot end up guarding some doors
and not others.

**Email and password.** scrypt at N=2^16, r=8 (~64MB per hash), parameters
stored alongside each hash so the cost can be raised later without forcing a
reset. Nothing in the flow reveals whether an address has an account: register,
sign in and forgot-password answer identically either way, and sign-in hashes
the supplied password against a decoy when there is no account, so the two
paths take about the same time. An address is not usable until its confirmation
link is clicked, which is what makes registering somebody else's address
pointless. Confirmation and reset tokens are 256-bit, single-use, expiring, and
stored only as SHA-256 — a leaked table is useless without the inbox. Setting a
password retires every other outstanding reset link for that account.

**Google.** OpenID Connect. The ID token's signature is verified against
Google's published keys, along with issuer, audience and expiry; the payload is
never merely decoded. `state` ties the callback to the browser that began it,
PKCE (S256) ties the code to this server, and a `nonce` ties the ID token to
the request. Accounts are matched on Google's `sub`, not on email — an address
can be reassigned, `sub` cannot. An address Google has not verified is refused
outright.

**Account linking.** A Google identity is attached to an existing account only
when that account's address was already verified. An address a local account
never proved belongs to whoever proves it first: that account is claimed and
its unproven password cleared in the same statement, so someone who registers
an address they do not own and never confirms it cannot keep a working password
on the account its real owner later uses.

### Two-step verification

TOTP per RFC 6238. The specifics that carry security weight:

- **Codes are single-use.** The accepted time step is recorded and anything at
  or below it is refused, so an intercepted code cannot be replayed for the rest
  of its window.
- **Comparisons are constant-time** (`crypto.timingSafeEqual`).
- **Shared secrets are encrypted at rest** with AES-256-GCM under a key derived
  from `JWT_SECRET` via HKDF, so a database dump is not a set of working second
  factors.
- **Recovery codes are stored as HMAC-SHA-256 hashes**, single-use, and shown
  exactly once. A single hash is deliberate, not an oversight: these are
  high-entropy values nobody chooses or reuses, so there is no dictionary to run
  and stretching would buy nothing.
- **Disabling requires a current code.** Holding a session is not sufficient,
  because a session is exactly what an attacker past the first factor would have.
- **Enrolment is two steps.** A stored secret does nothing until a code confirms
  it reached a device.

### Server-side data

Every note query filters by `userId`. S3 backup keys are namespaced per user and
the key builder rejects ids containing `/` or `..`. Crossing either boundary —
reading or writing another user's data — is a serious finding.

### Demo sessions

Signed-out visitors get 30 minutes. When `DEMO_LIMIT_SALT` is set, the deadline
is also recorded server-side against an HMAC of the visitor's IP address and
coarse browser family. **The address itself is never stored**, and records are
deleted 24 hours after the demo ends.

## Known limitations

These are understood and accepted. Reporting them is not necessary, though
reporting a way to make one materially worse is.

- **The demo limit is a deterrent, not enforcement.** People behind one NAT
  share an address, so one visitor's demo can consume another's; a device
  changing networks gets a fresh one.
- **Rate limiting is per process.** Two-step verification allows five wrong
  codes per fifteen minutes, counted in memory. Behind a load balancer each
  instance keeps its own tally, so the effective limit multiplies by the
  instance count. Single-instance deployments are unaffected; a horizontally
  scaled one needs a shared store.
- **Rotating `JWT_SECRET` invalidates every session and every two-step
  enrolment.** It signs cookies *and* derives the key encrypting TOTP secrets.
  This is a deployment consideration, not a defect.
- **Losing both the authenticator and the recovery codes loses the account.**
  There is no side channel to reset them, by design.
- **Anything prefixed `VITE_` is compiled into the client bundle** and is
  public. No privileged key is passed that way: the AI assistant, voice
  transcription and template drafting all call the provider from the server
  using `BUILT_IN_FORGE_API_KEY`. Keep it that way — a `VITE_` variable is
  substituted at build time and ends up readable in `dist/public/assets`.
- **Locally stored notes are only as safe as the device.** The encryption key
  lives in browser storage; it protects data at rest on the server, not against
  someone with the unlocked machine.

- **Signing out does not invalidate sessions elsewhere.** Sessions are stateless
  JWTs, so a password reset ends outstanding *reset links* but not sessions
  already issued on other devices. Rotating `JWT_SECRET` is the blunt instrument
  that does; a session store is what would do it properly.
- **Passwords are not checked against breach corpora.** Length is enforced,
  reuse of a known-breached password is not detected. Adding a k-anonymity
  lookup against Have I Been Pwned would close this and costs one outbound
  request at registration.
- **Rate limits are per process.** Same caveat as everywhere else in this app:
  behind a load balancer each instance keeps its own tally.

## Out of scope

- Vulnerabilities in third-party dependencies with no exploitable path in this
  application. Dependency advisories are handled by the security workflow and
  Dependabot; report those only if you can show a concrete exploit here.
- Missing hardening that is not itself exploitable (absent headers, verbose
  error text, and similar) unless you can demonstrate impact.
- Findings that require an already-compromised device, or physical access to an
  unlocked one.
- Denial of service and resource exhaustion.
- Social engineering.

## How changes are checked

Every pull request runs `.github/workflows/security.yml`:

- **`pnpm audit`** — a critical or high advisory fails the run. Moderate and low
  are reported but do not block, so a transitive advisory in an unrelated
  package cannot wedge every open PR. The full report is always printed.
- **Dependency review** — blocks a pull request that introduces a dependency
  with a known high-severity advisory.

CodeQL runs too, but from GitHub's **default setup** rather than from this
workflow — the two cannot coexist, and default setup was already enabled here.
Its check appears on every pull request as `Analyze (javascript-typescript)`.

`.github/workflows/ci.yml` runs the type-check, the test suite, and a production
build on the same events. Both must pass before merge.

A weekly scheduled audit catches advisories published after a branch merges,
since nothing would otherwise re-check quiet code.
