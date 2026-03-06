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
- **Database Persistence (Optional)** — Drizzle ORM integration for server-side persistence when needed

---

## 🏗️ Project Structure

```
NotionAI_Notepad/
├── client/          # React frontend (Vite + TypeScript)
├── server/          # Express/Node.js backend (TypeScript)
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
| **Backend** | Node.js, Express, TypeScript |
| **Database ORM** | Drizzle ORM |
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

## 🔒 Privacy & Security

- Notes are **encrypted client-side** before storage — the server never sees raw content
- **Local-first design** — works fully offline; server sync is optional
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

## 🧪 Testing

This project uses **Vitest** for unit and integration testing.

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch
```

---

## 📦 Scripts Reference

| Command | Description |
|---|---|
| `pnpm dev` | Start development server |
| `pnpm build` | Build for production |
| `pnpm start` | Run production build |
| `pnpm test` | Run test suite |
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
