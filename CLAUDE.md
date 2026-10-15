# CLAUDE.md — NotionAI Notepad

This file provides guidance for Claude Code when working on this repository.

---

## Project Overview

NotionAI Notepad is a full-stack, local-first note-taking web application inspired by Notion. It features client-side AES-GCM encryption, AI-powered writing assistance, real-time collaboration over WebSockets, and server-side note persistence via tRPC + Drizzle ORM.

---

## Tech Stack

| Layer           | Technology                           |
| --------------- | ------------------------------------ |
| Frontend        | React 19, TypeScript, Vite 7         |
| UI              | shadcn/ui, Tailwind CSS v4, Radix UI |
| Routing         | Wouter                               |
| Backend         | Node.js, Express, tRPC v11           |
| Database ORM    | Drizzle ORM (MySQL)                  |
| Real-Time       | WebSockets (native)                  |
| State / Data    | TanStack Query v5                    |
| Package Manager | pnpm                                 |
| Testing         | Vitest                               |
| Formatting      | Prettier                             |

---

## Repository Structure

```
NotionAI_Notepad/
├── client/
│   ├── dev/             # Development-only tooling; never copied into a build
│   ├── public/          # Copied verbatim into dist/public — publish nothing else here
│   └── src/
│       ├── _core/       # Auth hook (useAuth)
│       ├── components/  # All UI components
│       │   └── ui/      # shadcn/ui primitives
│       ├── contexts/    # React contexts (theme, etc.)
│       ├── hooks/       # Custom hooks (useCollaboration, useKeyboardShortcuts, …)
│       ├── lib/         # Utilities: storage, encryption, collaboration, shortcuts, exports
│       ├── pages/       # Top-level pages (NotesApp, Landing, …)
│       └── main.tsx     # React entry point
├── server/
│   ├── _core/           # Express server, tRPC context, OAuth, LLM, voice, env
│   ├── db.ts            # Drizzle DB connection + CRUD queries
│   ├── routers.ts       # tRPC routers (notes, system, …)
│   └── storage.ts       # File/S3 storage helpers
├── shared/
│   ├── chat.ts          # Chat size limits, shared by the box and the procedure
│   ├── crdt.ts          # CRDT helpers for collaborative editing
│   ├── templates.ts     # Note templates + placeholder fill-in logic
│   └── _core/           # Shared core types
├── drizzle/
│   ├── schema.ts        # DB schema (users, notes, …)
│   └── relations.ts     # Drizzle relation definitions
├── deploy/nginx/        # Reverse-proxy config for self-hosting (not used on Render)
├── docs/                # Screenshots and the project TODO
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
- **Every rule in `index.css` belongs to a `@layer`.** An unlayered rule beats
  every utility whatever the specificity, so a class written outside a layer
  silently discards the `text-2xl` or `pl-10` someone writes at the call site —
  and the only way to notice is to measure the computed style. `.btn-notion*`,
  `.input-notion` and `.editor-*` all live in `@layer components`; keep them
  there and a call-site utility wins, which is what anyone would expect.
  `.container` sat outside every layer for a long time after that audit —
  missed because nothing writes `className="container"` anywhere, so it had
  no visible effect to catch the eye. It is in `@layer components` now, same
  as `.btn-notion*`; a new custom class belongs there too, on sight, not
  only once something using it demonstrates the bug.
- **A control is one thing, not two fighting.** These classes are complete
  components rendered on plain elements, not a look layered onto a shadcn
  primitive that already styles itself — that fight is what made the
  unlayered rules look necessary. Where a primitive has to stay (`Input`,
  `Textarea`, `SelectTrigger` carry IME and Radix behaviour), it takes
  `variant="notion"` and emits the class _instead of_ its own base, so the two
  never both apply.
- **A deployment with no API is a smaller app, not a broken one.** The static
  builds of this repo serve the client and answer `/api/*` with 404, and the
  login page used to report that and stop — every control on it goes through
  the server, so there was no way into a workspace that needs nothing from it.
  `lib/localMode.ts` is that way in: no deadline, unlike the demo, because a
  demo ends by asking you to sign in and there is nothing here to sign in to.
  Anything that offers "Sign in" to a signed-out visitor has to check first —
  `serverUnreachable` in `Login.tsx` and `NotesApp.tsx` — or it sends someone
  from a session that was working to a page explaining that it cannot work.

- A panel waiting on a cancellable request keeps its `AbortController` in
  `createInFlight()` (`lib/inFlight.ts`) rather than a bare ref. Stopping has to
  let go of the attempt as well as abort it — aborting does not recall a reply
  already on its way, and an attempt the panel still holds is one it will use
  when it lands.
- **A copy button goes through `copyToClipboard` (`lib/clipboard.ts`), never
  `navigator.clipboard.writeText` directly.** `writeText` is `undefined` on a
  non-secure origin and can reject even where it exists — no direct user
  gesture, a permission prompt dismissed, a document that lost focus. Two
  components discovered this independently and wrote their own try/catch;
  four others called it unguarded and told the user "Copied" whether or not it
  landed, which for a recovery phrase or a two-step recovery code is a lie
  about the one thing that cannot be shown again. The helper returns whether
  it actually worked; the caller decides its own wording and, on failure, says
  so rather than staying silent.
- **A `URL.createObjectURL` result is revoked wherever the thing it names is
  discarded, not just dereferenced.** `exportService.ts`'s `downloadBlob` and
  `TwoFactorSettings.tsx`'s recovery-code download both revoke immediately —
  the URL only exists to drive one `<a>` click. `VoiceMemo.tsx`'s did not:
  the URL backs the `<audio>` player and the download button, so it has to
  outlive the click, and `setAudioURL("")` on delete, on a successful
  transcription, and never on unmount looked like cleanup but only dropped
  the component's own reference — the browser kept the recording pinned in
  memory regardless. Revoked now at all three, via one `clearRecording` and
  an unmount effect reading a ref, since the state setter that clears
  `audioURL` cannot also be the thing revoking it without going stale.
  `handleDownload` was also building its own detached `<a>` from the persisted
  URL — the same no-op-on-some-browsers shape the comment in
  `TwoFactorSettings.tsx` already warns about — and now goes through
  `downloadBlob` instead of a second copy of that anchor dance.
- **`VoiceMemo.tsx` labels a recording by what `mediaRecorder.mimeType`
  actually reports, never by assuming `audio/webm`.** Chrome and Firefox do
  record webm, but Safari has no webm support and records `audio/mp4`
  instead; the Blob built in `onstop` and the extension `handleDownload`
  saves under both used to hardcode the former regardless, so a Safari
  recording played back, downloaded, and transcribed under a label that did
  not match its own bytes. `_core/voiceTranscription.ts`'s
  `getFileExtension` had `audio/mp4` mapped to `.m4a` all along — the server
  was ready before the client ever sent it the right thing.
- **"Clear the recording" has to name which one.** `handleTranscribe`'s
  success path used to call `clearRecording()` unconditionally, trusting that
  whatever is loaded when the request resolves is still the recording it
  transcribed. It can not be: Delete and Download sit beside the
  Transcribe/Stop-transcribing button rather than behind it, so a person can
  delete the recording a pending transcription is still working on and make
  a new one before the old reply lands — and that unconditional clear then
  revoked and discarded the _new_ recording in place of a transcription it
  had nothing to do with. `inFlight.owns(attempt)` does not catch this: it
  tells a superseded transcribe request from the current one, and nothing
  here superseded it, since the person didn't start a second transcription,
  they started a second recording. `handleTranscribe` now captures
  `audioURLRef.current` as `transcribingURL` before awaiting, and only clears
  if that identity still matches on the way out.
- **An unmount mid-recording has to stop the recording, not just the
  leftovers of a finished one.** The unmount effect's revoke only ever had a
  URL to act on once `onstop` had already run; if the panel unmounts while
  `isRecording` is still true — switching notes, signing out, before Stop was
  ever clicked — nothing had called `.stop()` on the `MediaRecorder`, so the
  mic stayed open and the one-second `setInterval` kept firing into an
  unmounted component indefinitely. The unmount cleanup now stops the
  recorder too, which is what releases the mic (via `onstop`'s own
  `track.stop()`), and clears the timer. Doing that on its own would recreate
  the first bug from the other side — `.stop()` is itself what triggers
  `onstop`, now firing after the component has already unmounted — so
  `onstop` checks an `isMountedRef` before creating a blob or calling
  `setAudioURL` at all, rather than creating a URL and hoping something is
  still there to revoke it.
- **`Sidebar.tsx`'s drag handlers call `dataTransfer.setData`, not only
  `effectAllowed`.** Firefox refuses to start an HTML5 drag at all without
  that call during `dragstart` — a spec requirement Chrome does not enforce,
  so a Chromium-only sandbox never surfaces it. `handleNoteDragStart` and
  `handleFolderDragStart` tracked the dragged item entirely through React
  state and never called it, which would make every drop handler in this
  file silently unreachable in Firefox. The value itself is never read back
  on drop — `draggedItem` state is what every handler actually uses — the
  call only has to happen for the drag to begin.
- **A shortcut's key label goes through `formatKeys` (`lib/shortcuts.ts`),
  never a literal string.** It reads `navigator.platform` so "Cmd" renders
  as `⌘` on a Mac and `Ctrl` everywhere else, and every row in
  `ShortcutsModal.tsx`'s shortcut list already went through it — except the
  footer's own tip, which hardcoded `Cmd+?` and showed a key a Windows or
  Linux keyboard does not have. Same class of bug as the drag-and-drop one
  above, just on the platform axis instead of the browser one: something
  elsewhere in the same file already did this correctly, and one spot
  didn't go through it.
- **A shortcut `lib/shortcuts.ts` declares and `ShortcutsModal` advertises
  has to actually run somewhere, not just format correctly.** The entire
  Formatting category — Bold, Italic, Underline, Code, Heading 1/2/3,
  Bullet List, Numbered List, Quote — was listed in the help dialog with a
  correct, platform-aware key combo next to each one, and none of them did
  anything: `useKeyboardShortcuts`'s global handler only lets
  `help`/`command-palette`/`open-search` fire while focus sits in an input
  or textarea, and `NotesApp.tsx` never wired handlers for the rest of the
  category regardless. The note body is a `<textarea>`
  (`RichTextEditor.tsx`), the one place typing focus actually lives, so it
  is the one place that can make the advertised keys real. Its toolbar
  already had the right action for each — `insertMarkdown`, on each
  button's `onClick` — so the fix is a `formattingActions` map, keyed by
  the same shortcut ids `lib/shortcuts.ts` defines, that both the toolbar
  buttons and a new `onKeyDown` on the textarea read from, rather than two
  copies of the same `insertMarkdown` call drifting apart. Heading 3 has no
  toolbar button (the toolbar only ever offered H1/H2) but is wired into
  the map anyway, keyboard-only, since the help dialog lists it like any
  other Formatting shortcut. The toolbar's own Bold/Italic/Underline
  tooltips separately carried a hardcoded `"Ctrl+B"`-style literal that was
  never actually rendered (`title` read `btn.label`, not that field) — not
  a live bug, but the same landmine the footer tip above already was; it
  now goes through `formatKeys` like everything else, and is rendered for
  every Formatting button rather than the three that happened to have the
  dead field.
- **The Command Palette (`CommandPalette.tsx`, Cmd+/) is a new feature, not a
  wiring fix** — unlike Bold/Italic above, nothing on the other end of that
  shortcut existed anywhere in the codebase; `lib/shortcuts.ts` had declared
  it and `ShortcutsModal` had always listed it, but there was no feature to
  reach. Its seven actions (New Note, New Folder, Search Notes, Version
  History, Share Note, Toggle Theme, Keyboard Shortcuts) each call the exact
  function `NotesApp.tsx` already had, rather than a second copy of the same
  logic. An action that needs a note open (Share, Version History) is left
  out of the list entirely rather than shown disabled — a dialog with
  nothing in it behind a greyed-out row is not more honest than not showing
  the row. Building this surfaced two more shortcuts in the same
  advertised-but-unwired state (`new-folder`, `toggle-theme`); both are now
  wired as real global shortcuts too, not just reachable through the
  palette, since a key combo shown next to a palette row that does nothing
  when pressed directly outside it would have been the same lie at a
  smaller scale. `delete-note` (Cmd+Delete) was the one Editing-category
  shortcut left in the same state afterward; wired to the same `removeNote`
  the sidebar's own delete button already calls, so it is the same
  soft-delete with the same Recently Deleted net under it, not a second
  deletion path. `undo`/`redo` (Cmd+Z / Cmd+Shift+Z) stay unwired on
  purpose: their state lives private inside `RichTextEditor.tsx` with no
  ref or prop reaching it, so wiring them needs forwarding a ref across
  that boundary — a real refactor, not a one-line map entry like the rest
  of this bullet — and is left for its own change instead of being done
  quietly inside this one.

### Backend

- All API endpoints are **tRPC procedures** defined in `server/routers.ts`.
- DB queries live in `server/db.ts`. Add new query functions there; keep routers thin.
- Authentication context is available via `ctx.user` inside tRPC procedures.
- Notes are **ownership-guarded**: always filter by `userId` in queries.
- **Every sign-in path ends in `server/session.ts`.** The two-step verification
  check lives there once; a new method must go through it rather than minting
  its own cookie, or the second factor guards only some of the doors.
- Soft-delete is supported — check `deletedAt` before returning notes.
- **An export is only as honest as its manifest.** `lib/dataExport.ts` carries
  `NOT_INCLUDED`, a list of what the archive cannot hold. Anything new this app
  starts storing belongs in the archive or on that list — an omission nobody is
  told about is only discovered once the original is gone. `chats: null` means
  the server could not be asked and is deliberately not the same as `[]`.
- **Deleting an account is the one thing with no holding pen.** `deleteAccountData`
  in `server/db.ts` erases every row an account owns; the rules about what proof
  is required live in `server/accountDeletion.ts`. Two orderings there are load
  bearing and a new table must not break them: S3 backups go before the rows
  that can name them, and the `users` row goes last so a half-finished deletion
  leaves an account that can retry rather than rows nobody can reach. Add a
  user-owned table and it belongs in that function — nothing checks for you.
- **AI calls happen on the server**, through `server/_core/llm.ts` behind a
  `protectedProcedure`, and are rate limited (`server/rateLimit.ts`). The
  browser names an operation (`ai.assist`) rather than sending prompts, so the
  procedure is not an open relay to a paid model. `ai.chat` does take prior
  turns — a conversation has a past — but only `user` and `assistant` ones, and
  the system prompt is still written on the server. Its `action` field follows
  the same rule: the chat box picks a name from `ACTIONS` in `server/chat.ts`
  (summarise, rewrite, explain, brainstorm, analyse, draft), and the
  instruction behind that name never leaves the server. Once a conversation is
  saved the past comes from the database instead, so nothing the client sends
  can put words in the assistant's mouth.
- **Chat transcripts are stored in clear text** (`chatConversations`,
  `chatMessages`), unlike notes, which the server cannot read. The server has
  to rebuild a conversation to send it to the model, and that text had already
  left the device — but it is a different posture from notes, so it is a stated
  choice: the chat box has a "Save this chat" switch, and `save: false` writes
  nothing at all. Keep it that way rather than extending storage quietly. Never reintroduce a
  `VITE_`-prefixed provider key: those are substituted into the client bundle
  at build time and are readable by anyone who loads the page.

### Database

- Schema is in `drizzle/schema.ts`. Relations in `drizzle/relations.ts`.
- After changing the schema run `pnpm db:push` to generate and apply migrations.
- Use `drizzle-kit generate` + `drizzle-kit migrate` for production migrations.

### Encrypted sync

- Notes are pushed to the server as opaque blobs; `lib/syncService.ts` holds the
  encryption and the last-write-wins merge, both pure and both tested.
- **A failed push is remembered, not logged.** `lib/syncState.ts` tracks what the
  server has not taken, so it can be sent again and so the header can say so.
  Sync used to be silent: "everything is synced" and "nothing has synced since
  you opened the tab" looked identical, which is how someone stops keeping their
  own copy.
- **The pull goes before the flush, in `runSync`, and this order is load
  bearing in both directions.** An owed push is a local edit the server has not
  taken; sending it first overwrites whatever arrived there meanwhile, and the
  merge then compares this device against its own edit and sees nothing wrong —
  a newer edit from elsewhere is destroyed and no conflict is ever reported.
  What stops the deletion problem that once argued for the opposite order is
  the `owedDeletions` filter on `plan.saveLocal`, not the flush: a note deleted
  here whose tombstone has not landed looks, from the remote side, like a note
  this device has never seen, and the merge would otherwise put it back.
- **Winning a merge must not destroy the loser.** `mergeNotes` takes the
  baselines from `lib/syncBaselines.ts` — what this device last agreed with the
  server, per note — because `updatedAt` alone cannot tell "they edited and I
  did not" from "we both did". When both sides have moved, that is a conflict:
  the newer version keeps the note's id so other devices stay consistent, and
  the loser is written as a separate note via `conflictCopy`. A copy, not a
  version snapshot — version history is capped and pruned, and the only
  remaining copy of someone's writing does not belong somewhere it can be
  evicted from.
- **Record the baseline wherever a push succeeds**, including the direct pushes
  in `pushNoteToServer` — almost every push happens there, as the note is
  edited. Miss it and a note merely waiting to be pushed has no baseline, so
  the next sync reads "local is ahead of the server" as a disagreement and
  splits off a copy of a note nobody else ever touched.
- **The key is generated per browser, and only the person can move it.** A
  second device pulls rows it cannot decrypt, and the merge leaves them alone,
  which is right — `UnreadableNotice` counts them and says so rather than
  showing an empty-looking workspace under a header reading "Synced". The way
  out is `lib/recoveryPhrase.ts`: the key, encoded as a phrase to paste into the
  other browser. Nothing wrapped or escrowed goes to the server, because a
  server-side route to the plaintext is the one thing this design does not have.
- **Importing a key re-seals what is already here first** (`lib/keyImport.ts`,
  `reEncryptLocalContent`). A device that has been used holds notes under the key
  it made for itself, and swapping the key without moving them is deleting them
  while reporting success — so notes, recently-deleted and version history are
  all re-encrypted before the swap, with `preserveTimestamp` so the next sync
  does not read every note as freshly edited. Anything the old key cannot open
  is left byte-for-byte alone and counted: that is precisely the content the
  incoming key is about to make readable.
- **A phrase that does not checksum never reaches the key store.** Accepting a
  mistyped one installs 32 bytes of noise as this browser's key, and nothing
  appears to go wrong until someone opens an old note.
- **`createNoteVersion` encrypts, and sets `isEncrypted` from what it actually
  did** rather than copying the flag off the note it was handed. The note in
  memory is plaintext carrying `isEncrypted: true` from the row it was loaded
  out of, so copying it wrote every autosave into IndexedDB in clear text under
  a flag saying otherwise — and `restoreNoteVersion` then tried to decrypt
  plaintext and threw, which is why restoring a version silently did nothing.
  One line caused both. `readVersionContent` is the only way to read a snapshot
  back: lenient about the plaintext rows already in people's browsers, and
  strict about ciphertext it cannot open, which it reports as null so a restore
  refuses instead of writing base64 over a working note.
- **An edit inside the autosave window is invisible to the merge unless it is
  written down first.** `runSync` reads local state with `getAllNotes`, so a
  note still in the two-second debounce looks unchanged, the remote row is
  taken as a clean win, and the edit never gets to be a conflict at all.
  `persistPendingLocally` writes it to IndexedDB — and only there — at the top
  of a sync. Not `flushPendingSave`, which also pushes: a push before the pull
  is the ordering the whole merge depends on not happening. The push is not
  lost, because a note the store holds and the server has not agreed to comes
  back as `plan.push`.
- **The open editor is React state the merge knows nothing about.** After the
  merge, `resolveOpenNote` (`lib/openNote.ts`) decides what `currentNote`
  should become: replace it when the store now holds something newer, close it
  when the merge deleted it, and keep it when the store is behind because the
  person is still typing. Without that the editor shows the pre-merge version
  and — the part that actually loses work — the autosave writes it back over
  what the sync just pulled in.
- **A note the sync installed must not re-enter the debounce.** Setting
  `currentNote` re-runs the autosave effect, and arming it for a version that
  came straight from the store writes it back — `saveNote` stamps `updatedAt`
  with the time of the write, not the time of the edit — and pushes that. It
  dates another device's edit to now, breaks the baseline the sync just
  recorded, and sends a write nobody made; with the same note open on two
  devices each refresh provokes the other, and the modified time walks forward
  on its own. `syncInstalledRef` holds that exact object and the effect
  declines to arm for it, by identity: a keystroke builds a new object, so the
  guard lifts the moment anyone types.
- **Deleting a note must drop the debounce's hold on it** (`forgetPendingSave`).
  The autosave effect bails out early once `currentNote` is null, so nothing
  clears what `pendingSave` was already carrying — and the next sync calls
  `persistPendingLocally`, which writes that note straight back into the store.
  A deletion undone, locally, by the thing meant to protect an unsaved edit;
  and if the timer were left running it would fire into `writeNote`, which
  pushes, so it would come back on the server too.
- Only a run that leaves nothing owed may stamp "last synced". A pull that
  succeeded while pushes are queued has not synced this device.

### Backup and restore

- **A restore is a deliberate act, and is dated now.** Timestamps used to be
  preserved so a restore would not win every later comparison; the consequence
  was that it won none. The server still held the newer copy, the merge read
  that as a clean win because the baseline agreed with it, and the restored
  text was replaced with no conflict reported and no copy kept — a restore that
  undid itself quietly, seconds after saying it had worked.
- **Restoring must not destroy what it displaces.** A note edited since the
  backup was taken is newer than the archive's copy; `displacedCopy`
  (`lib/restorePlan.ts`) keeps it as a note of its own, the same shape
  `conflictCopy` uses for a sync conflict and for the same reason — version
  history is pruned, so the only remaining copy of someone's writing does not
  belong there.
- **What a restore would do is shown before it does any of it.** `planRestore`
  is pure and decides; the preview renders that plan and the apply step walks
  it, so the description and the action cannot disagree. A note the archive
  does not mention is never touched: a restore puts back what was lost, it is
  not a demand that the workspace become the archive.
- **The archive carries version history and the bin**, not just notes and
  folders (`ARCHIVE_VERSION` 2.0; a 1.0 archive still restores, with those
  fields empty). `ARCHIVE_NOT_INCLUDED` says what it cannot hold — chat
  transcripts live on the server and there is no route to put them back — for
  the same reason `dataExport.ts` keeps its list.
- **Backups happen on a cadence, and are proved readable on a slower one.**
  `lib/backupSchedule.ts` holds both decisions as pure functions over
  timestamps; `lib/backupJournal.ts` remembers per device. An archive that
  cannot be decrypted looks exactly like one that can until it is needed, so
  the check turns that discovery around — from after the loss to before it.

### Testing the wiring

- **There is a harness now, and the pure tests were not enough.** `vitest` runs
  a client project under jsdom with `@testing-library/react`;
  `vitest.setup.client.ts` unmounts between tests, and it is listed only on the
  client project because the server one runs on node and cannot import it.
  Cleanup is explicit because this repo does not set `globals: true`, so
  Testing Library's automatic version never runs.
- **`vitest.config.ts` needs its own `@vitejs/plugin-react`, separate from
  `vite.config.ts`'s.** `tsconfig.json` sets `jsx: "preserve"` and leaves the
  JSX-to-JS transform to that plugin; every client test before
  `VoiceMemo.test.tsx` used `renderHook` with no JSX of its own, so a test
  config missing the plugin looked identical to one that had it — nothing
  failed until the first test called `render(<Component />)` directly, which
  couldn't even parse.
- **Mock `trpc` and `useAuth`, and nothing else.** `hooks/useNotes.sync.test.tsx`
  drives the real hook against real IndexedDB, real AES-GCM, the real merge and
  the real debounce. The first thing it caught was a bug every pure test
  passed: `persistPendingLocally` wrote with `saveNote`'s default, which stamps
  the time of the write, so merely _opening_ a note and letting a sync run
  re-dated it to now — and it then beat a genuinely newer edit from another
  device as a clean win, no conflict, no copy kept. The decisions were all
  correct in isolation; the composition was not.
- **A suite that shares the store needs unique ids, not a wiped one.**
  `vitest.setup.ts` installs a fresh `IDBFactory` per test, but `storage.ts`
  caches the open database in a module variable, and the encryption key lives
  in IndexedDB too — so a fresh factory means a fresh key, and `getAllNotes`
  then fails to decrypt rows an earlier test wrote. The sync suite keeps one
  factory for the file and gives each test its own note and folder ids.
- **A failed push must not be recorded as an agreement.** `pushNoteToServer`
  and `pushDeletionToServer` catch their own errors and never rethrow, so
  `await pushNoteToServer(...)` inside `runSync`'s two plan-applying loops
  always resolved — and the line after it wrote a baseline unconditionally,
  whether or not the server actually took the push. A push that failed then
  looked exactly like one that had succeeded: the next pull read local as
  unchanged since agreement, and a genuinely independent edit arriving after
  it was taken as a clean win instead of the conflict it was, discarding
  local's still-owed writing with no copy kept and nothing reported. Both
  functions now return whether the push landed, and both loops gate the
  baseline on that. `hooks/useNotes.syncOrder.test.tsx` failed against the old
  code and passes against the fix — instrument before you trust an "it
  probably already does that" about ordering-sensitive code like this.
- **Ordering is asserted by logging calls, not inferred from outcomes.**
  `useNotes.syncOrder.test.tsx` wraps the mocked network client and
  `storage.saveNote` to write into one shared, ordered log — `vi.mock` with
  `importOriginal`, delegating to the real implementation after recording the
  call — so "pull before push" and "conflict copy saved before the note it
  lost to is overwritten" are read off the actual sequence rather than
  reconstructed from a final state that more than one order could have
  produced.
- **A test that mounts the hook must wait for the sync the hook starts, not
  call its own.** `useNotes` fires `void runSync()` from an effect on mount,
  and `runSync` returns immediately while one is already running — so a
  `syncNow()` called straight after mounting is usually a no-op, and the test
  is really depending on the effect's run landing inside the same await chain.
  It does while the stubs resolve in one tick. Both hook sync suites wait for
  `sync.lastSyncedAt` instead, which only a run that finished with nothing
  owed stamps; put a 40ms delay in the push stub without that and four of the
  five tests in `useNotes.syncOrder.test.tsx` fail on a sync that never ran.
- **A test for a bug in the debounce has to put something in the debounce.**
  `useNotes.syncDeletion.test.tsx` opens the note and types into it before
  deleting it, because `pendingSave` is armed by the autosave effect when
  `currentNote` is set. An earlier version seeded the note straight into
  storage to avoid `createNote`'s unawaited push, and deleted a note nobody
  had opened: both tests then passed with the fix commented out. Check that a
  regression test fails without its fix, every time — the arrangement is as
  easy to break as the assertion.

### Real-Time Collaboration

- WebSocket logic is in `client/src/lib/collaborationClient.ts`.
- Operational transformation helpers are in `client/src/lib/collaboration.ts`.
- The custom hook `useCollaboration` wraps the client for React components.
- **`disconnect()` cancels a reconnect that is already scheduled, not only
  one the close handler is about to schedule.** `closedByUs` guards the
  synchronous path — a close event checking the flag before deciding to
  reconnect — but a drop moments earlier can have already scheduled one via
  `setTimeout`, and `connect()` unconditionally clears `closedByUs` at its
  own start (needed for a deliberate reconnect after a deliberate
  disconnect). Without cancelling that pending timer, it fires anyway and
  reopens the exact connection `disconnect()` just closed, into a room the
  component has since unmounted out of. The timer's handle is kept in
  `reconnectTimeout`, the same shape `stopHeartbeat` already uses for its
  `setInterval`.

### Encryption

- Client-side AES-GCM encryption is implemented in `client/src/lib/` storage utilities.
- The server **never** receives plaintext note content for locally stored notes.
- **Reading more than one note decrypts them together, not one after another.**
  `decryptNotesInPlace` in `storage.ts` is what `getAllNotes`, `getNotesByFolder`,
  `getNotesByTag` and `getDeletedNotes` all go through; `searchNotes` does the
  same thing inline because it returns a filtered copy rather than the rows.
  Each had the identical loop awaiting one note's decrypt before starting the
  next, so a whole workspace was decrypted at the speed of one note after
  another — on the main thread, and a sync does it on mount, on the tab
  regaining focus, on the network returning and on the retry beat.
- **The base64 walk cost more than the cryptography.**
  `Array.from(atob(s), c => c.charCodeAt(0))` is correct but allocates a boxed
  JS array of one number per byte; `base64ToBytes` fills a buffer that is
  already the right size. Over 500 notes of about 2KB the decode alone was 88ms
  the old way and 3ms the new — more than half the cost of reading the whole
  workspace, doing no cryptography at all. With both changes `getAllNotes` went
  from 154ms to 26ms. `shared/crdt.ts` had the right shape all along; only the
  `storage.ts` copy lagged, which is the argument for looking at the other copy
  when fixing one.
- **The guard is the shape, not a stopwatch.** `bulkDecrypt.test.ts` spies on
  `crypto.subtle.decrypt` and asserts the peak number in flight equals the
  number of notes. Sequential code pins that at 1 however many notes there are,
  so the regression is caught deterministically — a timing threshold would
  flake on a loaded CI runner and would not say which path regressed.
- **A profile beats a second guess.** After the two fixes above, a real CPU
  profile (Playwright driving real Chromium, `Profiler.start`/`stop` over the
  CDP session — not `pnpm test:e2e`'s own suite, a one-off investigation) of a
  cold reload and of typing, both against a seeded 300-note workspace, came
  back 78–86% idle with no function attributed over 2% of sampled time. The
  largest single contributor while typing was React's own reconciler, not
  application code. Before that, `shared/crdt.ts`'s `encodeUpdate` looked like
  the same base64-decode anti-pattern above by pattern-matching alone — a
  one-char-at-a-time string-concatenation loop, where the fix above replaced
  exactly that shape. Benchmarked instead of "obviously" fixed: it was already
  faster than the chunked alternative at every size tried, because V8's rope
  strings handle repeated small concatenations well and the chunked version's
  own `Array.from` call reintroduces the boxed-array cost the fix above was
  removing. Left alone. The lesson both ways: measure the specific code in
  front of you, because a shape that looks like a known anti-pattern is not
  always one, and a real profile finds better targets than reading the source
  for another copy of yesterday's bug.

### Testing

- Tests are co-located with the source file they test (e.g. `shortcuts.test.ts` next to `shortcuts.ts`).
- Run `pnpm test` before committing. All tests must pass.
- Use **Vitest** (`describe`/`it`/`expect`) — no Jest.
- **`pnpm test` is jsdom. `pnpm test:e2e` is a real browser**, and the two are
  not interchangeable, whatever the "not verified: no real browser" caveat on
  a dozen past commits here implied. `e2e/` runs the actual production build
  (`dist/index.js`, built first) under real Chromium against real IndexedDB
  and real `crypto.subtle` — Playwright's own `webServer` starts it, the same
  throwaway `JWT_SECRET` and no-database posture as `scripts/smoke.sh`, and
  every spec forces `lib/localMode.ts` on with `addInitScript` so nothing here
  needs a signed-in session either. It is not wired into `ci.yml`: a CI runner
  needs its own `playwright install chromium` first, an extra cost in time and
  bytes that is a call for whoever owns the CI budget, not one to make
  silently from inside a test file. It also does not run automatically before
  a commit — run it by hand when a change touches what it covers.
- **The store having a row is not the same as the row holding what you just
  typed.** `e2e/local-notes.spec.ts`'s first attempt polled `readStoredNotes`
  for "any note exists," which the blank template already satisfies the
  moment it is chosen — before a single keystroke. That poll resolved
  immediately, so the test moved on to reload the page while the typed
  content's autosave debounce was still pending, and the reload cut it off
  before it ever wrote. What actually needs polling is the row's `updatedAt`
  moving past a baseline captured before typing — a value that can only
  advance on a write that genuinely happened.
- **A locator that matches text finds every place that text appears, not the
  one row you mean.** `getByText("Blank Note", { exact: true }).first()`
  matched something in the sidebar that was not the clickable note row — the
  sidebar renders a note's title in more than one place — and clicking it
  left `currentNote` untouched, which reads identically to "the click did
  nothing" from outside. Scoping to the element carrying the row's own click
  handler (`div[class*="cursor-pointer"]`, filtered by title) finds the row
  and only the row.
- **Playwright's own readiness probe does not send `Accept: text/html`.**
  This server's SPA fallback answers a plain GET to `/login` or `/app` with
  404 and reserves the app shell for a request that says it accepts HTML —
  right for a browser, wrong for `webServer.url`'s bare health check, which
  read the 404 as "not up yet" and burned the full timeout on a server that
  had been listening the whole time. `/` is a real static file and answers
  either way, which is why the config points there instead.

### Environment Variables

Create a `.env` file at the repo root — it is git-ignored, and there is no
checked-in template on purpose (see README, "Configuration"):

```env
# AI provider, server-side only. The one key the assistant, chat, voice
# transcription and template drafting all go through. The other three are
# optional and only needed to point at something other than the default:
# a different endpoint, and the model names to ask it for. Defaults live in
# server/_core/forge.ts.
BUILT_IN_FORGE_API_KEY=...
BUILT_IN_FORGE_API_URL=...
BUILT_IN_FORGE_MODEL=...
BUILT_IN_FORGE_TRANSCRIPTION_MODEL=...

# MySQL database. Leave it out and the server still boots: notes stay in the
# browser, and the routes that need a database log a warning and no-op.
DATABASE_URL=mysql://user:password@host:3306/dbname

# Signs session cookies, and derives the key that encrypts two-step
# verification secrets. Any sign-in needs it.
JWT_SECRET=...

# Server
PORT=5000
NODE_ENV=development
```

Every other variable is optional and gates one feature — Google sign-in, email,
reCAPTCHA, S3 backups — each of which reports itself unavailable when unset
rather than half-working. `render.yaml` enumerates the full set.

The one exception is `VITE_APP_ID`, which the server reads at runtime as well as
the client at build time. With `DATABASE_URL` set and no app id, sign-in
succeeds and every request after it is refused, so `assertStartupConfig`
(`server/_core/startupChecks.ts`) stops the process at boot. Without a database
nobody can sign in, so smoke, e2e and static deploys run with neither, and
`scripts/smoke.sh` holds both halves.

---

## Key Features Reference

| Feature                            | Key Files                                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Rich-text editor                   | `components/RichTextEditor.tsx`                                                                                         |
| AI writing assistant               | `components/AIAssistant.tsx`, `server/aiAssist.ts`                                                                      |
| AI chat assistant                  | `components/AIChatBox.tsx`, `server/chat.ts`, `shared/chat.ts`                                                          |
| In-chat assistant actions          | `components/AIChatBox.tsx` (`QUICK_ACTIONS`), `server/chat.ts` (`ACTIONS`)                                              |
| Cancelling a request in flight     | `lib/inFlight.ts`, and the Stop button in `AIChatBox.tsx`, `AIAssistant.tsx`, `VoiceMemo.tsx`                           |
| Saved chat conversations           | `server/db.ts`, `drizzle/schema.ts` (`chatConversations`, `chatMessages`)                                               |
| Sidebar / folders                  | `components/Sidebar.tsx`                                                                                                |
| Version history                    | `components/VersionHistory.tsx`, `lib/storage.ts` (`createNoteVersion`, `readVersionContent`)                           |
| Collaborative sharing              | `components/ShareModal.tsx`                                                                                             |
| Real-time collaboration            | `lib/collaboration.ts`, `lib/collaborationClient.ts`, `hooks/useCollaboration.ts`                                       |
| Live cursors                       | `components/LiveCursors.tsx`                                                                                            |
| Presence indicators                | `components/PresenceIndicators.tsx`                                                                                     |
| Keyboard shortcuts                 | `lib/shortcuts.ts`, `components/ShortcutsModal.tsx`, `hooks/useKeyboardShortcuts.ts`                                    |
| Command palette                    | `components/CommandPalette.tsx`, `pages/NotesApp.tsx` (`commandPaletteActions`)                                         |
| Template selection                 | `components/TemplateSelector.tsx`, `shared/templates.ts`                                                                |
| AI drafting of template blanks     | `server/templateDrafting.ts`, `server/routers.ts` (`templates.draftBlanks`)                                             |
| Recently deleted                   | `components/RecentlyDeleted.tsx`                                                                                        |
| Voice memos                        | `components/VoiceMemo.tsx`                                                                                              |
| Server-side notes                  | `server/db.ts`, `server/routers.ts`, `drizzle/schema.ts`                                                                |
| tRPC setup                         | `server/_core/trpc.ts`                                                                                                  |
| Login page                         | `pages/Login.tsx`                                                                                                       |
| Deploys with no server             | `lib/localMode.ts`, `components/NoServerNotice.tsx`, `components/DemoExpiredDialog.tsx`, `App.tsx`                      |
| Email + password sign-in           | `server/emailAuth.ts`, `server/password.ts`, `server/email.ts`, `components/EmailSignInForm.tsx`                        |
| Google sign-in                     | `server/googleAuth.ts`, `server/googleRoutes.ts`                                                                        |
| Robot check (reCAPTCHA)            | `server/recaptcha.ts`, `components/Recaptcha.tsx`                                                                       |
| Session minting (one 2FA gate)     | `server/session.ts`                                                                                                     |
| Account deletion                   | `components/AccountSettings.tsx`, `server/accountDeletion.ts`, `shared/account.ts`, `lib/localErasure.ts`               |
| Exporting everything               | `lib/dataExport.ts`, `components/AccountSettings.tsx`, `server/routers.ts` (`account.export`)                           |
| Sync, and saying whether it worked | `lib/syncState.ts`, `lib/syncService.ts`, `hooks/useNotes.ts`, `components/SyncIndicator.tsx`                           |
| Keeping both sides of a conflict   | `lib/syncBaselines.ts`, `lib/syncService.ts` (`mergeNotes`, `conflictCopy`), `components/ConflictNotice.tsx`            |
| Keeping the open editor in step    | `lib/openNote.ts`, `hooks/useNotes.ts` (`persistPendingLocally`, `runSync`)                                             |
| Carrying the key to another device | `lib/recoveryPhrase.ts`, `lib/keyImport.ts`, `lib/storage.ts` (`reEncryptLocalContent`), `components/EncryptionKey.tsx` |
| Two-step verification              | `server/totp.ts`, `server/twoFactor.ts`, `server/rateLimit.ts`, `components/TwoFactorSettings.tsx`                      |
| Session scopes                     | `server/_core/sdk.ts` (`full` vs `pending_2fa`)                                                                         |
| Real-browser smoke test            | `e2e/local-notes.spec.ts`, `e2e/helpers.ts`, `playwright.config.ts` (run with `pnpm test:e2e`)                          |
