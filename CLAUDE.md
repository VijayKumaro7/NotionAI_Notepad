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

- **A full-height shell that scrolls inside itself is `h-dvh`, never `h-screen`.**
  `h-screen` is `100vh`, which on mobile Safari and Chrome Android is the
  viewport with the URL bar retracted, so while the bar is showing the layout
  is taller than what is visible and its bottom edge — the editor's footer, the
  last row of the sidebar — sits underneath it. `h-dvh` (`100dvh`) tracks the
  bar. `NotesApp.tsx` and `SharedNoteView.tsx` use it; `min-h-screen` on pages
  that simply scroll is left alone, since a page taller than the viewport just
  scrolls. A desktop Chromium run cannot show the difference — `dvh` and `vh`
  are equal when no bar collapses — so what was checked is that `100dvh`
  resolves to exactly the viewport height at phone and desktop sizes.
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
  deletion path. `undo`/`redo` (Cmd+Z / Cmd+Shift+Z) are
  handled in `RichTextEditor.tsx`'s own `onKeyDown`, not in `NotesApp.tsx`:
  their history is private to that component, and the textarea is where focus
  is whenever anyone reaches for them, so no ref has to cross the boundary.
  Pressed with focus outside the editor they do nothing. `undo` and `redo`
  also refresh the character and word counts, which they used to leave stale.

- **"The selected text" is reported by the editor's own textarea, and belongs to
  one note.** `NotesApp.tsx` took it from a page-wide `mouseup` through
  `window.getSelection()`, and the assistant works on it instead of the whole
  note (`selectedText || noteContent`). Three things were wrong with that. Only
  the mouse updated it, so a selection made with Shift+arrows never arrived and
  one that was then edited away stayed behind. It was never cleared on a note
  switch, so note B could be rewritten from text selected in note A. And
  Firefox does not report text selected inside a `<textarea>` through
  `getSelection()` at all, which is where the note body lives. `RichTextEditor`
  now reports `value.slice(selectionStart, selectionEnd)` from the textarea's
  `select` event — mouse, keyboard and code alike, in every browser — and
  `NotesApp.tsx` clears it when the note id changes. The Firefox part is the
  documented behaviour, not something reproduced here: Chromium is the only
  engine in this sandbox, and the AI column is signed-in only, so the browser
  suite never sees it.

- **`ShareModal` lists, creates and revokes links for the note it was handed,
  and each reply is checked against the note open now.** It is handed a `noteId`
  that can change while it is up, and `loadShares` and `handleCreateShare` wrote
  their replies into state without asking: a listing for the previous note could
  land after the new note's and replace it, and a link created for one note was
  added to another's list. The list updates also read `shares` from the render
  the click came from, so a link created while another was being revoked brought
  the revoked one back on screen — and a revoked share link that still looks live
  is the one thing this dialog must not do. Replies are dropped unless
  `openNoteId.current` still names the note they were for, and the list is
  changed with the functional form. The copy and revoke buttons were icon-only
  with no accessible name; they have `aria-label`s now, which the test finds them by.

- **An insertion goes where the editor says the cursor is, not where a page-wide
  query finds a textarea.** `handleAIInsert` used `document.querySelector("textarea")`
  and read its `selectionStart`, which is the first textarea on the page: the
  editor today only because its column renders ahead of the assistant's and the
  chat's own text boxes. Reorder the layout, or hide the editor, and the offsets
  of a prompt box were spliced into the note. `onSelectionChange` now passes the
  range with the text, `NotesApp.tsx` keeps it in `cursorRange` (cleared on a note
  switch), and `insertAtRange` (`lib/insertText.ts`) does the splice inside
  `updateCurrentNote`'s function form, against the note as it is then. A range
  longer than the content is clamped, and no range means append on a new line.

- **`VersionHistory`'s preview belongs to the version that is selected, and a
  failed restore says so.** Opening a snapshot is a decryption, so it lands a
  moment after the click, and `showPreview` painted whatever finished last: click
  one version, then another, and the slower first one could land second and put
  its text — and its "cannot be read here" verdict, which disables Restore —
  beside the version that was actually selected. Restore acts on the selected
  version, so a person could read one version's text and bring back another's.
  `previewing` (a ref) names the version the preview is for, and an answer for
  any other is dropped. Separately, `handleRestore` swallowed a throw into
  `console.error` and a refusal (`null`) into nothing, so a restore that did not
  happen looked like one the dialog had simply forgotten; both toast now.

- **Permanently deleting a note takes its version history with it.**
  `permanentlyDeleteNote` and `cleanupExpiredDeletedNotes` removed the row in the
  bin and nothing else, so a note the person had confirmed — "this cannot be
  undone" — was gone from every list while every autosave snapshot of it stayed
  in the `noteVersions` store, unreachable from any screen and never pruned
  (pruning runs per live note). Both now delete the note's versions in the same
  transaction as its bin row, through `deleteVersionsOf`, so the two cannot
  disagree about whether the note exists. A note that is only in the bin keeps
  its history: restoring it has to bring the history back too.

- **An empty list is an answer while a search is on, not a workspace waiting to
  load.** `NotesApp.tsx` reloads every note whenever the list is empty and there
  are folders, which is right on a cold start and wrong after a search with no
  matches: the search emptied the list, the effect read that as "not loaded yet"
  and put the whole workspace straight back, so searching for something that is
  not there looked like the search had done nothing. `searchedQuery` records the
  query the list on screen answers (empty when it is the whole workspace), and
  the reload is skipped while it is set. Found by reading, then reproduced in
  real Chromium before the fix: `pnpm test:e2e` is where this one lives, because
  the bug is in the page's wiring and a jsdom render of the page would be most of
  the app. The first version of that test passed against the broken build —
  `toHaveCount(0)` is satisfied the instant the list empties, before a reload
  behind it can land — so it waits and asserts again.
  The other half of the same state: the list was refreshed only by Enter or the
  search button, so emptying the box left the list answering a question nobody
  was asking any more. An effect watches for the box going empty while
  `searchedQuery` is set, clears it and reloads the workspace.

- **Anything that arrives late builds its change from the note as it is then,
  and says which note it is for.** A transcription takes seconds, and
  `handleVoiceTranscription` built its new content from `currentNote.content`
  as it was when Transcribe was clicked. `updateCurrentNote` applies a patch to
  whichever note is current when it runs, so the reply replaced the note with
  the old text plus the transcript: everything typed in the meantime was gone,
  and if the person had switched notes, the _other_ note was overwritten with
  the first note's text and autosaved. `updateCurrentNote` takes a function now,
  which is handed the latest note, and the voice handler uses it. `VoiceMemo`
  is also told the note it is recording for (`noteId`, required) and compares it
  with the note on screen when the reply lands: if they differ, nothing is
  inserted, the recording is kept, and a message says so, because putting the
  text in a different document is wrong even when nothing is lost. The same
  shape — a component mounted once, a closure taken at click time, a result
  that lands later — is worth looking for wherever a panel does async work for
  "the current note". `AIAssistant` is the second place it was found: its
  result is one answer about one note's text, a reply that landed after a switch
  was shown anyway, and a result already on screen followed the person into the
  next note, where Insert put it. It takes the note's id (`noteId`, required),
  clears the result when it changes, and cancels a request still in flight; what
  was typed stays, because that is the person's instruction and not the note's.
  `AIChatBox` was left alone on purpose: it is a running conversation, so a
  reply that lands after a switch joins it, and inserting an earlier message
  into another note is a deliberate click on that message.

- **`RichTextEditor` is told which note it is showing (`noteId`), and reads its
  counts off `content`.** The editor is mounted once and shown for whichever
  note is open — nothing remounts it on a switch — so its undo history, kept as
  state, belonged to the first note it ever showed. Switch notes, type, press
  Cmd+Z, and it wrote the previous note's text into the new one: reproduced in
  real Chromium by undoing in a second note and getting the first note's
  `alpha one`. A changed `noteId` now resets the history while rendering, so the
  new note's first render never sees the old one's. The character and word
  counts were state set only by the editor's own typing, so an AI insertion, a
  voice transcription, a restored version or a sync left them describing a
  note that was no longer there; they are derived from `content` now, so there
  is nothing to keep in step. A new prop an editor needs to be correct is
  required, not optional, so a caller that forgets it fails the type-check.
  A change the editor did not make — an AI insertion, a voice transcription, a
  restored version, a sync — is recorded as a history step of its own: when the
  content differs from the current history entry on the same note, someone else
  changed it, and undo can take it back. Before, undo stepped over it, and with
  nothing typed yet it was disabled, so an insertion could not be undone at all.
  This relies on the editor being a controlled component: the parent has to
  apply `onChange`, because a parent that does not looks, to the editor, like
  one that keeps changing the content from outside.

- **Cmd+S flushes the autosave debounce and reports what happened.** `save`
  used to be a bare `toast.success("Note saved")`; with a two-second debounce
  that told someone mid-sentence their edit was saved while it was still only
  in memory, and would have said the same had the write failed. `saveNow` in
  `useNotes` is `flushPendingSave` handed to the page — the same write the
  timer does (version snapshot, server push included) — and resolves to
  whether it landed, so `NotesApp.tsx` toasts success or an error from the
  answer. Nothing pending counts as saved; with no note open the shortcut does
  nothing.

- **A text field keeps only the chords it already uses; every other shortcut
  reaches the app from inside it.** `useKeyboardShortcuts` ignored a keydown
  whose target was an input or textarea unless the shortcut was one of three
  (`help`, `command-palette`, `open-search`). The note body is a textarea, so
  nearly every shortcut is pressed from inside one, and the rest — Save, Share,
  Version History, New note, New folder, Toggle theme — did nothing there. Cmd+S
  was the worst of them: the `saveNow` wiring above only ever ran with focus
  somewhere nobody types, and with focus in the editor the browser's own "save
  page" was left to run. The rule is inverted: a field keeps `delete-note`
  (deleting a line), `undo`/`redo` and the Formatting keys (the editor's own
  `onKeyDown` turns those into markdown), and everything else goes to the app.
  A shortcut added later is live in the editor by default instead of silently
  dead there, which is how this went unseen. `useKeyboardShortcuts.test.tsx`
  pins each side; `e2e/local-notes.spec.ts` presses Ctrl+S in the real editor and
  waits for "Note saved" inside the autosave window.
- **Heading, list and quote markers go at the start of the line.** The editor's
  `insertMarkdown` put every marker at the cursor, which is right for `**bold**`
  and wrong for `# `, `- `, `1. ` and `> `: with the cursor mid-line they gave
  `hello # world`, which is not a heading. Those six use `insertLinePrefix`
  (`prefixLines` in `lib/insertText.ts`), which marks every line the selection
  touches and keeps the selection on the same text.
- **Everything a note carries is escaped in the HTML export, tags included.**
  `exportAsHTML` escaped the title and the content and wrote `note.tags` into
  the page as it was, so a tag of `<script>…</script>` ran when the downloaded
  file was opened. Tags are as free-form as a title and arrive from sync and
  from restored archives, not only from this person's typing.
- **A preference in `localStorage` goes through `getStored` / `setStored`
  (`lib/safeStorage.ts`), never the bare call.** Browsers that block site
  storage throw on both the read and the write. `lib/localMode.ts`,
  `sidebarState.ts`, `demoSession.ts` and the rest already caught that, but
  `ThemeProvider` read the theme inside its initial state, and it wraps the
  whole app: a blocked-storage browser got a blank page, not a default theme.
  `useAuth` and the chat box's "save this chat" switch had the same bare calls,
  in an effect. `ThemeContext.test.tsx` renders the provider with both calls
  throwing. `e2e/local-notes.spec.ts` does the same in real Chromium with the
  built app: before the fix that page rendered 41 characters of body text,
  after it the whole landing page, and the test fails with the bare call put
  back.
  `sessionStorage` is the same: refused separately in some setups, and by a
  property access that throws. `NotesApp.tsx` read the landing page's template
  hand-off from it in an effect on mount, so with only `sessionStorage` refused
  the workspace — not just the landing page — rendered blank (41 characters of
  body text, no "New note" button, measured in Chromium). `getStoredSession`,
  `setStoredSession` and `removeStoredSession` are the same helpers for it, and
  `e2e/local-notes.spec.ts` opens the workspace with the property throwing. The
  first storage-blocked pass only loaded the landing page and missed this one:
  look for the other storage area, not just the one already fixed.
- **The sidebar row of the open note shows the title being typed.** The note
  list is only rewritten when the autosave writes, up to two seconds after a
  keystroke, so the title box and the sidebar disagreed for that long — the row
  kept the old name, or "Untitled" for a title just emptied. `NotesApp.tsx`
  hands the sidebar `sidebarNotes`, the list with the open note's title taken
  from `currentNote`; nothing else on a row is ahead of the list. Found by
  driving the built app in Chromium rather than by reading, and pinned in
  `e2e/local-notes.spec.ts`, since it is page wiring a hook test cannot see.
- **The tag list and the tag filter follow the notes that carry the tag.**
  `availableTags` was refreshed on load and on an autosave and by nothing else,
  so deleting the last note with a tag left it in the sidebar. With that tag as
  the active filter it was worse: the list emptied, the "empty means not loaded"
  reload put the whole workspace back, and the sidebar went on showing the
  filter badge and a Clear button for a tag nothing carried. `removeNote`
  refreshes the tags, and an effect in `useNotes` ends a filter whose tag is no
  longer in the list and shows the workspace. Found by driving the built app in
  Chromium; `useNotes.tagFilter.test.tsx` and `e2e/local-notes.spec.ts` cover
  it. The paths that bring notes in refresh it too: a sync that changed
  anything, a note restored from the bin and a backup restore. Each left a
  tagged note's tag out of the sidebar until the next autosave, so there was
  nothing to filter by (`useNotes.tagRefresh.test.tsx`).
- **A folder's "No notes" means the folder is empty, not that a search found
  nothing.** `Sidebar.tsx` renders that per-folder, from whatever `notes` it
  was handed — and during a search `notes` is the (possibly empty) result
  set, not this folder's own contents, so a search with no matches made
  every folder in the workspace claim to be empty. `Sidebar` now takes a
  `searchActive` flag (`!!searchedQuery` from `NotesApp.tsx`) and reads "No
  matches" instead while it's set. `Sidebar.test.tsx` renders with
  `notes={[]}` both ways and checks which text shows.

### Backend

- All API endpoints are **tRPC procedures** defined in `server/routers.ts`.
- DB queries live in `server/db.ts`. Add new query functions there; keep routers thin.
- Authentication context is available via `ctx.user` inside tRPC procedures.
- Notes are **ownership-guarded**: always filter by `userId` in queries.
- **A security event is logged twice: to the table and as a JSON line on stdout (`server/securityLog.ts`).** The table feeds the account's activity page and sits in the database an intruder could edit; the stdout line (`"event":"security"`) is for a log drain, is written first so it survives a failed write, and carries exactly the stored row's fields. A new field on the row is a new field in the line: add one only if it is as safe to ship as it is to store, because `securityLog.test.ts` pins the line's keys.
- **A signed token says what it is for (`server/_core/tokenAudience.ts`).** The session cookie and the Google and portal sign-in flow cookies share one key, and what kept them apart was only that each reader required fields the others lack. Each now carries an `aud` (`notepad:session`, `notepad:google-flow`, `notepad:portal-flow`) and each reader checks it. Only sessions accept a token with no `aud`, because those predate the claim and last up to a year; the flow cookies last ten minutes and require it. A new kind of signed token needs its own audience, and a reader that does not check one is the gap this closes.
- **Rotating `JWT_SECRET` has a way that signs nobody out (`server/_core/signingSecrets.ts`).** `JWT_SECRET_PREVIOUS` is the value `JWT_SECRET` replaced, read and never written with. `sdk.verifySession` tries the current secret and then the previous one, and moves on only for a signature that does not match (an expired token fails under either); `decryptSecretAged` and `recoveryCodeHashes` do the same for two-step secrets and recovery codes. A two-step secret opened under the previous key is sealed again under the current one when its owner next signs in (`db.resealTwoFactorSecret`, which touches nothing but the secret). The 10-minute sign-in flow cookies and the rate-limit and address hashes are deliberately not carried across. A new thing derived from `JWT_SECRET` that has to outlive a rotation reads through `secretsInOrder` too, or the rotation breaks it.
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
- **A foreign key added to a table that already has rows needs its orphan cleanup
  in the same migration.** `ADD CONSTRAINT … FOREIGN KEY` checks the existing
  rows, a row with no parent fails it (error 1452), and MySQL cannot roll DDL
  back: the constraints before the failure stay, and the rerun dies on a
  duplicate constraint name. drizzle-kit writes only the constraints, so
  `0011` has `DELETE … NOT IN (SELECT …)` statements written ahead of them (and an
  `UPDATE … SET … = NULL` for `noteCollaborators.invitedBy`, whose row is a real
  collaboration). `drizzle/migrations.test.ts` fails a migration whose
  constraint has no cleanup before it. That test reads SQL; it was not run
  against a real MySQL.
- **The collaboration tables have foreign keys.** `collaborativeDocuments`,
  `noteCollaborators`, `noteShareLinks` and `noteInvitations` cascade from `notes`
  and `users`; `noteCollaborators.invitedBy` is `ON DELETE SET NULL`, so
  someone's access outlives the person who invited them. `deleteAccountData`
  and `removeSharing` already delete children before parents, so the constraints
  are a backstop for a path that forgets, not the mechanism. Order still
  matters: a new delete of a parent has to clear or null its children first, and
  a new insert needs its parent to exist.
- **A `DATABASE_URL` the driver refuses is fatal, and the driver is the judge.**
  `databaseDriverProblem` builds a `mysql2` pool from the URL (no connection is
  opened) because `getDb` swallows the driver's throw and runs with no database.
  `ssl=true` is the one people write: it reads as "turn TLS on" and is refused as
  "SSL profile must be an object". Use `ssl=%7B%7D` (TLS, certificate checked), a
  profile such as `Amazon RDS`, or `{"rejectUnauthorized":true}`.
  `databaseTlsWarnings` is a **warning**, in production, off loopback, for no TLS
  and for `rejectUnauthorized:false` (encrypted, but the server is never
  checked). It is not a refusal because plenty of hosted databases are only
  reachable on a private network and refusing would break a deploy that works.

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
  The re-sealing and the key swap are **one transaction** (`reEncryptLocalContent`
  with `install`). They were two steps — every store written under the new key,
  then the key stored — and the stored key is the only thing that decides what
  this browser can open, so a failure in the gap (a write error, a full disk, a
  tab closed at the wrong moment) left notes sealed with a key the browser did
  not have, under a message saying "nothing was changed". All the crypto is done
  first, then every store and the key go in together: it lands or it does not.
  `keyImport.atomic.test.ts` breaks the key write against the real stores and
  checks the old key still opens notes, the bin and version history; the
  mock-based `keyImport.test.ts` could only say which functions ran in which
  order, which is how the gap went unseen.
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
- **A restore pushes the note itself, straight away.** `restoreDeletedNote`
  writes the note back locally with `updatedAt` of now, newer than the
  tombstone's, and then pushes it with `pushNoteToServer` rather than leaving
  the server to find out at the next sync. Two things follow. Another device
  stops seeing the note as deleted at once. And a tombstone the first attempt
  never landed is replaced: a successful push clears what was owed for the
  note, and a failed one records the note as owed instead of the deletion, so
  no stale tombstone is left for `flushOwed` to send ahead of the note. Before
  this, a restore pushed nothing and survived only because `runSync` happened to
  flush the owed tombstone before the note's own push; moving `flushOwed` after
  the `plan.push` loop would have deleted the restored note again. That ordering
  no longer decides the outcome of a restore, so `useNotes.syncRestore.test.tsx`
  checks results and does not guard it.
- **A deletion pulled from another device refreshes the Recently Deleted list.**
  `runSync` applies it with `deleteNote`, which moves the note into the bin, and
  refreshed the note list and the open note but not `deletedNotes`, so the note
  vanished from the sidebar and was missing from the bin until a reload.
  `useNotes.syncBin.test.tsx` covers it.
- **A restored note goes to a folder that exists.** `removeFolder` reparents the
  notes it can see, and one in the bin is not among them, so it kept the id of a
  folder deleted since. `restoreNote` put it back there and the sidebar, which
  lists notes by folder, showed it nowhere. `restoreDeletedNote` now files it
  under the first folder when its own is gone, as sync already does.
  `useNotes.restoreFolder.test.tsx` covers both cases.
- Only a run that leaves nothing owed may stamp "last synced". A pull that
  succeeded while pushes are queued has not synced this device.

### Backup and restore

- **A restore refreshes the note that is open.** `restoreArchive` rewrites rows in
  IndexedDB, including the one on screen, and `currentNote` is separate React
  state. `confirmRestore` reloaded the list and nothing else, so the editor went
  on showing the text the restore had just replaced; the next keystroke built on
  that, and the autosave wrote it back over the restore — a restore that undid
  itself at the first character typed afterwards, with the displaced copy kept
  beside a note that no longer matched it. The restore is `restoreFromArchive` in
  `useNotes` now, which asks `resolveOpenNote` the question a sync asks and
  installs the answer the same way (through `syncInstalledRef`, so the installed
  note does not re-enter the debounce). `useNotes.restoreArchive.test.tsx` runs it
  against real IndexedDB with the restored note open.
  It also reloads the Recently Deleted list: the archive carries the bin, and
  `deletedNotes` is state of its own, so a restore that brought notes back into
  the bin left the list empty until the page was reloaded.
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
- **`backupDue`'s note count comes from the store, not from whatever `notes`
  happens to hold.** `NotesApp.tsx`'s backup tick passed `notes.length` —
  which a search or tag filter replaces with its own (possibly empty)
  result set — so a backup due while a filter had emptied the visible list
  read as "no notes yet" and was skipped until the next tick. `getNoteCount`
  (`lib/storage.ts`) is an `IDBObjectStore.count()` on the notes store,
  which only ever holds active notes (`deleteNote` moves a deleted one to
  its own store rather than flagging it in place), so it's both the real
  total and cheap — counting never decrypts anything.

- **"No cloud backups yet" is only said for a list that loaded.** The "Previous
  backups" list in the cloud-backup dialog read `data?.length ? list : "No cloud
backups yet."`, so a failed load said there was nothing to restore from — to
  someone who opened the dialog because they had lost notes. It is
  `CloudBackupList` now, with a loading state, a "could not load" with a retry,
  and the empty message last. It was pulled out of `NotesApp.tsx` so it could be
  tested: the page is too much of the app to render for one list.

- **Reading every note for a backup, a restore or an export goes through
  `getAllNotesForExport`, which writes the pending edit first and throws on a
  failure.** It read the store directly, so a backup taken within two seconds
  of typing left the last edit out, and it swallowed a read error into `[]`:
  `handleBackup` then wrote a zero-note file under "Backup created
  successfully", the cloud backup encrypted and uploaded an empty archive and
  stamped `lastBackupAt` so the schedule believed it was safe, a restore preview
  saw nothing local to displace, and "download everything" — the button
  directly above delete-account — handed over an empty archive. Every caller was
  already inside a `try` that reports a failure; they just never got one. If the
  latest edit cannot be saved the call throws too, rather than quietly producing
  a file one edit short.

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

### Rate limits

- **A limiter's count is in the database, not the process.** `RateLimiter`
  (`server/rateLimit.ts`) used to keep a `Map`, so every restart gave every
  address a fresh set of guesses (five at a two-step code) and every extra
  process multiplied each limit by the process count. `check` and `reset` are
  async now and count in the `rateLimits` table through `getRateLimitRows`;
  `decide` in `rateLimitStore.ts` is the one rule for what a count means, used
  by the memory store and the shared one alike. A new limiter needs a unique
  `name` (it keys the table, and renaming one zeroes it) and its call sites need
  `await` — the type-check finds any that do not.
- **The shared count is one row under `SELECT … FOR UPDATE`.** `lock` inserts an
  empty row first and then locks it: locking a row that is not there yet locks a
  gap, and two first attempts would deadlock instead of taking turns. Read,
  decide and write are one transaction, which is what stops ten processes each
  reading "9 of 10". The test fixes this by removing the serialisation from its
  fake table and watching the concurrency test fail.
- **If the table cannot answer, count in memory and say so.** A throw would turn
  a database hiccup — or a deploy that has not run the migration yet — into
  nobody being able to sign in; letting the attempt through would turn it into
  no limit. The per-process count is the old behaviour, and it is logged once a
  minute, not once an attempt.
- **Two limiters are per process on purpose.** The per-address flood limit on
  every API request (`apiRateLimit.ts`, `express-rate-limit`'s own store) and the
  WebSocket handshake limit (`shared: false`) run before anyone is identified. A
  database write per request there would give an anonymous flood a way to hit the
  database, which is the thing they exist to stop. Do not move them.
- **Keys are hashed.** What is counted is an email address or a client address,
  so the table stores `hashKey(name, key)` (an HMAC under a key derived from
  `JWT_SECRET`) rather than a readable list of who tried to sign in to what.
  Rows are transient and removed by `runRetention`, which is why they are not in
  `deleteAccountData`.

### Inviting people to a note

- **An invitation is addressed to an email address, not an account, and the
  server never looks the address up when it is sent.** `inviteCollaborator`
  used to find the user by email and add them at once, which made the invite
  box a way to ask whether an address had signed up and put notes in the list
  of people nobody had asked. It now writes a `noteInvitations` row and answers
  `{ invited: true }` whatever the address is; nothing in the response, the
  work done or the email sent differs. A test pins that `getUserByEmail` is not
  called, so a later "helpful" error for an unknown address fails it.
- **Accepting needs a verified address that matches.** `acceptInvitation` and
  `declineInvitation` go through `claimInvitation`: the account's
  `emailVerifiedAt` must be set and its address must equal the invitation's.
  Registering with someone else's address is not enough, because an
  unverified account is treated as having no address. A missing, mismatched,
  expired or already-used invitation all give the same "no longer available"
  answer, and `deleteInvitation` reports whether this call removed the row so
  that of two simultaneous responses only one acts.
- **Accounts without a verified email cannot be invited.** Portal accounts that
  carry an email but no `emailVerifiedAt` will not see invitations. If the portal
  vouches for addresses, set `emailVerifiedAt` on sign-in rather than relaxing
  the check here.
- **The invitee needs somewhere to go.** Before this, `sharedWithMe` and
  `collaboration.document` were not used by any page: the only way into a
  shared note was a link. `/shared-with-me` lists invitations and accepted
  notes, and `/note/:noteId` opens one through `SharedNoteView`, which now takes
  either a token or a note id.
- **A list that failed to load says so; it does not say there is nothing.**
  `SharedWithMe` read `invitations.data ?? []`, so an errored query rendered
  "No invitations right now" — and someone on a bad connection with an
  invitation waiting was told none had been sent. Each list shows "could not
  load" with a retry on `isError`. `SharedWithMe.test.tsx` covers both lists and
  the genuinely empty case.
  `CollaboratorsPanel` had the same shape for its share links and its people
  list, and a worse consequence: "No active links." for a list that failed (or
  had not loaded yet) hides a live link the owner needs to see in order to
  revoke it. Both lists now show a loading state, a "could not load" with a retry,
  and only then the empty message.
  The invitations still waiting for a reply are a third list with the same
  shape: it was hidden outright on an error, so an outstanding invitation the
  owner could not see was one they could not withdraw. It says it could not
  load, with a retry, like the other two.
- **Erasure covers invitations.** `deleteAccountData` removes the ones an
  account sent and the ones addressed to its email, and `removeSharing` removes
  a deleted note's.

### Real-Time Collaboration

- WebSocket logic is in `client/src/lib/collaborationClient.ts`.
- Operational transformation helpers are in `client/src/lib/collaboration.ts`.
- The custom hook `useCollaboration` wraps the client for React components.
- **`useCollaboration` clears everything that belongs to a room when the room
  goes.** Its cleanup stopped the client and cleared presence and cursors, and
  left the document `text`, `role`, `canEdit`, `selfUserId`, the undo flags and
  `isConnected` as they were. A hook that is handed a different room — an
  in-app move between two share links, or access switching off — kept showing
  the last room's document, and its role, until the next room's sync landed,
  and a switched-off hook went on reporting a connection it no longer had. A
  note someone has shared with one person must not flash up under another's
  link. The cleanup resets all of it. The hook had no test at all;
  `useCollaboration.test.tsx` drives it through a stand-in client that plays the
  server, and covers the single-room behaviour (sync, merge without echo, send
  only local edits) as well as the room change.
- **Only document updates wait for a connection, and they leave the queue at a
  pace the server accepts.** `CollaborationClient` queued every message it could
  not send — cursor moves, sync requests, updates — and flushed the lot the moment
  the socket opened. The server (`collaboration.ts`) takes 60 messages a second
  from one connection and drops the rest _silently_, document updates included
  (it answers `rate_limited` and carries on). So a stretch offline with the
  cursor moving put the real edits at the back of a burst of hundreds of stale
  cursor positions, and whatever fell past the 60th never reached anyone. Now
  `sendMessage` queues `update` and nothing else — a cursor move or a sync
  request is stale before it could be delivered, and the server sends the
  document on connect anyway — and `flushMessageQueue` lets 30 out, then waits a
  second for the next 30. The flush timer is cancelled by `disconnect()` and by a
  close, like the reconnect timer above.
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
- **A collaborator's live cursor never moved from a fixed point.**
  `LiveCursors.tsx` measured where to draw it by reading `editor.textContent`
  off the textarea's wrapper `<div>` and slicing that to the cursor's
  position — but a `<textarea>`'s text is never DOM content. React sets it
  through the `value` property, not as child text nodes, so that
  `textContent` is empty for the entire lifetime of the element, in every
  browser, confirmed with a plain `jsdom` check outside any framework. Every
  collaborator's cursor landed at the same spot regardless of where their
  real cursor was, because `"".substring(0, position)` is `""` whatever
  `position` is. The font was read from the wrapper too, rather than the
  textarea that actually carries the `font-mono` class. `cursorPixelPosition`
  (`lib/cursorPosition.ts`) is the fix: it finds the real `<textarea>` inside
  the wrapper and mirrors the text that precedes the cursor into an
  off-screen clone built with the textarea's own font, padding and content
  width — so it wraps exactly where the textarea wraps — then reads the
  position of a zero-width marker placed right after it, corrected for the
  wrapper's own border (a `position: absolute` child is placed relative to
  the padding edge, which `getBoundingClientRect` does not report) and for
  how far the textarea has scrolled.
- **Proving the wrap is correct needed a real browser, not jsdom.**
  `cursorPosition.test.ts` pins the plumbing — that the textarea's `.value`
  feeds the measurement rather than the wrapper's `.textContent`, that the
  container's border and the textarea's scroll offset are both subtracted,
  and that the measuring element is cleaned up afterward — by stubbing
  `Element.prototype.getBoundingClientRect` (not `HTMLElement.prototype`,
  which does not carry it) to encode how many characters preceded the
  marker. None of that can show whether the mirror actually wraps at the
  same point the real textarea does, since jsdom does not lay out text at
  all. That was checked separately, in real Chromium, outside the app: a
  300px-wide textarea styled like `.editor-textarea`, a paragraph long
  enough to wrap several times, and the real function called at every fifth
  character. The vertical position never went backwards, visited nine
  distinct lines, returned to a few pixels of the left padding after each
  wrap, and started exactly at the textarea's own 24px `padding-left` —
  which a single-line, unwrapped measurement (what the old code effectively
  did) could not have produced.

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
- **A note's title was never encrypted, in any store.** Content has been
  AES-GCM encrypted at rest since this app had encryption at all; `title`
  simply never went through the same `encryptContent`/`decryptContent` calls —
  not in `NOTES_STORE`, not in `DELETED_NOTES_STORE`, not in `VERSIONS_STORE`.
  A `docs/todo.md` item described this as a version-history-only gap (a
  deleted note's title readable next to its encrypted body); reading
  `saveNote`, `decryptNotesInPlace` and `createNoteVersion` directly showed it
  was the same gap everywhere content is encrypted, just discovered first in
  one place. The server side was never exposed — `encryptNotePayload` in
  `syncService.ts` JSON-stringifies the whole note, title included, and
  encrypts that as one opaque blob before it syncs — so this was purely a
  local-at-rest gap. `saveNote`, `getNote`, `decryptNotesInPlace` (shared by
  `getAllNotes`, `getNotesByFolder`, `getNotesByTag`, `getDeletedNotes`),
  `searchNotes`, `createNoteVersion`, `getAllNoteVersions`, `putNoteVersions`
  and `putDeletedNotes` all encrypt and decrypt `title` now, the same way they
  already did `content`.
- **Reading a title back is lenient in one direction, with no strict side.**
  A new `decryptTitle` helper borrows the asymmetry `readVersionContent`
  already uses for content — a title not shaped like ciphertext, or one that
  fails to decrypt, is handed back exactly as it was — but skips the "return
  null and refuse" half that content needs for a restore. Title is a label,
  not something a restore writes destructively over existing content, so
  there is nothing here for a strict path to protect. Every note on a device
  is in exactly this not-yet-encrypted-title state the moment this feature
  ships, and it heals itself the next time the note is naturally saved — no
  forced migration script, the same self-healing this codebase already
  relies on for version-history content.
- **`getNoteVersions`/`getNoteVersion` decrypt the title eagerly now, given a
  key**, because `VersionHistory.tsx` renders `version.title` straight from
  their result with no decryption step of its own — the same reason
  `decryptNotesInPlace` decrypts before the notes list is ever rendered rather
  than leaving it to `Sidebar.tsx`.
- **`restoreNoteVersion` was one encrypted-title feature away from writing
  ciphertext into a live note.** It read `title: version.title` raw, which
  was harmless only because title was never encrypted; the moment
  `createNoteVersion` started encrypting it, this line would have written
  base64 literally into the note's title on every restore — the exact bug
  (`"writing base64 over a perfectly good note"`) this codebase already fixed
  once for content, arriving again by a new route. Fixed by passing
  `encryptionKey` through to `getNoteVersion`, which now hands back an
  already-decrypted title; `restoreNoteVersion` itself needed no further
  change once its input was correct. Confirmed by reverting only
  `getNoteVersion`'s decrypt step and rerunning `titleEncryption.test.ts`'s
  restore test, which failed with the version's raw ciphertext title in the
  assertion — proof the test actually catches the bug it exists for, not
  just that it passes.
- **`reEncryptLocalContent` re-seals a title under the new key only when it
  is genuinely ciphertext under the old one**, and does not count a merely
  still-plaintext title in `leftAlone`. That counter means "this key could
  not open this content" — a real signal surfaced to whoever ran the import —
  and every title on a device is still-plaintext the day this feature ships;
  counting it there would have told someone their key import had partially
  failed when nothing had. A title that is plaintext is simply left as it is,
  same as it would be if title encryption did not exist yet, and is picked up
  the next time the note is naturally saved.
- **Backups and the archive restore path needed no changes of their own.**
  `cloudBackup.ts`'s `buildArchive`/`restoreArchive` and `dataExport.ts` both
  read already-decrypted plaintext titles out of `getAllNotes` /
  `getAllNoteVersions` / `getDeletedNotes` and write them back through
  `saveNote` / `putNoteVersions` / `putDeletedNotes` — once those functions
  encrypt and decrypt `title`, the archive does too, the same way it already
  did for `content`.
- Prove it: `titleEncryption.test.ts`, fifteen tests against real IndexedDB.
  Three fail outright without the fix — saving a title does not change it on
  disk, a version's title is not re-encrypted, re-encrypting under a new key
  does not touch it — and the restore test was separately confirmed to fail
  the way described above. `bulkDecrypt.test.ts`'s decrypt-call counts doubled
  (one call per note for the title, one for the body) without its peak
  assertions changing: each note's title and body decrypt one after the
  other, and all notes in a batch still proceed together, so the peak stays
  at the note count rather than doubling with the call count.

### Templates

- Templates live in `shared/templates.ts`; the fill-in-the-blanks flow is
  `extractPlaceholders` (read the blanks) and `applyTemplateValues` (write
  them back), used by `TemplateSelector.tsx` and, for AI-drafted values, by
  `server/templateDrafting.ts`.
- **`applyTemplateValues` had the exact hazard `extractPlaceholders`'s own
  doc comment already named, just unguarded on the write side.**
  `extractPlaceholders` deliberately skips a markdown link's label
  (`[Docs](url)`) — its regex checks for a following `(` and drops that
  match — because a link and a placeholder share the same `[...]` syntax,
  and the comment there says plainly that filling one in "would corrupt the
  document rather than personalise it." `applyTemplateValues` used a plain
  `/\[([^[\]\n]*)\]/g` with no such check, so filling in a placeholder whose
  name happened to match a link's label elsewhere in the same template
  rewrote `[Docs](https://...)` into `4 March(https://...)` — the link
  destroyed, not personalised. No current template in `noteTemplates`
  contains a markdown link, so this had never fired; it was found by
  noticing the asymmetry between the two functions' regexes rather than by
  reproducing a failure in the app. Fixed by giving `applyTemplateValues`
  the same `(\()?` capture and skip.
- Prove it: `templates.test.ts` adds "does not disturb a markdown link whose
  label matches a filled token," which fills a token used both as a link
  label and, separately, as a real placeholder in the same string, and
  checks only the real placeholder changed. Confirmed it fails against the
  original regex (the link's label becomes the filled value, the stray `(`
  left dangling off it) before restoring the fix.
- **A typed custom name followed a previewed template that had been left
  behind.** `openPreview` resets `placeholderValues`, `brief` and
  `editedByHand` the moment a different template is opened — a different
  template means different blanks — but left `customName` alone. Preview
  "Project Plan", type a name into "Note Name (Optional)", back out to the
  grid without creating a note, open "Meeting Notes": its own Note Name
  field still showed Project Plan's typed name, and creating the note from
  there gave it that wrong name instead of its own default. `TemplateSelector.tsx`
  had already fixed the sibling case for `placeholderValues` leaking across
  the grid's own "Use Template" shortcut (`handleSelectTemplate`'s guard on
  `template.id === previewTemplate?.id`); this was the same family of bug,
  through `openPreview` instead. Fixed by adding `setCustomName("")` next to
  the resets already there.
- Prove it: `TemplateSelector.test.tsx` adds "does not carry a previewed
  template's custom name into a different template's own preview," which
  fails against the pre-fix code with the exact symptom (`'My Q1 Plan'` where
  `''` was expected). Also checked live, in real Chromium against the
  production build: typed a name into Project Plan's preview, backed out,
  opened Meeting Notes, confirmed its Note Name field read empty, and
  confirmed the note it created was titled "Meeting Notes" rather than the
  stale name.
- **The preview's footer "Back" button was a stale "left open" item, and is
  closed.** It used to call `setPreviewTemplate(null)` directly and skip
  `closePreview`'s `inFlight.abandon()`; both Back buttons now go through
  `closePreview`, so a draft in flight when either is clicked is abandoned and
  cannot land in another template's blanks. `TemplateSelector.draft.test.tsx`
  pins it for both buttons with a signed-in `useAuth` and a `draftBlanks`
  mock the test resolves by hand; it fails with the `inFlight.abandon()` calls
  commented out.

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

The exceptions are `JWT_SECRET` and `VITE_APP_ID` (which the server reads at
runtime as well as the client at build time). With `DATABASE_URL` set, a missing
secret means there is no key to sign a session with, and a missing app id means
sign-in succeeds and every request after it is refused, so `assertStartupConfig`
(`server/_core/startupChecks.ts`) stops the process at boot. Without a database
nobody can sign in, so smoke, e2e and static deploys run with none of them, and
`scripts/smoke.sh` holds both halves, each case from an empty directory so a
developer's own `.env` cannot supply what it leaves out. Email settings are warnings via `emailWarnings`: email is on only when
`EMAIL_API_URL`, `EMAIL_API_KEY` and `EMAIL_FROM` are all non-empty (whitespace
counts, so that is flagged), a password-reset send is not awaited and a failure
is only logged after the person was told a link is on its way, and a
registration inserts the account before it sends, so a URL `fetch` rejects (no
scheme, credentials in it, `ftp://`), a partial set, an `http://` URL carrying
the Bearer key in clear text, a bare origin with no path (a guess, worded with its
own exception), or email with no `PUBLIC_ORIGIN` for the links
(`appUrl` throws after the row exists) are all silent failures to anyone but the
person waiting. `emailKeyWeaknesses` covers the key: a newline, NUL or non-Latin-1
character makes `fetch` throw before sending (leading/trailing whitespace is
stripped and fine, checked against Node), and quotes, a doubled `Bearer ` or a
template word are guesses worded as what they would do. `googleWarnings` covers Google sign-in: it is on only when the ID, the secret
and `PUBLIC_ORIGIN` are all set, and the ID is compared with the token's audience
for exact equality (checked with jose), so whitespace or quotes in it fail after
Google has signed someone in; the `.apps.googleusercontent.com` suffix and the
`GOCSPX-` secret prefix are the two things it relies on about the format.
`recaptchaOffWarnings` warns, in production with a database, when neither key is set (registration, sign-in and password reset then have only the rate limiters); unset stays a supported setting, so it is a warning and silent in development. `recaptchaWarnings` covers the reCAPTCHA keys: with one of two set the check is
silently off (`isRecaptchaConfigured` needs both), and a secret Google rejects
fails closed by design, so it locks everyone out of email sign-in; the test
secret and test site key are built from pieces so no key-shaped literal sits in the
repo, and the length and prefix are deliberately not checked. The site key fails
in the browser instead: it is served as written, so one the widget cannot start
with leaves nobody able to tick the box and `EmailSignInForm` refuses to submit. `oauthServerUrlWarning` covers `OAUTH_SERVER_URL`, the axios `baseURL` for portal
sign-in (checked against axios: no scheme is `ERR_INVALID_URL`, a path is kept,
credentials become Basic auth and are printed by the "Initialized with baseURL"
line in `sdk.ts`); unset is left to that file's own error log.
`googleClientSecretWeaknesses` checks the secret, which is used only in the code
exchange (so a wrong one fails every sign-in at the last step) and is sent as
written; the format is deliberately not required (older secrets have no
`GOCSPX-` prefix), only the alphabet both share. `emailFromWeaknesses` checks `EMAIL_FROM` as one mailbox
(`address` or `Name <address>`), on the raw value because it goes into the JSON
body as written; a reserved or template sender domain is not flagged when the
provider URL is loopback. Cloud backup settings are warnings via `s3Warnings`:
backup is on exactly when `S3_BUCKET` is non-empty and the S3 client is built on
first use, so a bucket with a slash or scheme (`InvalidBucketName`), an endpoint
with no scheme, or a region with whitespace or a URL in it (all confirmed against
the real SDK) would first surface in the backup panel. `S3_REGION` or
`S3_ENDPOINT` set with no bucket is called out too. Credentials are deliberately
not checked: the SDK walks a chain, so a half-set pair in the environment does
not mean it will not find them elsewhere. The one exception is `S3_ACCESS_KEY_ID`
and `S3_SECRET_ACCESS_KEY`, which nothing reads (the SDK wants `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY`), so setting them is a warning via `s3IgnoredCredentialWarnings`,
bucket or not, naming the variables and never the values. `AWS_ACCESS_KEY_ID` is the name the SDK does read, and with a bucket set `awsCredentialWarnings` flags whitespace or quotes in it (the provider uses it as written, and a newline makes Node refuse the signed request) and a pair with only one half set (the SDK treats that as a miss and falls back to a profile or role); the secret gets the same whitespace and quotes check, worded differently because it is never sent but derives the signing key, so a mangled one fails as `SignatureDoesNotMatch`, and it is not compared with the id because MinIO's default root credentials are the same word twice; an absent pair is silent, and the id's alphabet is not judged because MinIO accepts almost anything. `AWS_SESSION_TOKEN` gets the same whitespace and quotes check (it travels in the `x-amz-security-token` header, where Node refuses a newline outright), a warning when it is set with neither half of the pair (the provider reads it only with a complete pair), and an `ASIA` key id with no token is flagged as temporary credentials missing their token (the prefix is from AWS's identifier documentation, from memory, so it is worded as what it would do). `AWS_REGION` is a warning via `awsRegionWarning`, though not for the reason its siblings are: `storage.ts` passes an explicit `region` to the client, and an explicit region beats the environment (checked against the installed SDK), so the name every AWS tool uses is never read. It is raised only with a bucket set and a value that differs from the region the client really uses (`S3_REGION`, else `us-east-1`), because Lambda and ECS set it on their own; the consequence for a bucket elsewhere is worded as a likely one, and neither region is repeated. `AWS_DEFAULT_REGION` is a warning via `awsDefaultRegionWarning`, with a bucket set: it is the AWS CLI's and boto's name, and the installed SDK never reads it for the region (checked: with no explicit region `AWS_REGION` resolves to its value and `AWS_DEFAULT_REGION` leaves "Region is missing"; it is consulted only to pick a defaults mode inside an AWS execution environment). So it does nothing even apart from `storage.ts`'s explicit region: the client uses `S3_REGION`, else `us-east-1`, and a bucket anywhere else is addressed in the wrong region. Raised only for a value that differs from the region the client really uses, and left to `awsRegionWarning` when `AWS_REGION` is set too, so it is never said twice; the consequence is worded as a likely one and the value is never repeated. `AWS_PROFILE` is a warning via `awsProfileWarnings`: the SDK's default chain skips the `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` pair whenever it is set (read in the installed `@aws-sdk/credential-provider-node`, and run against it with a throwaway credentials file in `startupChecks.test.ts`), so with both set the profile's keys win, with a profile that is not there there are no credentials at all and no fall-back to the pair, and an empty value counts as unset. The name is used as written, so padding or wrapping quotes name a profile that is not there. The SDK prints its own warning for the first case only when the first backup resolves credentials, and says a future version may prefer the pair. It is raised only with a bucket set, since a developer machine sets `AWS_PROFILE` for other tools, and whether the profile exists in the shared files is not checked: that is the filesystem, not the environment. The name is never repeated. `AWS_ENDPOINT_URL` / `AWS_ENDPOINT_URL_S3` are warnings via `awsEndpointUrlWarnings`, with a bucket set (checked by building the client the way `storage.ts` does and reading the request it would send): the explicit `endpoint` `storage.ts` passes with `S3_ENDPOINT` wins over both, even a broken one, so then they are ignored; without it the client follows `_S3` over the general one (empty is unset) and sends backups there with the bucket in the hostname, because `forcePathStyle` is only turned on with `S3_ENDPOINT`. That a single-host store cannot be reached that way is a guess, so a real `amazonaws.com` host is not flagged. A value the SDK refuses (no scheme, quotes, `ftp:`) fails at the first request, and `AWS_IGNORE_CONFIGURED_ENDPOINT_URLS` turns them off only when exactly `true`. Values are never repeated. `AWS_USE_FIPS_ENDPOINT` is a warning via `awsFipsEndpointWarnings`, with a bucket set (checked by building the client the way `storage.ts` does, which never sets `useFipsEndpoint`, and reading the request it would send): only the exact lower-case `true` turns FIPS on, so `TRUE`, `1`, `yes`, a padded or quoted `true` do nothing and backups go to the ordinary endpoint without a word (`false` and empty are the off switch); `true` with a custom endpoint, whether `S3_ENDPOINT` or an `AWS_ENDPOINT_URL*` variable the `AWS_IGNORE_CONFIGURED_ENDPOINT_URLS=true` flag does not switch off, is refused (`A custom endpoint cannot be combined with FIPS`), and so is a `cn-` `S3_REGION` (`Partition does not support FIPS`), each failing every backup at the first request. Values are never repeated. `AWS_USE_DUALSTACK_ENDPOINT` is a warning via `awsDualstackEndpointWarnings`, with a bucket set (checked the same way, `storage.ts` never setting `useDualstackEndpoint`): only the exact lower-case `true` turns dual-stack on, so `TRUE`, `1`, `yes`, a padded or quoted `true` do nothing and backups go to the ordinary endpoint without a word (`false` and empty are the off switch); `true` with a custom endpoint, whether `S3_ENDPOINT` or an `AWS_ENDPOINT_URL*` variable the `AWS_IGNORE_CONFIGURED_ENDPOINT_URLS=true` flag does not switch off, is refused (`Cannot set dual-stack in combination with a custom endpoint`) and fails every backup at the first request. A China region and FIPS both work with it (unlike FIPS alone with a `cn-` region), so neither is flagged. Values are never repeated. `AWS_S3_US_EAST_1_REGIONAL_ENDPOINT` is a warning via `awsS3UsEast1RegionalEndpointWarning`, with a bucket set: it is the old v2 SDK's switch between the global `s3.amazonaws.com` address and the regional one for us-east-1, and the installed `@aws-sdk/client-s3` never reads it (no installed `@aws-sdk` or `@smithy` package mentions it, and building the client the way `storage.ts` does gives `s3.us-east-1.amazonaws.com` for `legacy`, `regional`, junk and unset alike). So a value does nothing, and `legacy` does not give anyone the global address; that this matters to a firewall or proxy allowing only `s3.amazonaws.com` is a guess about their network, worded as one. Only whether it says `legacy` is reported, never the value. `AWS_EC2_METADATA_DISABLED` is a warning via `awsEc2MetadataDisabledWarning`, with a bucket set: the SDK's credential chain asks the instance metadata service (the EC2 instance role) last and skips it for any value except exactly `false` (checked in the installed `@aws-sdk/credential-provider-node`, and run against a local stand-in for the service that counts requests), so `0`, `FALSE`, `no`, `off`, a padded or a quoted `false` turn the lookup off and no request is made. Only values that read as off are flagged, since `true`, `1` and `yes` do what they look like; it is silent when something else finds the credentials (a complete `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` pair, `AWS_PROFILE`, or an `AWS_CONTAINER_CREDENTIALS_*` address). The consequence, no credentials at the first backup, is worded as one that applies if they are meant to come from an instance role. The value is never repeated. `AWS_CONFIG_FILE` is a warning via `awsConfigFileWarning`, with a bucket set: the SDK reads profiles and role settings from the file it names, uses the path as written (no trimming, no unquoting; only a leading `~/` is expanded, and a relative path is read from the working directory), and treats a file it cannot read as an empty config without an error (checked in the installed `@smithy/core` config loader, and run against it with throwaway files, a throwaway `HOME` and a profile that exists only in the file). So a missing file, a directory, a padded or quoted path, a bare `~` and a `$HOME/...` nothing expanded all find no profile. The check is the one thing that decides it, whether the file the SDK would open can be read (`isReadableFile`: readable and a regular file), so a path that works is never flagged, and a differential test pins that the warning is silent exactly where the SDK finds the profile. It is silent with a complete `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` pair and no `AWS_PROFILE`, because the chain takes the pair before it reads any file; with `AWS_PROFILE` set the consequence is worded as no credentials unless the profile is in the credentials file. The path is never repeated. The unreadable-file test is skipped when run as root, where every file is readable. `AWS_SHARED_CREDENTIALS_FILE` is the same check under its own name via `awsCredentialsFileWarning` (one shared `sharedFileWarning`, so the path rules and the silence conditions cannot drift apart): the same loader, the same treatment of a file it cannot read, and a differential test, run with the keys only in the file, both in a named profile and in the default one. It differs in what is lost: this file is where the default profile's keys live too, so the consequence is worded as no credentials from that file even without `AWS_PROFILE`, unless they come from somewhere else (an instance role or the environment). `AWS_WEB_IDENTITY_TOKEN_FILE` and `AWS_ROLE_ARN` are warnings via `awsWebIdentityWarnings`, with a bucket set: together they exchange a token file for a role's credentials, which is how a Kubernetes service account is given an AWS role (checked in the installed `@aws-sdk/credential-provider-web-identity`, and run against it with a local stand-in for STS that counts the exchanges). With only one of the two set the provider is skipped without an error and no exchange is attempted, so the chain goes on to the instance role; with both set and a token file it cannot read, the read error (`ENOENT`, `EISDIR`) ends the chain there instead of trying another source, so every backup fails with a file error. The path is used as written: no trimming, no unquoting and, unlike `AWS_CONFIG_FILE`, no `~/` expansion. It is silent with a complete `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` pair and no `AWS_PROFILE`, because the chain takes the pair first and never reaches this provider; with `AWS_PROFILE` set a profile that exists is used before it, and whether one exists is not checked, so the consequence carries that exception. The role ARN's shape is not judged, since only STS can say, and neither value is repeated. `AWS_CONTAINER_CREDENTIALS_FULL_URI`, `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` and `AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE` are warnings via `awsContainerCredentialsWarnings`, with a bucket set: with either address set, the last stop of the SDK's credential chain asks it for credentials (ECS and EKS pod identity; checked in the installed `@aws-sdk/credential-provider-http`, and run against it with a local credentials server that records the `Authorization` header). The relative address wins when both are set, so the full one is never used. The full address goes through `new URL`, and one it cannot parse (no scheme, wrapping quotes, a leading `//`) throws `Invalid URL`, which ends the chain instead of moving on, so every backup fails. A parseable one is refused unless it is https or its host is loopback (`localhost`, `127.0.0.0/8`, `[::1]`), the ECS host `169.254.170.2` or the EKS host `169.254.170.23` / `[fd00:ec2::23]`, and a refusal makes no request and ends with no credentials; `containerHostAccepted` mirrors that rule, minus two range checks on the middle parts of a `127.` host that `new URL` has already made unreachable, and a differential test pins the warning to exactly the addresses the SDK uses. Whitespace around the address is trimmed by `new URL` and is fine. The token file is read on every request exactly as written (no trimming, no `~` expansion; a relative path is read from the working directory), and a read error ends the chain. The relative address itself is not judged: its host is fixed. This provider is the last stop, so it is silent with a complete `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` pair and no `AWS_PROFILE`, and with a profile or a web identity role set the consequence carries "unless an earlier source supplies credentials first", since whether those resolve is not checked. No address, path or profile is repeated. `AWS_DEFAULTS_MODE` is a warning via `awsDefaultsModeWarning`, with a bucket set, and the one AWS setting here whose failure takes the whole server down: the SDK takes `auto`, `standard`, `in-region`, `cross-region`, `mobile` or `legacy` (compared after `toLowerCase`) and THROWS on anything else, an empty value included, unlike most settings where empty means unset (checked in the installed `@smithy/core`). The throw is in a promise the client starts itself when it is built and nothing awaits, so it is an unhandled rejection, not an error from `send`: with the `send` inside a `catch`, a long-lived child process still exits with code 1, and this server installs no `unhandledRejection` handler. `storage.ts` builds the client on first use, so a bad value stops the server the first time cloud backup is used and again after every restart. A differential test runs that child process for each value and requires the exit status to match the warning. `ENV.awsDefaultsMode` is deliberately not defaulted to `""` like its neighbours, because an empty value has to be told apart from an absent one. It stays a warning, not a refusal, for the reason `PORT` and `DATABASE_URL` are the only fatal ones: refusing to start would break a deploy that works until someone opens the backup panel. `auto` is accepted and not exercised by the test, since outside AWS it asks the network for the instance region, which depends on where the test runs. The value is never repeated. `AWS_REQUEST_CHECKSUM_CALCULATION` and `AWS_RESPONSE_CHECKSUM_VALIDATION` are warnings via `awsChecksumWarnings`, with a bucket set: the SDK takes `WHEN_SUPPORTED` or `WHEN_REQUIRED` (compared after `toUpperCase`, so any case works) and ignores anything else without an error, falling back to the default `WHEN_SUPPORTED` (checked in the installed `@aws-sdk/client-s3`, and run against it, reading the checksum headers an upload and a download would carry: by default an upload carries `x-amz-checksum-crc32` and `x-amz-sdk-checksum-algorithm`, and only `WHEN_REQUIRED` drops them). So `never`, `false`, `0`, `true`, a padded or a quoted value change nothing, and an operator trying to switch the header off for an S3-compatible store finds it still sent. That a given store refuses the header is a guess about the store; that the value is ignored is certain, so that is what is reported. Empty counts as unset, and the value is never repeated. `AWS_MAX_ATTEMPTS` and `AWS_RETRY_MODE` are warnings via `awsRetryWarnings`, with a bucket set: `storage.ts` passes neither option, so the SDK's environment reading decides (checked in the installed `@smithy/core`, and run against it with a local server answering 503 and counting requests). `AWS_MAX_ATTEMPTS` goes through `parseInt`: a value that is not a number is ignored without an error (the shared config file's `max_attempts`, else the default of 3), a number with a tail is read up to the tail (`1e1` is 1 attempt, not 10; `2.9` is 2), and a negative number is one attempt and no retry, not unlimited; zero is also one attempt but says what it means, so it is not flagged. `AWS_RETRY_MODE` is compared exactly and in lower case: only `adaptive` selects the adaptive strategy, and `ADAPTIVE`, `legacy` and anything else give the standard one without an error. Neither stops a backup working, so the consequence is a retry behaviour nobody asked for; empty counts as unset and the values are never repeated. `BUILT_IN_FORGE_MODEL` is a warning via `forgeModelWarnings`: the name only goes into the JSON body of each request, so nothing can fail on the way out and every claim is a guess about what the provider would say, worded that way. Flagged are what a pasted model id does not have (whitespace inside it, wrapping quotes, a URL, angle brackets, a placeholder word); the alphabet is not judged, since ids run from `gemini-2.5-flash` to `anthropic/claude-3.5-sonnet` to `llama3.2:3b`. The half-configured state `forge.ts` describes is flagged too: `BUILT_IN_FORGE_API_URL` pointing away from the built-in provider with no model set, so the default model is asked of a provider that may not have it. Unset is silent, as is a URL that is the built-in provider's or cannot be read (its own check says so), and the transcription model is not checked. `BUILT_IN_FORGE_API_URL` is a warning via `forgeApiUrlWarning`, judged as the base `forgeUrl()` appends `v1/...` to (checked against Node's fetch on the URL it builds): no scheme or quotes, `ftp://`, credentials, a query or fragment that swallows the appended path, and an `http://` base to a real host; a base already ending in `/v1` is flagged as a guess (the doubled path is certain, the 404 is not), and unset is silent because it means the built-in provider. `OWNER_OPEN_ID` is a warning via `ownerOpenIdWarnings`: `upsertUser` grants the admin role on an exact `openId` match, and `sdk.ts` runs that upsert on every authenticated request, so it applies to email and Google accounts too, and a value that matches nobody promotes nobody in silence. Flagged are whitespace or quotes, more than 64 characters (the `openId` column is `varchar(64)`), an `email:` id that is not the lowercase UUID `emailAuth.ts` generates, and an address (a guess when bare, since a portal id's format is the portal's); unset is silent because it means no owner, and set with no database it has no effect. `BUILT_IN_FORGE_API_KEY` is a warning via `forgeApiKeyWarning`: it goes out as `authorization: Bearer <key>` (checked against Node's fetch on that header, same as the email key), and the server gates on truthiness, so a whitespace-only value counts as set and every request goes out with an empty token; a newline, NUL or non-Latin-1 character throws before anything is sent, while padding is stripped and fine, and quotes, a doubled `Bearer ` and a template word are guesses worded as what they would do; unset is silent because it is the off switch for AI. `BUILT_IN_FORGE_TRANSCRIPTION_MODEL` is a warning via `forgeTranscriptionModelWarnings`, sharing `modelIdProblems` with the chat model: it is a multipart form field, so nothing can fail on the way out and a bad name is only the provider's answer to a voice memo, worded as a guess. Another provider's URL with this unset is deliberately not flagged: `BUILT_IN_FORGE_MODEL` already warns about the URL, and a second warning would be noise for anyone who never records a voice memo. A `VITE_`-prefixed variable named like a credential is a warning via `viteCredentialWarning` (names only, never values; `ENV.viteVariableNames`): a segment of the name after the prefix is `KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `PASSWD`, `CREDENTIAL(S)` or `APIKEY`, except `SITE_KEY`, `PUBLIC_KEY` and `PUBLISHABLE_KEY`, which are public by design. The claim is the exposure waiting for the next read, not a leak today: the client reads none (`clientSecrets.test.ts`), and a build with sentinel values in `VITE_FRONTEND_FORGE_API_KEY` and `VITE_TEST_SECRET` left both out of `dist/`. `DEMO_LIMIT_SALT` is a warning via
`demoSaltWarnings` when under 32 characters, plainly guessable (the
`secretWeaknesses` rules), or set with no database: it keys the HMAC the demo
limit stores in place of an IP address, and with a guessable salt a leaked
`demoSessions` table is reversed by trying all four billion IPv4 addresses
(about twelve core-hours, measured). Unset is the supported off switch. A `PUBLIC_ORIGIN` that cannot work as
one is a warning via `publicOriginWarning`: not an absolute http(s) URL,
credentials in it, a path/query/fragment that every `new URL(path, origin)`
consumer discards, or `http://` on a non-loopback host in production, where
`requireHttps` redirects to the same address forever. The message never repeats
the value. `RENDER_EXTERNAL_URL` is the same check under its own name, raised only when it is the value in use (`ENV.publicOriginVar`): `PUBLIC_ORIGIN` wins when set, and a differing Render URL then is the custom-domain case, so it is silent. Without the name a bad Render value would be reported as a `PUBLIC_ORIGIN` nobody set. `HTTP_PROXY` / `HTTPS_PROXY` are warnings via `outboundProxyWarnings` (names only, never values), and the server reads neither: checked on Node 22.22.0 with axios 1.20.0 against a local proxy, axios (the portal sign-in) follows `HTTP_PROXY` for `http://` addresses and `HTTPS_PROXY` for `https://` ones, either case with the lower-case name first, and honours `NO_PROXY`, while Node's `fetch` (Google, the AI provider, voice, email, reCAPTCHA, notifications) ignores both unless `NODE_USE_ENV_PROXY` is exactly `1` (`true`, `yes`, `0`, `" 1"` and `01` do nothing), and the S3 client's default handler never reads them. So behind a mandatory egress proxy the portal sign-in works and everything else times out, which looks like the providers being down; that, `HTTP_PROXY` without `HTTPS_PROXY` (axios does not use it for `https://` addresses, but `fetch` with the flag falls back to it, so the two stacks disagree), a flag value Node ignores, and a value that is not an `http(s)` URL are what is warned about. With the flag and such a value Node dies at startup before any of our code runs, so that case cannot be warned about here and the docs say so. `startupChecks.test.ts` pins all of it by running child processes against a local proxy, and skips the flag cases on a Node that lacks the flag. `ALL_PROXY` is judged on its own, because the flag does not help it: axios takes it as the fallback for both `http://` and `https://` addresses (either case, `HTTP_PROXY` / `HTTPS_PROXY` win, `NO_PROXY` applies, a bare `host:port` takes the scheme of the address called), but Node's `fetch` never reads it, with or without the flag, so on its own it proxies the portal sign-in and nothing else, and the generic advice to set `NODE_USE_ENV_PROXY=1` would be wrong for it (it needs `HTTPS_PROXY` as well). A value axios cannot use fails every portal sign-in call (junk with `ERR_INVALID_URL`; `ftp:`, `socks4:`, `socks5:` and `socks5h:` with `ERR_ASSERTION` for `http://` addresses, and for `https://` ones axios treats the SOCKS address as an HTTP proxy and the connection fails), and SOCKS is the usual reason `ALL_PROXY` is set, for curl; Node does not crash on it because `fetch` ignores it, so unlike the `HTTP_PROXY` case the warning can be raised. The same child-process tests pin it. `NO_PROXY` is judged by `noProxyWarnings` only when a proxy variable is set, and only for the three addresses the server dials (`OAUTH_SERVER_URL` through axios, `BUILT_IN_FORGE_API_URL` and `EMAIL_API_URL` through fetch): `noProxyExempts` reproduces each stack's matcher (axios: lower-case first, CIDR, loopback names cover each other, `host:port` entries; fetch: neither CIDR nor loopback aliasing) and a differential test runs real axios and `fetch` against it. A wrong entry fails toward the proxy, not toward a direct connection. Flagged are entries neither stack can match (`;`, a scheme, a trailing `/`, an IP prefix), CIDR with the flag, a local address that would still reach the proxy, and a bare parent domain (`example.com` does not match `api.example.com`). Values are never repeated. A `TRUSTED_PROXY_HOPS` that the parse
would read differently from how it looks (non-digits, whitespace, `1e1`) or
above 3 is a warning via `proxyHopsWarning`, which shares
`parseTrustedProxyHops` with `clientAddress` so the warning states what is
actually read. Too low collapses everyone into the proxy's bucket and too high
lets a caller pick their address; the docs once said the reverse. A `NODE_ENV` that is not exactly
`production` or `development` (unset included) is a warning via
`nodeEnvWarning`: every `NODE_ENV` check in the server compares to exactly
`production`, so `prod` or `Production` silently gets the relaxed cookie, HTTPS,
CSP and proxy-hop behaviour. `PORT` is fatal too when set to
anything but plain digits naming 1-65535 (`portProblem`), with or without a
database, because `resolvePort`'s `parseInt` binds `1e3` as port 1 and `0` as a
random port in silence. A `DATABASE_URL` that
cannot work (not a URL, not `mysql:`, no database name) is fatal too, via
`databaseUrlProblem`, because `getDb` swallows drizzle's throw and carries on as
a server with no database; its message never includes any part of the value. It
checks shape and what the driver makes of the `ssl` parameter (`databaseDriverProblem`,
`databaseTlsWarnings`), not reachability. A `VITE_APP_ID` that
cannot be a real id (whitespace, quotes, a URL, `<...>`, `undefined`, a
placeholder name) is a warning via `appIdWeaknesses`, not a refusal: there is no
format to check against, and nothing compares the value after sign-in, so a
wrong one costs portal sign-in alone. A `VITE_OAUTH_PORTAL_URL` the client cannot build a sign-in link from is a warning via `oauthPortalUrlWarning`, and the server never reads it: `client/src/const.ts` builds the link as `new URL(`${value}/app-auth`)` at build time, and the check judges the value that exact way (checked in Node: no scheme, quotes or trailing whitespace throw; `https://` parses as the host `app-auth`; a trailing slash gives `//app-auth`; a query or fragment swallows the appended path; leading whitespace is trimmed and fine), with a test that fails if the client's expression changes. It sees the variable only where the build and the runtime share an environment, as on Render, so it is a warning, not proof of what the bundle holds. Unset is silent because the client logs its own warning. A missing secret is
fatal; a short one (under 32 characters), or a longer one that is plainly
guessable, is only a startup warning (`configWarnings`) that never reports the
value. `secretWeaknesses` looks for a placeholder word, very few distinct
characters, a repeated short pattern and a long consecutive run, with thresholds
set against 50,000 random secrets of each common format (`openssl rand -hex`,
`-base64`, a uuid), none of which it flags. It cannot call a secret strong: a
long passphrase of ordinary words passes. The signer accepts a one-byte key, but
changing the secret signs everyone out and invalidates every two-step
enrolment, so refusing to start could force that on an operator whose deploy
works today.

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
| Invitations to a note              | `server/collab.ts` (`inviteCollaborator`), `pages/SharedWithMe.tsx`, `drizzle/schema.ts`                                |
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
