<div align="center">

# Notepad AI

**A local-first, AI-powered note-taking application built for privacy, speed, and collaboration.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![tRPC](https://img.shields.io/badge/tRPC-v11-2596BE?style=flat-square&logo=trpc&logoColor=white)](https://trpc.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)

[Features](#features) · [Tech Stack](#tech-stack) · [Getting Started](#getting-started) · [Configuration](#configuration) · [Security](SECURITY.md) · [Contributing](#contributing)

</div>

---

## Overview

Notepad AI is a full-stack, Notion-inspired note-taking application that keeps your data private by design. Notes are encrypted client-side with AES-GCM before ever touching storage — the server never sees plaintext content. When you need to collaborate, real-time co-editing over WebSockets with operational-transform conflict resolution has you covered.

---

## Features

### Core Editor

- **Rich-text block editor** — Notion-inspired writing experience with slash commands, formatting toolbar, and keyboard-driven flow
- **Template library** — Five built-in templates (Project Plan, Meeting Notes, Daily Journal, Research Notes, Blank) with live preview and custom naming
- **Version history** — Browse, diff, and restore any previous version of a note
- **Drag-and-drop reordering** — Reorder notes and folders with native HTML5 drag-and-drop

### Accounts & Security

- **Dedicated sign-in page** — `/login` fronts the OAuth flow and reports why a sign-in failed instead of dropping you back on the marketing page
- **Two-step verification** — Standard TOTP (RFC 6238) with a scannable QR code, so any authenticator app works; enforced server-side between the OAuth callback and the workspace
- **Single-use codes** — Each code is refused once it has been used, so one captured in flight cannot be replayed
- **Recovery codes** — Ten single-use codes, shown once and stored only as hashes
- **Rate-limited** — Five wrong codes buys a fifteen-minute lockout

### Privacy & Storage

- **Client-side AES-GCM encryption** — Notes are encrypted in the browser before being persisted; the server never receives raw content
- **Local-first architecture** — Fully functional offline; cloud sync is opt-in
- **Server-side persistence** — Optional database-backed storage via Drizzle ORM with ownership-guarded CRUD and soft-delete (30-day recovery window)
- **Recently deleted** — Restore soft-deleted notes from a dedicated trash view within 30 days

### AI Capabilities

- **Content generation** — Draft paragraphs, expand bullet points, and write summaries on demand
- **Smart rewriting** — Improve tone, clarity, and structure of existing content
- **Q&A over notes** — Ask questions about your notes and receive contextual answers
- **Multi-provider support** — Connect OpenAI, Anthropic, or any compatible LLM via environment variables

### Collaboration

- **Real-time co-editing** — Concurrent edits reconciled automatically with operational transformation
- **Live cursors** — Color-coded cursor labels show exactly where collaborators are typing
- **Presence indicators** — Avatar row displaying who is currently viewing or editing
- **Permission levels** — Share with view-only, comment, or full-edit access
- **Inline comments** — Threaded commenting anchored to specific content
- **Offline resilience** — Automatic reconnection with exponential backoff and message queuing

### Productivity

- **20+ keyboard shortcuts** — Across five categories: Navigation, Editing, Formatting, Search, and General
- **Voice memos** — Record audio directly in a note with automatic transcription
- **Dark / light mode** — Persistent theme preference stored in `localStorage`
- **Full-text search** — Instant search across all notes and folders

---

## Tech Stack

| Layer               | Technology                                          |
| ------------------- | --------------------------------------------------- |
| **Frontend**        | React 19, TypeScript, Vite 7                        |
| **UI**              | shadcn/ui, Tailwind CSS v4, Radix UI               |
| **Routing**         | Wouter                                              |
| **Server State**    | TanStack Query v5                                   |
| **Backend**         | Node.js, Express, tRPC v11, TypeScript              |
| **Database**        | Drizzle ORM (MySQL)                                 |
| **Real-Time**       | WebSockets (native)                                 |
| **AI**              | OpenAI / Anthropic (configurable)                   |
| **Testing**         | Vitest                                              |
| **Package Manager** | pnpm                                                |

---

## Project Structure

```
NotionAI_Notepad/
├── client/
│   └── src/
│       ├── _core/        # Auth hook (useAuth)
│       ├── components/   # UI components (editor, sidebar, modals, …)
│       │   └── ui/       # shadcn/ui primitives — only the ones the app imports
│       ├── contexts/     # React contexts (theme, …)
│       ├── hooks/        # useNotes, useCollaboration, useKeyboardShortcuts, …
│       ├── lib/          # storage + encryption, sync, collaboration, shortcuts
│       └── pages/        # NotesApp, Landing, Login, SharedNoteView
├── server/
│   ├── _core/            # Express, tRPC context, OAuth, sessions, LLM, env
│   ├── db.ts             # Drizzle connection + query functions
│   ├── routers.ts        # tRPC routers (auth, notes, demo, backups)
│   ├── totp.ts           # TOTP, recovery codes, secret encryption
│   ├── twoFactor.ts      # Two-step verification rules
│   ├── rateLimit.ts      # In-memory attempt limiter
│   ├── demoLimit.ts      # Hashed per-visitor demo tracking
│   └── storage.ts        # Encrypted S3 backups
├── shared/               # Shared TypeScript types (client + server)
├── drizzle/              # Schema, relations, and generated migrations
├── .github/workflows/    # CI and security checks
├── SECURITY.md           # Security policy and threat model
├── drizzle.config.ts
├── vite.config.ts
└── package.json
```

Where to start reading: `server/routers.ts` is the whole API surface in one
file and names every feature. Then `server/db.ts` for queries and
`server/_core/sdk.ts` for sessions. On the client, `App.tsx` → `pages/` →
`hooks/useNotes.ts` → `lib/storage.ts`.

---

## Getting Started

### Prerequisites

- **Node.js** 20.19+ or 22.12+ — Vite 7 declares
  `^20.19.0 || >=22.12.0` and refuses to run below it. CI uses Node 22.
- **pnpm 10** — the version is pinned in `package.json`'s `packageManager`
  field, so the reliable way to get the right one is `corepack enable` rather
  than a global install. The lockfile is v9 format and pnpm 8 cannot read it.

### Installation

```bash
# Clone the repository
git clone https://github.com/VijayKumaro7/NotionAI_Notepad.git
cd NotionAI_Notepad

# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env
# Edit .env with your API keys and database connection string
```

### Development

```bash
# Start client + server with hot reload
pnpm dev
```

Open [http://localhost:5000](http://localhost:5000) — that is the `PORT` in
`.env.example`, which the install step above copies. Without a `.env` the
server falls back to port 3000.

### Production Build

```bash
pnpm build    # Compile client and server
pnpm start    # Serve the production build
```

### Tests

```bash
pnpm test           # Run all tests once
pnpm test:watch     # Watch mode
pnpm smoke          # Boot the built server and check it serves (needs pnpm build first)
```

### Database

```bash
pnpm db:generate    # Generate Drizzle migration files
pnpm db:push        # Apply schema to the database
```

---

## Configuration

Copy `.env.example` to `.env` and fill it in — it documents every variable the
app reads:

```bash
cp .env.example .env
```

The essentials:

| Variable                               | Purpose                                                    |
| -------------------------------------- | ---------------------------------------------------------- |
| `DATABASE_URL`                         | MySQL connection string, for server-side notes and sharing |
| `JWT_SECRET`                           | Signs session cookies **and** derives the key that encrypts two-step secrets |
| `OAUTH_SERVER_URL`                     | Token exchange and user info, called server-side           |
| `VITE_OAUTH_PORTAL_URL`, `VITE_APP_ID` | Where the browser is sent to sign in                       |
| `PORT`, `NODE_ENV`                     | Server basics                                              |

Anything prefixed `VITE_` is **compiled into the client bundle at build time**,
not read at runtime. Changing one requires a rebuild. If the two OAuth `VITE_`
values are missing, the client logs a warning and the Sign In button goes
nowhere.

**Notes** work with no database at all — they fall back to local encrypted
storage in the browser, which is the local-first design. The features that do
need `DATABASE_URL` are the ones that have to remember something across devices:
server-side notes and sync, sharing, two-step verification, and the per-visitor
demo limit. Without it those report themselves unavailable rather than failing
at the point of use.

---

## Deployment

The app is a single Node process: `pnpm build` compiles the client to
`dist/public` and bundles the server to `dist/index.js`, and `pnpm start` serves
the API, the WebSocket collaboration endpoint, and the client bundle together.
Any host that runs Node works.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

On a managed host (Render, Railway, Fly, Cloud Run, a VM):

- **Build command** `pnpm install --frozen-lockfile && pnpm build`
- **Start command** `pnpm start`
- **Port** — the platform sets `PORT`; the server binds to exactly that and
  exits with an error if it is taken, rather than quietly moving to another port
  where health checks would never reach it.
- **Environment** — set every variable before the first build, because the
  `VITE_` ones are baked into the client bundle. Setting them afterwards needs a
  rebuild, not a restart.
- **Database** — provision MySQL and run `pnpm db:push` once against it.

### Render

`render.yaml` in the repo root is a Blueprint. In Render choose **New →
Blueprint**, point it at this repository, and it will prompt for every value the
file marks `sync: false`.

**The database is not in the blueprint, deliberately.** Render's managed
offering is PostgreSQL; this app is MySQL (`drizzle.config.ts` sets
`dialect: "mysql"`, the driver is `mysql2`). Provision MySQL elsewhere —
PlanetScale, Aiven, Railway, your own — and give Render the connection string as
`DATABASE_URL`.

Then, once:

```bash
DATABASE_URL="<your connection string>" pnpm db:push
```

Two things worth knowing:

- `JWT_SECRET` is set to `generateValue: true`, so Render creates one on the
  first deploy. Do not change it afterwards — it signs session cookies, and
  rotating it signs everyone out.
- The `VITE_` values are compiled into the client bundle at build time. Changing
  one requires a redeploy, not a restart.
- The free plan sleeps when idle, so the first request after a quiet period
  waits for a cold start.

Finally, register `https://<your-render-domain>/api/oauth/callback` with your
OAuth portal — `getLoginUrl()` derives the redirect URI from whatever origin is
serving the app, so sign-in fails until that origin is allowed.

### Demo sessions

Signed-out visitors who pick a template get 30 minutes in the workspace before
being asked to sign in. The deadline is held in the browser, so clearing site
data or opening a private window resets it.

Setting `DEMO_LIMIT_SALT` also records the deadline server-side against an HMAC
of the visitor's IP address and coarse browser family. **The address is never
stored** — only the hash, which cannot be reversed or matched without the salt —
and records are deleted 24 hours after the demo ends. The new `demoSessions`
table arrives with `pnpm db:push`.

This is a deterrent rather than enforcement, and it is worth being clear about
why. People behind one office or mobile-carrier NAT share an address, so one
visitor's demo can use up a colleague's. A phone moving between networks gets a
new address and so a new demo. It stops the limit being sidestepped by reflex —
a private window — and not much more. Leave the salt unset to keep the limit
browser-only and record nothing.

### A note on static hosts

`netlify.toml` in this repo builds and publishes `dist/public` only. That is a
**frontend-only** deploy: `/api/*` returns 404, so sign-in, server-side notes,
version history, and collaboration cannot work there — the app renders the
landing page for a signed-out visitor and nothing more.

To keep a static frontend, run the server somewhere as above and replace the
`/api/*` rule in `netlify.toml` with a proxy to it (there is a template in the
file). Otherwise serve the whole app from the Node host and retire the static
site. Note that a proxy still leaves WebSocket collaboration to be routed
separately.

---

## Keyboard Shortcuts

Press `Cmd+?` (macOS) or `Ctrl+?` (Windows / Linux) to open the interactive shortcuts reference.

| Shortcut              | Action                    |
| --------------------- | ------------------------- |
| `Cmd + N`             | New note                  |
| `Cmd + F`             | Focus search              |
| `Cmd + S`             | Save note                 |
| `Cmd + H`             | Version history           |
| `Cmd + Shift + S`     | Share note                |
| `Cmd + B` / `I` / `U` | Bold / Italic / Underline |
| `Cmd + ?`             | Open shortcuts help       |

---

## Security

- All note content is **encrypted client-side** with AES-GCM before storage — no plaintext ever leaves the browser for locally stored notes
- Server-side notes are **ownership-guarded** at the query level — users can only read and modify their own data
- **Local-first by default** — the server is only involved when you choose to sync or collaborate
- The session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` over https
- No third-party analytics, telemetry, or tracking

### Two-step verification

Turn it on from **Security** in the workspace header. It is standard TOTP —
SHA-1, six digits, thirty-second step — so Google Authenticator, 1Password,
Authy and anything else that reads a setup key will work. Enrolment shows a QR
code, with the setup key underneath it for anything that will not scan.

How it fits into sign-in: the OAuth portal vouches for who you are, and if the
account has a **confirmed** enrolment the callback issues a *pending* session
rather than a real one. That cookie cannot reach a single protected procedure,
so `/login` asks for the code before anything else happens.

Two things to know before deploying it:

- The `userTwoFactor` and `twoFactorRecoveryCodes` tables arrive with
  `pnpm db:push`. Until they exist the Security panel errors — this feature
  needs a database even though notes do not.
- Rotating `JWT_SECRET` invalidates every enrolment as well as every session,
  because it derives the key that encrypts the stored secrets.

**[`SECURITY.md`](SECURITY.md) is the source of truth** for the security model —
what is protected and how, the known limitations, and how to report a
vulnerability privately. It is deliberately not repeated here, so the two cannot
drift apart.

---

## Scripts Reference

| Command            | Description                                |
| ------------------ | ------------------------------------------ |
| `pnpm dev`         | Start development server (client + server) |
| `pnpm build`       | Build for production                       |
| `pnpm start`       | Run production build                       |
| `pnpm check`       | TypeScript type-check (no emit)            |
| `pnpm test`        | Run test suite                             |
| `pnpm test:watch`  | Run tests in watch mode                    |
| `pnpm smoke`       | Boot the built server and check it serves  |
| `pnpm format`      | Format all files with Prettier             |
| `pnpm db:generate` | Generate Drizzle migration files           |
| `pnpm db:push`     | Apply schema to the database               |

---

## Contributing

Contributions are welcome. Please follow these steps:

1. Fork the repository and create a feature branch: `git checkout -b feat/your-feature`
2. Make your changes, keeping commits focused and messages clear (`feat:`, `fix:`, `chore:`)
3. Run `pnpm check && pnpm test` and ensure everything passes
4. Open a pull request with a clear description of what changed and why

For significant changes, open an issue first to discuss the approach.

### What runs on every pull request

Two workflows gate the merge, and both have to pass:

| Workflow | Checks |
|---|---|
| `ci.yml` | `pnpm check`, `pnpm test`, `pnpm build`, `pnpm smoke` |
| `security.yml` | `pnpm audit`, dependency review |

`pnpm smoke` is the last step of `ci.yml` and the only one that runs the server.
It boots the production build, asks for a page, an asset and a path that should
not exist, and checks it gets a real answer to each. It is there because an
express 5 upgrade once passed the type-check, the whole test suite and the build
while being unable to start at all — everything short of running the process
said it was fine. See `scripts/smoke.sh`.

The audit fails the run on a **critical or high** advisory. Moderate and low are
printed but do not block — a moderate advisory deep in someone else's dependency
would otherwise wedge every open pull request until an upstream fix appeared,
and a gate that blocks work it cannot help with is one people learn to switch
off. A weekly scheduled run is what keeps moderates from piling up quietly.

Dependency review is stricter in the one place it can afford to be: it blocks a
pull request that *introduces* a vulnerable dependency, because that is a choice
the author can act on.

CodeQL also runs on every pull request, as `Analyze (javascript-typescript)`,
but from GitHub's **default setup** rather than from this repository's
workflows — the two configurations cannot coexist, and default setup was already
enabled.

You can run the whole gate locally before pushing:

```bash
pnpm install --frozen-lockfile
pnpm check && pnpm test && pnpm build && pnpm smoke
pnpm audit --audit-level high
```

The pull request template carries a short security checklist. It is there to be
read, not ticked — if a change touches user data, sessions, or anything holding
a secret, say in the PR how you know it is safe.

Security policy, the intended security model, and how to report a vulnerability
privately: [`SECURITY.md`](SECURITY.md).

---

## Author

**Vijay Kumar** — [@VijayKumaro7](https://github.com/VijayKumaro7)

---

## License

Released under the [MIT License](LICENSE).
