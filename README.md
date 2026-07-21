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

| Layer | Technology |
|---|---|
| **Frontend** | React 19, TypeScript, Vite 7 |
| **UI** | shadcn/ui, Tailwind CSS v4, Radix UI, Framer Motion |
| **Routing** | Wouter |
| **Server State** | TanStack Query v5 |
| **Backend** | Node.js, Express, tRPC v11, TypeScript |
| **Database** | Drizzle ORM (MySQL) |
| **Real-Time** | WebSockets (native) |
| **AI** | OpenAI / Anthropic (configurable) |
| **Testing** | Vitest |
| **Package Manager** | pnpm |

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

Create a `.env` file in the project root (see `.env.example`):

```env
# AI provider — choose one (or both)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# MySQL connection string (required for server-side note persistence)
DATABASE_URL=mysql://user:password@host:3306/notepad_ai

# Server
PORT=5000
NODE_ENV=development
```

The application runs fully without a database — notes fall back to local encrypted storage in the browser.

---

## Keyboard Shortcuts

Press `Cmd+?` (macOS) or `Ctrl+?` (Windows / Linux) to open the interactive shortcuts reference.

| Shortcut | Action |
|---|---|
| `Cmd + N` | New note |
| `Cmd + F` | Focus search |
| `Cmd + S` | Save note |
| `Cmd + H` | Version history |
| `Cmd + Shift + S` | Share note |
| `Cmd + B` / `I` / `U` | Bold / Italic / Underline |
| `Cmd + ?` | Open shortcuts help |

---

## Security

- All note content is **encrypted client-side** with AES-GCM before storage — no plaintext ever leaves the browser for locally stored notes
- Server-side notes are **ownership-guarded** at the query level — users can only read and modify their own data
- **Local-first by default** — the server is only involved when you choose to sync or collaborate
- No third-party analytics, telemetry, or tracking

---

## Scripts Reference

| Command | Description |
|---|---|
| `pnpm dev` | Start development server (client + server) |
| `pnpm build` | Build for production |
| `pnpm start` | Run production build |
| `pnpm check` | TypeScript type-check (no emit) |
| `pnpm test` | Run test suite |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm format` | Format all files with Prettier |
| `pnpm db:generate` | Generate Drizzle migration files |
| `pnpm db:push` | Apply schema to the database |

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
