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

### Chat transcripts

The chat assistant is the one place where text the server can read is stored on
purpose, and it is worth stating next to the paragraph above rather than buried.

Anything typed into the chat box leaves the device in clear text, as does the
note excerpt attached when "Use this note as context" is ticked — a hosted model
cannot answer ciphertext. With **"Save this chat"** on, the exchange is also
kept: `chatConversations` and `chatMessages` hold it in clear text, readable by
whoever runs the database. Rows are filtered by `userId` like every other query,
so this is not a way to read someone else's conversation — it is a record the
operator can read, which notes deliberately are not.

Turning the switch off stores nothing at all: no conversation row, no messages,
and the reply comes back with no conversation id. Deleting a saved conversation
removes its rows outright; there is no soft-delete holding pen for chats.

### Sessions

Session state is a signed JWT (HS256, `jose`) in an `HttpOnly`, `SameSite=Lax`
cookie, marked `Secure` over https. `JWT_SECRET` signs it.

The token carries a `scope` claim with two values:

- `full` — an ordinary signed-in session.
- `pending_2fa` — the first factor passed and nothing else. `authenticateRequest`
  refuses it, so it cannot reach any protected tRPC procedure.

Anything that lets a `pending_2fa` token act as a `full` one is an
authentication bypass.

The short-lived `google_oauth_flow` cookie, which carries an unspent OAuth
`state` and PKCE verifier between `/api/auth/google/start` and its callback,
gets the same treatment: `HttpOnly`, `SameSite=Lax`, ten minutes, cleared the
moment the callback resolves either way.

`Secure` is set on both whenever `NODE_ENV=production`, and otherwise follows
the request. Both halves are asserted in `server/googleRoutes.test.ts`: the
cookie carries `Secure` when the request arrived over https, and does not over
plain http. The second is not an oversight — a browser drops a `Secure` cookie
on plain http, so pinning the flag would break development on an ngrok tunnel
or a LAN address, and the flow would fail on a state mismatch that names no
cause. `http://localhost` is a secure context and unaffected either way.

Static analysis has repeatedly reported the flow cookie as a clear-text
transmission, because the flag reached the call through a spread and the query
could not find it there at all. It is now written out explicitly at the call
site, which is what settled the same query's complaint about `HttpOnly`. If it
is still reported, the finding is a false positive on a property production
sets unconditionally, and the answer is to dismiss it — not to pin the flag.
Expect it to reappear under a new number whenever an edit moves that line, since
a relocated alert is filed as a new one.

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

**Rate limits on the way in.** Every public entry point is capped, including
Google's two redirect endpoints — `/start` mints three 32-byte secrets per call
and `/callback` makes an outbound token exchange, so both cost something to
whoever runs them. Thirty per address per fifteen minutes, matching password
sign-in. The address is read from the trusted end of `X-Forwarded-For` (see
"Client addresses"), so the key is not one a caller can rotate.

**Account linking.** A Google identity is attached to an existing account only
when that account's address was already verified. An address a local account
never proved belongs to whoever proves it first: that account is claimed and
its unproven password cleared in the same statement, so someone who registers
an address they do not own and never confirms it cannot keep a working password
on the account its real owner later uses.

### Robot checks

reCAPTCHA guards registration, password sign-in and the password-reset request
— the three public endpoints worth automating against. It is defence in depth
rather than the main defence: scrypt's cost and the rate limits are what make
guessing impractical, and this is what makes doing it at scale awkward.

The token from the browser is evidence of nothing until Google confirms it, so
it is always checked server-side, and three things are checked rather than one:
that Google reports success, that the token came from this app's own hostname
(Google enforces that itself unless domain verification is switched off in the
console, and if it is off nothing else notices), and — for a v3 key — that the
score clears a threshold.

**It fails closed.** If Google cannot be reached, sign-in is refused rather than
allowed. Letting people through would make the check switchable off by anyone
able to interfere with this server's outbound traffic, and an outage is loud,
visible and temporary where a silent bypass is none of those.

Google's own error codes stay in the log. Several of them (`invalid-input-secret`
among others) describe our misconfiguration rather than the visitor's answer.

Not applied to the Google sign-in redirect, which is a navigation with nowhere
to carry a token and which Google already screens, nor to confirmation and reset
links, which already carry a 256-bit single-use token.

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
- **Codes are HMAC-SHA-1, deliberately.** RFC 4226 defines HOTP that way and
  authenticator apps assume it, so anything else would produce codes no enrolled
  device could generate. SHA-1's broken property is collision resistance, which
  HOTP does not rely on — this is a MAC over an eight-byte counter under a
  160-bit secret. Static analysis flags the string `sha1` here; the reasoning is
  recorded next to the call in `server/totp.ts`. Everything else in this app
  that hashes uses SHA-256.

### Server-side data

Every note query filters by `userId`. S3 backup keys are namespaced per user and
the key builder rejects ids containing `/` or `..`. Crossing either boundary —
reading or writing another user's data — is a serious finding.

### Client addresses

Several limits are keyed on the caller's address: sign-in and registration
attempts per origin, and the demo deadline. `X-Forwarded-For` is appended
left to right, so only its right-hand end is written by infrastructure in front
of this server — everything to the left is text the caller chose. The address is
read `TRUSTED_PROXY_HOPS` entries from the _end_ of that list, defaulting to one
hop in production (what the Render deployment has) and none in development.

Set it to match the deployment. Too high and every visitor collapses into one
rate-limiting bucket; too low and a caller picks their own address, which makes
each of those limits count every attempt against a fresh bucket.

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
  enrolment.** It signs cookies _and_ derives the key encrypting TOTP secrets.
  This is a deployment consideration, not a defect.
- **Losing both the authenticator and the recovery codes loses the account.**
  There is no side channel to reset them, by design.
- **Anything prefixed `VITE_` is compiled into the client bundle** and is
  public. No privileged key is passed that way: the AI assistant, voice
  transcription and template drafting all call the provider from the server
  using `BUILT_IN_FORGE_API_KEY`. Keep it that way — a `VITE_` variable is
  substituted at build time and ends up readable in `dist/public/assets`.
- **A saved chat is readable by the operator.** Notes are encrypted and are
  not; chat transcripts are stored in clear text because the server rebuilds a
  conversation to send it to the model. The switch in the chat box is what
  turns storage off, and off means nothing is written.
- **Locally stored notes are only as safe as the device.** The encryption key
  lives in browser storage; it protects data at rest on the server, not against
  someone with the unlocked machine.

- **Signing out does not invalidate sessions elsewhere.** Sessions are stateless
  JWTs, so a password reset ends outstanding _reset links_ but not sessions
  already issued on other devices. Rotating `JWT_SECRET` is the blunt instrument
  that does; a session store is what would do it properly.
- **Passwords are not checked against breach corpora.** Length is enforced,
  reuse of a known-breached password is not detected. Adding a k-anonymity
  lookup against Have I Been Pwned would close this and costs one outbound
  request at registration.
- **A wrong-password flood can lock a named account out.** Sign-in is capped per
  address, so ten failures buy that account a fifteen-minute wait whoever caused
  them. That is the accepted side of the trade — the alternative, capping only
  by source address, leaves a single account open to a distributed guess.
- **Timing is equalised where it can be cheaply, not perfectly.** Registration
  hashes a password on both branches and reset sends its mail without blocking
  the reply, so neither answers "does this address exist" by how long it takes.
  A residual difference of one database round trip remains on the reset path.
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
