# 📝 NotionAI Notepad

> A Notion-inspired web application with local-first encrypted storage and AI agent capabilities for automated note-taking, content generation, and intelligent assistance.

![TypeScript](https://img.shields.io/badge/TypeScript-93.5%25-3178C6?style=flat-square&logo=typescript)
![JavaScript](https://img.shields.io/badge/JavaScript-4.7%25-F7DF1E?style=flat-square&logo=javascript)
![CSS](https://img.shields.io/badge/CSS-1.6%25-1572B6?style=flat-square&logo=css3)
![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)

---

## ✨ Features

- **Notion-like Editor** — Clean, minimal block-based document editor inspired by Notion's UI/UX
- **Local-First Architecture** — All notes are stored and encrypted locally in the browser; your data never leaves your device by default
- **Encrypted Storage** — Notes are encrypted client-side before being persisted, ensuring privacy and security
- **AI Agent Integration** — Integrated AI capabilities for automated note-taking, content generation, and intelligent writing assistance
- **Multi-model LLM Support** — AI assistance powered by a configurable backend supporting multiple LLM providers
- **Full-Stack TypeScript** — Shared types across client and server for a type-safe, end-to-end development experience
- **Database Persistence** — Server-side notes with Drizzle ORM, ownership-guarded CRUD, and soft-delete support via tRPC
- **Real-Time Collaboration** — Live cursors, presence indicators, and operational-transform conflict resolution over WebSockets
- **Keyboard Shortcuts** — 20+ shortcuts across 5 categories (Navigation, Editing, Formatting, General, Search) with a searchable help modal (`Cmd+?`)
- **Version History** — View, compare, and restore previous versions of any note
- **Collaborative Sharing** — Share notes with configurable permission levels and inline commenting
- **Recently Deleted** — Recover deleted notes within 30 days from a dedicated trash view
- **Template Library** — 5 built-in templates (Project Plan, Meeting Notes, Daily Journal, Research Notes, Blank Note) with search and preview
- **Drag-and-Drop Reordering** — Reorder notes and folders with native HTML5 drag-and-drop and visual drop indicators
- **Dark Mode** — Persistent dark/light theme toggle stored in localStorage
- **Voice Memos** — Record audio memos with automatic transcription

---

## 🏗️ Project Structure

```
NotionAI_Notepad/
├── client/          # React frontend (Vite + TypeScript)
│   └── src/
│       ├── components/   # UI components (editor, sidebar, modals, …)
│       ├── hooks/        # Custom React hooks
│       ├── lib/          # Utilities, collaboration, shortcuts, storage
│       └── pages/        # Top-level page components
├── server/          # Express/Node.js + tRPC backend (TypeScript)
├── shared/          # Shared types and schemas (client + server)
├── drizzle/         # Drizzle ORM migrations and schema
├── patches/         # Dependency patches
├── drizzle.config.ts
├── vite.config.ts
├── vitest.config.ts
├── components.json  # shadcn/ui component config
├── tsconfig.json
└── package.json
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React, TypeScript, Vite |
| **UI Components** | shadcn/ui, Tailwind CSS |
| **Backend** | Node.js, Express, tRPC, TypeScript |
| **Database ORM** | Drizzle ORM |
| **Real-Time** | WebSockets (collaboration) |
| **AI Integration** | LLM API (multi-provider) |
| **Package Manager** | pnpm |
| **Testing** | Vitest |
| **Code Formatting** | Prettier |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** v18+
- **pnpm** v8+

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/VijayKumaro7/NotionAI_Notepad.git
cd NotionAI_Notepad

# 2. Install dependencies
pnpm install

# 3. Set up environment variables
cp .env.example .env
# Edit .env with your API keys and database config
```

### Running the App

```bash
# Development mode (client + server concurrently)
pnpm dev

# Build for production
pnpm build

# Start production server
pnpm start
```

### Running Tests

```bash
pnpm test

# Watch mode
pnpm test:watch
```

### Database Migrations (Drizzle)

```bash
# Generate migrations
pnpm db:generate

# Push schema to database
pnpm db:push
```

---

## 🤖 AI Capabilities

NotionAI Notepad ships with an intelligent AI agent layer that can:

- **Auto-generate content** — Write drafts, summaries, or expand bullet points into full paragraphs
- **Smart note-taking** — Capture and structure information from prompts automatically
- **Content rewriting** — Improve clarity, tone, and structure of existing notes
- **Q&A over notes** — Ask questions about your stored notes and receive contextual answers

The AI backend is configurable — you can connect it to OpenAI, Anthropic, or any compatible LLM provider via environment variables.

---

## 🤝 Real-Time Collaboration

Notes can be shared and co-edited in real time:

- **Live cursors** — See where collaborators are editing with color-coded cursor labels
- **Presence indicators** — Avatar row showing who is currently viewing or editing
- **Operational transformation** — Automatic conflict resolution for concurrent edits
- **Permission levels** — Share with view-only, comment, or full-edit access
- **Inline comments** — Threaded commenting on shared notes
- **Offline resilience** — Message queuing and exponential-backoff reconnection

---

## ⌨️ Keyboard Shortcuts

Open the shortcuts help modal with `Cmd+?` (Mac) / `Ctrl+?` (Windows/Linux).

| Shortcut | Action |
|---|---|
| `Cmd+N` | New note |
| `Cmd+F` | Focus search |
| `Cmd+S` | Save note |
| `Cmd+H` | Version history |
| `Cmd+Shift+S` | Share note |
| `Cmd+B / I / U` | Bold / Italic / Underline |
| `Cmd+?` | Open shortcuts help |

---

## 🔒 Privacy & Security

- Notes are **encrypted client-side** before storage — the server never sees raw content
- **Local-first design** — works fully offline; server sync is optional
- Server-side notes are **ownership-guarded** — users can only access their own data
- No third-party analytics or tracking

---

## 📁 Environment Variables

Create a `.env` file in the root directory:

```env
# AI Provider
OPENAI_API_KEY=your_openai_api_key
# or
ANTHROPIC_API_KEY=your_anthropic_api_key

# Database (optional, for server-side persistence)
DATABASE_URL=your_database_url

# Server
PORT=5000
NODE_ENV=development
```

---

## 📦 Scripts Reference

| Command | Description |
|---|---|
| `pnpm dev` | Start development server |
| `pnpm build` | Build for production |
| `pnpm start` | Run production build |
| `pnpm test` | Run test suite |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm db:push` | Push Drizzle schema to DB |
| `pnpm db:generate` | Generate DB migrations |
| `pnpm format` | Format code with Prettier |

---

## 🤝 Contributing

Contributions are welcome! Please feel free to open an issue or submit a pull request.

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m 'feat: add your feature'`
4. Push to the branch: `git push origin feature/your-feature`
5. Open a Pull Request

---

## 👨‍💻 Author

**Vijay Kumar**
- GitHub: [@VijayKumaro7](https://github.com/VijayKumaro7)

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

---

> Built with ❤️ and powered by AI
