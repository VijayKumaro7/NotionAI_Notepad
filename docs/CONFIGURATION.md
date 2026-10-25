# Configuration

Everything the app needs is read from the environment. In development that is a
`.env` file at the repository root (git-ignored; there is no checked-in template
on purpose). In production it is your host's secret store. `render.yaml`
enumerates every variable a deployment declares, and `server/renderBlueprint.test.ts`
fails if the server reads one the Blueprint does not.

This page lists names and purposes only. Never commit a value, and never put a
secret in a `VITE_`-prefixed variable: those are compiled into the client bundle
and are public.

---

## What works with nothing set

Notes work with no database and no variables at all: they are encrypted and
stored in the browser. Each feature below needs its own variables and reports
itself **unavailable** when they are missing, rather than half-working.

| Feature                           | Needs                                                           |
| --------------------------------- | --------------------------------------------------------------- |
| Server-side notes, sync, sharing  | `DATABASE_URL`, `JWT_SECRET`, `VITE_APP_ID`                     |
| Portal sign-in                    | `OAUTH_SERVER_URL`, `VITE_OAUTH_PORTAL_URL`, `VITE_APP_ID`      |
| Google sign-in                    | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PUBLIC_ORIGIN`     |
| Email sign-up and password reset  | `EMAIL_API_URL`, `EMAIL_API_KEY`, `EMAIL_FROM`, `PUBLIC_ORIGIN` |
| Robot check (reCAPTCHA)           | `RECAPTCHA_SITE_KEY`, `RECAPTCHA_SECRET_KEY`                    |
| AI assistant, chat, voice, drafts | `BUILT_IN_FORGE_API_KEY`                                        |
| Two-step verification             | Database and `JWT_SECRET`                                       |
| Encrypted cloud backup            | `S3_BUCKET`                                                     |
| Server-side demo limit            | `DEMO_LIMIT_SALT` and a database                                |

---

## Core

| Variable             | Purpose                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`       | MySQL connection string (`mysql://…`, with a database name). Checked for shape only, not reachability                                                                          |
| `JWT_SECRET`         | Signs session cookies **and** derives the key that encrypts two-step secrets. Keep it stable; rotating it signs everyone out and invalidates every authenticator enrolment     |
| `PORT`               | Port to bind. Plain digits, 1–65535. Unset means 3000. Render sets it for you                                                                                                  |
| `NODE_ENV`           | Must be exactly `production` or `development`. Anything else gets the relaxed behaviour and a startup warning                                                                  |
| `PUBLIC_ORIGIN`      | Absolute origin the app is served from (scheme, host, port only). Google redirect URIs and email links are built from it. On Render it falls back to `RENDER_EXTERNAL_URL`     |
| `TRUSTED_PROXY_HOPS` | Number of reverse proxies in front (default 1 in production, 0 otherwise; a CDN in front of nginx makes it 2). Decides which `X-Forwarded-For` entry rate limits count against |
| `OWNER_OPEN_ID`      | The `openId` granted owner privileges                                                                                                                                          |

### Startup checks

The server stops at boot, and says which, when:

- `DATABASE_URL` is set but `JWT_SECRET` or `VITE_APP_ID` is missing.
- `DATABASE_URL` cannot work (not a URL, not `mysql:`, no database name).
- `PORT` is anything other than plain digits naming a valid port.

Smaller problems are **warnings** that never print the value: a `JWT_SECRET`
under 32 characters or plainly guessable, a `NODE_ENV` that is not exactly
`production`/`development`, a malformed `PUBLIC_ORIGIN`, a `TRUSTED_PROXY_HOPS`
that reads differently from how it looks or exceeds 3, and the per-feature
checks below. With no database nobody can sign in, so a build with none of the
three required variables still starts.

---

## Sign-in

| Variable                | Purpose                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `OAUTH_SERVER_URL`      | Base URL for portal sign-in's token exchange and user info, called server-side. Must be an absolute `http(s)` URL with no credentials |
| `VITE_OAUTH_PORTAL_URL` | Where the browser is sent to sign in. **Build-time**                                                                                  |
| `VITE_APP_ID`           | Opaque app id from the sign-in portal. **Build-time**, and also read by the server                                                    |
| `GOOGLE_CLIENT_ID`      | Web client ID, ending `.apps.googleusercontent.com`. Compared exactly with the token's audience                                       |
| `GOOGLE_CLIENT_SECRET`  | Used only in the final code exchange, so a wrong one fails every sign-in at the last step                                             |

Google sign-in is on only when the ID, the secret and `PUBLIC_ORIGIN` are all
set. Register this exact redirect URI with Google:

```
<PUBLIC_ORIGIN>/api/auth/google/callback
```

Also register `<your-domain>/api/oauth/callback` with your OAuth portal;
sign-in fails until that origin is allowed.

`VITE_*` values are baked into the client at build time, so changing one needs a
rebuild, not a restart. If the two portal values are missing, the client logs a
warning and the Sign In button goes nowhere.

---

## Email

Email is on only when `EMAIL_API_URL`, `EMAIL_API_KEY` and `EMAIL_FROM` are all
set. Any JSON email API taking `{from, to, subject, text}` works.

| Variable        | Purpose                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------- |
| `EMAIL_API_URL` | Full `https://` URL of the send endpoint. No credentials in it                            |
| `EMAIL_API_KEY` | Sent as `Authorization: Bearer <key>`. Put the bare key here, without `Bearer ` or quotes |
| `EMAIL_FROM`    | One mailbox: `address` or `Name <address>`                                                |

Failures are quiet by nature: a password-reset send is not awaited and a failure
is only logged, and a registration creates the account before it sends. The
server warns at startup about a partial set, a URL `fetch` would reject, an
`http://` URL to a real host (the key would travel in clear text), a bare origin
with no path, a key with a newline or other invalid character, a sender at a
reserved domain, and email configured without `PUBLIC_ORIGIN`. Whether the
sender is verified is only the provider's to say.

---

## Robot check (reCAPTCHA)

| Variable               | Purpose                                                           |
| ---------------------- | ----------------------------------------------------------------- |
| `RECAPTCHA_SITE_KEY`   | Public; served to the browser at runtime (not a `VITE_` variable) |
| `RECAPTCHA_SECRET_KEY` | Verified server-side                                              |

Both are needed. With only one set the check is **silently off**; with a secret
Google rejects it **fails closed**, refusing every email sign-in, and the reason
(`invalid-input-secret`) is only in the server log. The server warns about
either, about whitespace or quotes in the secret, and about Google's published
test secret, which passes every check and protects nothing. Rotating these needs
a restart, not a rebuild.

---

## AI provider

All AI calls happen on the server, behind authentication and a rate limit. The
browser names an operation; it never sends prompts or holds a provider key.

| Variable                             | Purpose                                              |
| ------------------------------------ | ---------------------------------------------------- |
| `BUILT_IN_FORGE_API_KEY`             | The only required one                                |
| `BUILT_IN_FORGE_API_URL`             | Provider endpoint. Defaults to the built-in provider |
| `BUILT_IN_FORGE_MODEL`               | Model for the assistant and chat                     |
| `BUILT_IN_FORGE_TRANSCRIPTION_MODEL` | Model for voice transcription                        |

Set the URL and both model names together when pointing at a different
provider. Defaults live in `server/_core/forge.ts`.

The URL is a base address: the server appends `v1/chat/completions` and
`v1/audio/transcriptions` itself, so give it without a version path, query,
fragment or credentials. A value that is not an absolute `http(s)` URL, has any
of those, or is `http://` to a real host is warned about at startup; unset is
fine.

---

## Cloud backup (S3)

| Variable      | Purpose                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------- |
| `S3_BUCKET`   | Bucket name alone (not `s3://name`, a URL, a path or an ARN). Backup is on exactly when this is set |
| `S3_REGION`   | No whitespace or URL. Unset means `us-east-1`, which is only right if the bucket is there           |
| `S3_ENDPOINT` | Absolute `http(s)` URL, for S3-compatible stores. A bare `host:port` is rejected                    |

Credentials come from the AWS SDK's own chain (environment, profile, role), so
their absence is not warned about. Two things are: `AWS_ACCESS_KEY_ID` with
whitespace or quotes in it or in `AWS_SECRET_ACCESS_KEY`, or only one of the two set, a mangled `AWS_SESSION_TOKEN`, a token with no pair, or a temporary (`ASIA`) key with no token,
and `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`, which nothing reads. A region or
endpoint set with no bucket is warned about, because backup then silently stays
off.

---

## Demo sessions

Signed-out visitors who pick a template get 30 minutes in the workspace. The
deadline is held in the browser. Setting `DEMO_LIMIT_SALT` also records it
server-side against an HMAC of the visitor's IP address and coarse browser
family. The address itself is never stored, and records are deleted 24 hours
after the demo ends.

The promise holds only while the salt cannot be guessed: with a guessable salt,
anyone who can read the `demoSessions` table can recover addresses in hours. The
server warns if it is under 32 characters, plainly guessable, or set with no
database. Unset it to keep the limit browser-only and record nothing. Changing it
only makes the server forget recorded deadlines.

---

## Deploying

On Render, `render.yaml` is a Blueprint: `JWT_SECRET` and `DEMO_LIMIT_SALT` are
generated, and everything marked `sync: false` is prompted for. Render's managed
database is PostgreSQL and this app uses MySQL, so provision MySQL elsewhere and
give Render the connection string. Run the schema once:

```bash
DATABASE_URL="<your connection string>" pnpm db:push
```

Set every `VITE_*` variable before the first build. Netlify, or any static host,
serves the client only: `/api/*` returns 404 and the login page offers
local-only mode instead.
