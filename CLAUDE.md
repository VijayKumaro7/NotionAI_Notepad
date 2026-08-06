# CLAUDE.md — NotionAI Notepad

This file provides guidance for Claude Code when working on this repository.

---

## Project Overview

NotionAI Notepad is a full-stack, local-first note-taking web application inspired by Notion. It features client-side AES-GCM encryption, AI-powered writing assistance, real-time collaboration over WebSockets, and server-side note persistence via tRPC + Drizzle ORM.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite 7 |
| UI | shadcn/ui, Tailwind CSS v4, Radix UI |
| Routing | Wouter |
| Backend | Node.js, Express, tRPC v11 |
| Database ORM | Drizzle ORM (MySQL) |
| Real-Time | WebSockets (native) |
| State / Data | TanStack Query v5 |
| Package Manager | pnpm |
| Testing | Vitest |
| Formatting | Prettier |

---

## Repository Structure

```
NotionAI_Notepad/
├── client/src/
│   ├── _core/           # Auth hook (useAuth)
│   ├── components/      # All UI components
│   │   └── ui/          # shadcn/ui primitives
│   ├── contexts/        # React contexts (theme, etc.)
│   ├── hooks/           # Custom hooks (useCollaboration, useKeyboardShortcuts, …)
│   ├── lib/             # Utilities: storage, encryption, collaboration, shortcuts, exports
│   ├── pages/           # Top-level pages (NotesApp, Landing, …)
│   └── main.tsx         # React entry point
├── server/
│   ├── _core/           # Express server, tRPC context, OAuth, LLM, voice, env
│   ├── db.ts            # Drizzle DB connection + CRUD queries
│   ├── routers.ts       # tRPC routers (notes, system, …)
│   └── storage.ts       # File/S3 storage helpers
├── shared/
│   ├── types.ts         # Shared TypeScript types
│   └── _core/           # Shared core types
├── drizzle/
│   ├── schema.ts        # DB schema (users, notes, …)
│   └── relations.ts     # Drizzle relation definitions
├── drizzle.config.ts
├── vite.config.ts
├── vitest.config.ts
└── package.json
```

---

## Common Commands

```bash
# Install dependencies
pnpm install

# Start dev server (client + server with hot reload)
pnpm dev

# Type-check (no emit)
pnpm check

# Run all tests
pnpm test

# Format code
pnpm format

# Build for production
pnpm build

# Start production server
pnpm start

# Push DB schema + run migrations
pnpm db:push
```

---

## Development Guidelines

### General
- **TypeScript everywhere** — no `any` without a comment explaining why.
- **Keep it simple** — avoid over-engineering. Three similar lines > a premature abstraction.
- Do not add comments unless the logic is genuinely non-obvious.
- Do not add error handling for impossible states — trust TypeScript and tRPC.

### Frontend
- Components live in `client/src/components/`. UI primitives (shadcn/ui) live in `components/ui/`.
- `components/ui/` holds **only the primitives the app imports**. The unused rest of the shadcn set was removed; add one back with `npx shadcn@latest add <name>` when a component genuinely needs it, rather than keeping the whole catalogue on hand.
- Use `TanStack Query` for server state; local ephemeral state with `useState`/`useReducer`.
- Routing is handled by **Wouter** (not React Router).
- Theme tokens are Tailwind CSS v4 variables — do not hardcode colours.
- Animations use Tailwind `animate-*` utilities and `tw-animate-css`.

### Backend
- All API endpoints are **tRPC procedures** defined in `server/routers.ts`.
- DB queries live in `server/db.ts`. Add new query functions there; keep routers thin.
- Authentication context is available via `ctx.user` inside tRPC procedures.
- Notes are **ownership-guarded**: always filter by `userId` in queries.
- Soft-delete is supported — check `deletedAt` before returning notes.

### Database
- Schema is in `drizzle/schema.ts`. Relations in `drizzle/relations.ts`.
- After changing the schema run `pnpm db:push` to generate and apply migrations.
- Use `drizzle-kit generate` + `drizzle-kit migrate` for production migrations.

### Real-Time Collaboration
- WebSocket logic is in `client/src/lib/collaborationClient.ts`.
- Operational transformation helpers are in `client/src/lib/collaboration.ts`.
- The custom hook `useCollaboration` wraps the client for React components.

### Encryption
- Client-side AES-GCM encryption is implemented in `client/src/lib/` storage utilities.
- The server **never** receives plaintext note content for locally stored notes.

### Testing
- Tests are co-located with the source file they test (e.g. `shortcuts.test.ts` next to `shortcuts.ts`).
- Run `pnpm test` before committing. All tests must pass.
- Use **Vitest** (`describe`/`it`/`expect`) — no Jest.

### Environment Variables
Create a `.env` file at the repo root (see `.env.example`):

```env
# AI provider (choose one)
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...

# MySQL database
DATABASE_URL=mysql://user:password@host:3306/dbname

# Server
PORT=5000
NODE_ENV=development
```

---

## Key Features Reference

| Feature | Key Files |
|---|---|
| Rich-text editor | `components/RichTextEditor.tsx` |
| AI chat assistant | `components/AIChatBox.tsx`, `components/AIAssistant.tsx` |
| Sidebar / folders | `components/Sidebar.tsx` |
| Version history | `components/VersionHistory.tsx` |
| Collaborative sharing | `components/ShareModal.tsx` |
| Real-time collaboration | `lib/collaboration.ts`, `lib/collaborationClient.ts`, `hooks/useCollaboration.ts` |
| Live cursors | `components/LiveCursors.tsx` |
| Presence indicators | `components/PresenceIndicators.tsx` |
| Keyboard shortcuts | `lib/shortcuts.ts`, `components/ShortcutsModal.tsx`, `hooks/useKeyboardShortcuts.ts` |
| Template selection | `components/TemplateSelector.tsx` |
| Recently deleted | `components/RecentlyDeleted.tsx` |
| Voice memos | `components/VoiceMemo.tsx` |
| Server-side notes | `server/db.ts`, `server/routers.ts`, `drizzle/schema.ts` |
| tRPC setup | `server/_core/trpc.ts` |
| Login page | `pages/Login.tsx` |
| Two-step verification | `server/totp.ts`, `server/twoFactor.ts`, `server/rateLimit.ts`, `components/TwoFactorSettings.tsx` |
| Session scopes | `server/_core/sdk.ts` (`full` vs `pending_2fa`) |
