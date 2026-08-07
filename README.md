<div align="center">

# Notepad AI

**A local-first, AI-powered note-taking application built for privacy, speed, and collaboration.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![tRPC](https://img.shields.io/badge/tRPC-v11-2596BE?style=flat-square&logo=trpc&logoColor=white)](https://trpc.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)

[Features](#features) · [Tech Stack](#tech-stack) · [Getting Started](#getting-started) · [Configuration](#configuration) · [Contributing](#contributing)

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
│       │   └── ui/       # shadcn/ui primitives
│       ├── contexts/     # React contexts (theme, …)
│       ├── hooks/        # Custom hooks (useCollaboration, useKeyboardShortcuts, …)
│       ├── lib/          # Utilities: storage, encryption, collaboration, shortcuts
│       └── pages/        # Top-level pages (NotesApp, Landing, …)
├── server/
│   ├── _core/            # Express, tRPC context, OAuth, LLM, env
│   ├── db.ts             # Drizzle connection + CRUD query functions
│   └── routers.ts        # tRPC routers (notes, auth, system)
├── shared/               # Shared TypeScript types (client + server)
├── drizzle/              # Schema and relations
├── drizzle.config.ts
├── vite.config.ts
└── package.json
```

---

## Getting Started

### Prerequisites

- **Node.js** v18 or later
- **pnpm** v8 or later

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

Open [http://localhost:5000](http://localhost:5000) in your browser.

### Production Build

```bash
pnpm build    # Compile client and server
pnpm start    # Serve the production build
```

### Tests

```bash
pnpm test           # Run all tests once
pnpm test:watch     # Watch mode
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
| `JWT_SECRET`                           | Signs session cookies                                      |
| `OAUTH_SERVER_URL`                     | Token exchange and user info, called server-side           |
| `VITE_OAUTH_PORTAL_URL`, `VITE_APP_ID` | Where the browser is sent to sign in                       |
| `PORT`, `NODE_ENV`                     | Server basics                                              |

Anything prefixed `VITE_` is **compiled into the client bundle at build time**,
not read at runtime. Changing one requires a rebuild. If the two OAuth `VITE_`
values are missing, the client logs a warning and the Sign In button goes
nowhere.

The application runs fully without a database — notes fall back to local encrypted storage in the browser.

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
Authy and anything else that reads a setup key will work.

How it fits into sign-in:

1. The OAuth portal vouches for who you are and returns to `/api/oauth/callback`.
2. If the account has a **confirmed** enrolment, the callback issues a
   _pending_ session — a cookie whose scope claim says the first factor passed
   and nothing more. `authenticateRequest` refuses it, so it cannot reach a
   single protected procedure.
3. `/login` reads that cookie and asks for the code. A correct code replaces it
   with a real session.

The details that matter, and why:

- **Setup and enable are separate.** Scanning a key is not proof it reached a
  phone. Nothing is enforced until a code confirms it, so a QR code that failed
  to scan costs a retry rather than an account.
- **Codes are single-use.** The step a code was accepted at is recorded, and
  anything at or below it is refused — a code captured in flight is not usable
  for the rest of its window.
- **Turning it off needs a code.** A session on its own is exactly what an
  attacker past the first factor would hold.
- **Secrets are encrypted at rest** with a key derived from `JWT_SECRET`, so a
  database dump is not a set of working second factors. Rotating `JWT_SECRET`
  therefore invalidates every enrolment as well as every session.
- **Recovery codes** are ten single-use codes, stored as hashes and shown once.
  Losing both a phone and the codes means losing the account — there is no
  side channel to reset them.
- **Rate limiting is per process.** Five wrong codes locks the account out for
  fifteen minutes. Run several instances behind a load balancer and each keeps
  its own tally, so the effective limit multiplies by the instance count; use a
  shared store if you scale out.

Enrolment shows a QR code to scan. The setup key is shown underneath it
unconditionally rather than behind a "having trouble?" toggle — a camera that
will not focus is exactly the moment nobody should have to go hunting for the
alternative — along with an `otpauth://` link that opens an app directly on the
same device. The encoder is loaded on demand, so a panel opened once per
account does not weigh on every page load.

The `userTwoFactor` and `twoFactorRecoveryCodes` tables arrive with
`pnpm db:push`. Until they exist, the Security panel errors — the feature needs
a database even though the rest of the app does not.

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

---

## Author

**Vijay Kumar** — [@VijayKumaro7](https://github.com/VijayKumaro7)

---

## License

Released under the [MIT License](LICENSE).
