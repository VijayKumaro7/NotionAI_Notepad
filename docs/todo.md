# Notion AI Notepad - Project TODO

## Phase 1: Design System & Setup

- [x] Design system with hand-drawn sketch aesthetic (warm cream, charcoal lines, organic shapes)
- [x] Typography setup (bold marker-style headers, monospaced typewriter fonts)
- [x] Global styling and CSS variables for sketch aesthetic
- [x] Create reusable UI component library with sketch design

## Phase 2: Core Note-Taking Features

- [x] Rich text editor with markdown support
- [x] Hierarchical folder and page organization system
- [x] IndexedDB implementation for local browser storage
- [x] Client-side encryption for data security
- [x] Real-time auto-save functionality
- [x] Create, read, update, delete (CRUD) operations for notes

## Phase 3: Search & Organization

- [x] Full-text search across all notes
- [x] Tagging system for notes
- [x] Filter and organize notes by tags
- [x] Search result highlighting and navigation

## Phase 4: AI Capabilities

- [x] AI-powered content generation within notes
- [x] Auto-completion suggestions
- [x] Text summarization feature
- [x] Content expansion feature
- [x] Tone adjustment (formal, casual, friendly, etc.)
- [x] Grammar correction
- [x] Intelligent content suggestions based on context

## Phase 5: Voice & Transcription

- [x] Voice memo recording functionality
- [x] Automatic speech-to-text transcription
- [x] Timestamp markers for voice notes
- [x] Integration of transcribed text into notes

## Phase 6: Export & Cloud Backup

- [x] Export notes to Markdown format
- [x] Export notes to PDF format
- [x] Export notes to plain text format
- [x] Encrypted cloud backup to S3 storage
- [x] Cross-device sync capability
- [x] Disaster recovery mechanism

## Disaster Recovery

- [x] Say what a restore would do before it does any of it
- [x] Keep a newer local note rather than writing the archive over it
- [x] Date what a restore writes, so the next sync does not undo it
- [x] Carry version history and the bin in the archive, not just notes
- [x] Back up on a cadence rather than when somebody remembers
- [x] Prove a stored archive still decrypts, before it is needed
- [x] Say what a backup cannot hold, next to the restore button

## Phase 7: Testing & Optimization

- [x] Unit tests for core functionality
- [x] Integration tests for features

## Two Devices, One Server, A Real Database

- [x] Drive the real encryption, merge and storage together rather than plain objects
- [x] A pulled note arrives readable, with the other device's clock on it
- [x] A conflict writes both versions, and the losing copy lands in the same folder
- [x] A deletion whose tombstone is owed is not resurrected
- [x] A row this browser has no key for is left alone, and harms nothing beside it
- [x] Cover the order `runSync` applies a plan in, by calling it rather than mirroring it

## Deleting A Note While The Server Is Refusing

- [x] Drop the autosave's hold on a note that has been deleted
- [x] Prove a deletion whose tombstone is owed is not undone by the row still there
- [x] Prove it stays deleted across repeated syncs, not just the first
- [x] Wait for the sync the hook starts on mount, rather than racing it

## Testing the Wiring, Not Only the Decisions

- [x] A harness that can render a component and drive a hook
- [x] Cover the sync-to-editor refresh, end to end through the real hook
- [x] Cover the autosave guard on a note the sync installed
- [x] Cover a pending edit being written down before the pull
- [x] Stop merely opening a note re-dating it, and beating a newer edit
- [x] Performance optimization
- [ ] Browser compatibility testing
- [x] Security audit for encryption
- [ ] User experience testing

## Reading A Whole Workspace Without Freezing It

- [x] Measure where the time actually goes before changing anything
- [x] Decrypt a batch of notes together rather than one after another
- [x] Stop the base64 decode costing more than the cryptography it feeds
- [x] Guard both by asserting the shape, not by timing anything

## A Copy Button That Lied

- [x] Confirm real Firefox/Safari runs are blocked here — this sandbox's
      network policy refuses the Playwright browser download, so this is a
      static audit rather than a run
- [x] Find the places a browser API can fail in ways Chromium's default
      config does not surface
- [x] One helper, used everywhere a copy button exists, that says whether it
      actually worked instead of assuming
- [ ] `Browser compatibility testing` stays open — this closed one class of
      finding, not the item

## A Recording Labelled By Assumption, Not By What It Was

- [x] Same method as the copy button: find where this app assumes Chromium's
      behaviour is every browser's. `VoiceMemo.tsx` records with
      `new MediaRecorder(stream)` and no explicit type, then hardcodes the
      resulting Blob as `audio/webm` — true on Chrome and Firefox, false on
      Safari, which has no webm support and records `audio/mp4` instead
- [x] Read `mediaRecorder.mimeType` — the spec-defined, actual negotiated
      type — rather than assuming, for both the Blob label used for playback
      and transcription, and the extension a download is saved under
- [x] The server side was already ready for this: `getFileExtension` in
      `_core/voiceTranscription.ts` has mapped `audio/mp4` to `.m4a` all
      along. Only the client was sending the wrong label
- [x] Prove it: a fake `MediaRecorder` reporting `audio/mp4`, the way Safari's
      would, and assert the download extension and the mimeType sent to
      transcription both follow it rather than staying `.webm` — failing
      against the pre-fix code and passing against the fix
- [ ] `Browser compatibility testing` stays open — two classes closed now
      (clipboard, this one), not the item itself; nothing here rules out a
      third

## A Drag That Never Started, In One Browser Only

- [x] Same method again: `Sidebar.tsx`'s `handleNoteDragStart` and
      `handleFolderDragStart` set `dataTransfer.effectAllowed` and tracked
      the dragged item entirely through React state, but never called
      `dataTransfer.setData`. Chrome does not require that call to begin a
      drag; Firefox does, by spec, and refuses to start the drag at all
      without it — so every drop handler in this file would be unreachable
      there, silently, with nothing to see in a Chromium-only sandbox
- [x] Call `setData` in both — the value itself is never read back, since
      every drop handler already goes through `draggedItem` state, but the
      call has to happen for Firefox to let the drag begin in the first
      place
- [x] First test for this component: render the real `Sidebar`, fire a real
      `dragstart` with a fake `DataTransfer` (jsdom has none), and assert
      `setData` was called for both a note row and a folder row — failing
      against the pre-fix code and passing against the fix
- [ ] `Browser compatibility testing` stays open — three classes closed now
      (clipboard, voice memo mimeType, this one); still not a claim that a
      fourth does not exist

## A Help Dialog That Named The Wrong Key, On Its Own Platform

- [x] A fourth sweep for this sandbox's own sweep found nothing new, so the
      same method was turned on the platform axis instead of the browser
      one: where does this app assume one keyboard is everyone's, the way
      it was assuming one engine was. `lib/shortcuts.ts` already does this
      correctly everywhere — `matchesShortcut` reads `navigator.platform`
      to decide whether "Cmd" means Meta or Control, and `formatKeys`
      renders `⌘`/`Ctrl` to match — except `ShortcutsModal.tsx`'s own
      footer tip, which hardcoded the literal text `Cmd+?` instead of
      calling `formatKeys` like every shortcut row above it does
- [x] Fixed by looking up the `help` shortcut and formatting its keys, with
      the old literal string kept only as a fallback for the case where it
      is not found
- [x] First test for this component: render the real dialog on a stubbed
      `navigator.platform`, and check the footer's own `<kbd>` specifically
      — the shortcut list above it renders the same shortcut's keys too,
      in a plain `<div>`, so a bare text query would have matched both and
      proven nothing. Fails against the pre-fix code (`Cmd+?` on Windows),
      passes against the fix (`Ctrl+?`)

## Profiling The Real Browser Instead Of Guessing From The Code

- [x] Seed a 300-note workspace and take a real CPU profile of a cold reload
- [x] Take one of opening a note and typing in that same workspace
- [x] Check a hypothesis before shipping it — `shared/crdt.ts`'s `encodeUpdate`
      looked like the same base64 anti-pattern already fixed elsewhere;
      benchmarked instead of assumed, and it is already the faster of the two
      shapes at every size tried, so it was left alone
- [x] Conclude honestly: both profiles ran 78–86% idle, no function attributed
      over 2% of sampled time, and the largest single contributor during
      typing was React's own reconciler, not application code. There is
      nothing further to fix that this profiling found — not a claim that
      every scenario was tried, but the two most obvious ones (a cold load
      and typing) came back clean after the decrypt and base64 fixes above

## A Real Browser, At Least One

- [x] Run the actual build in a real engine, not jsdom — nothing else in this repo did
- [x] Prove content is ciphertext on disk in real IndexedDB, not just in a polyfill
- [x] Prove a note survives a real reload, through the real autosave debounce
- [ ] The same, in Firefox and Safari — left undone; only Chromium is installed here

## A Recording That Outlived Its Own Reference

- [x] Find the blob: URL that was created once per recording and never
      revoked — `exportService.ts` and `TwoFactorSettings.tsx` already
      revoke theirs, `VoiceMemo.tsx` never did
- [x] Revoke it wherever the recording is discarded: delete, a successful
      transcription, and unmount — not just where the state setter clears it
- [x] Fold `VoiceMemo`'s own hand-built download anchor into the existing
      `downloadBlob` helper, which appends to the document before clicking;
      the local copy didn't, the same no-op risk `TwoFactorSettings.tsx`
      already documents
- [x] Add the `@vitejs/plugin-react` `vitest.config.ts` was missing — no
      client test had rendered a component with real JSX before, so the gap
      was invisible until this one tried to
- [x] Prove it: `URL.revokeObjectURL` spied on through record → delete,
      record → transcribe, and unmount, each failing against the pre-fix
      component and passing against the fix
- [x] A follow-up review of that fix found two more real paths: a transcribe
      request still in flight after the recording it was transcribing was
      deleted and replaced unconditionally discarded the replacement, and
      unmounting mid-recording (before Stop was ever clicked) left the
      microphone and the one-second timer running with nothing to stop them
- [x] Verified live, not just in jsdom: the real component driven in real
      Chromium via a throwaway dev route, a genuine `MediaRecorder` recording
      fake-device audio, real `URL.createObjectURL`/`revokeObjectURL` spied
      on — create/revoke paired across delete, download and unmount, with no
      orphaned or double-revoked URLs across repeated cycles

## A Reconnect That Outlived The Disconnect That Should Have Stopped It

- [x] `collaborationClient.ts` already carries one fix for "leaving a shared
      note reconnects a second later anyway" — `closedByUs`, checked by the
      close handler before it schedules a reconnect. It only guards the
      synchronous case. A drop that happens moments before `disconnect()` is
      called has already scheduled a reconnect by then, and nothing told
      that pending timer to stop
- [x] `connect()` unconditionally clears `closedByUs` at its own first line
      — written for the legitimate case of a deliberate reconnect after a
      deliberate disconnect — so the stale timer firing later undoes the
      disconnect it was supposed to have no part of, and reopens a socket to
      a room the component has already unmounted out of, with a `doc` that
      may already be destroyed on the other end of its callbacks
- [x] Fixed by keeping the timer's own handle and cancelling it in
      `disconnect()`, the same shape `stopHeartbeat` already uses for its
      `setInterval`
- [x] Proved it: scheduled a reconnect with a close, then called
      `disconnect()` before the backoff elapsed, then advanced the clock a
      full minute — failing against the pre-fix code (a second socket opens
      anyway) and passing against the fix (none does)

## A Help Dialog That Listed Shortcuts Nothing Answered To

- [x] `ShortcutsModal` lists the entire Formatting category — Bold, Italic,
      Underline, Code, Heading 1/2/3, Bullet List, Numbered List, Quote —
      each with a correctly platform-formatted key combo next to it, as
      though pressing it did something. None of them did:
      `useKeyboardShortcuts`'s global handler only lets
      `help`/`command-palette`/`open-search` through while focus sits in an
      `<input>` or `<textarea>`, and `NotesApp.tsx` never registered the rest
      of the Formatting category as handlers regardless — so even focus
      outside the editor wouldn't have helped. The note body is a
      `<textarea>` (`RichTextEditor.tsx`), which is the one place a person
      is actually focused while they'd reach for Cmd+B
- [x] `RichTextEditor.tsx`'s toolbar already had the right action for each
      of these (`insertMarkdown`, wired to each button's `onClick`) — the gap
      was never in what to do, only in reaching it from the keyboard. Added
      a `formattingActions` map, keyed by the same shortcut ids
      `lib/shortcuts.ts` already defines, and pointed both the toolbar
      buttons and a new `onKeyDown` on the textarea at the same functions,
      so the two paths can't drift apart the way two independent copies of
      the same `insertMarkdown` call would
- [x] Heading 3 has no toolbar button — the toolbar only ever offered H1/H2
      — but `ShortcutsModal` still lists it like every other Formatting
      shortcut. Wired it into `formattingActions` anyway, keyboard-only,
      rather than leaving the one shortcut in the category that happens to
      have no button still doing nothing
- [x] The toolbar's own tooltip for Bold/Italic/Underline carried a
      hardcoded `"Ctrl+B"`-style literal that was never actually rendered
      (`title` read `btn.label`, not the dead `shortcut` field) — so it
      wasn't a live bug, but it was the same landmine `ShortcutsModal`'s
      footer tip already was: the day someone wires it up, it is wrong on a
      Mac. Replaced it with a lookup through `formatKeys`, now actually
      rendered, and extended it to every Formatting button rather than only
      the three that happened to have it
- [x] First test for this component: fires a real `keydown` with
      `ctrlKey`/`metaKey` set against a stubbed `navigator.platform`, and
      asserts `onChange` receives the same wrapped text clicking the
      toolbar button would have produced — covering both platforms, the
      keyboard-only Heading 3 case, and that a bare key with no modifier
      does nothing. Fails against the pre-fix code, which had no
      `onKeyDown` on the textarea at all

## A Help Dialog's Promise With Nothing Behind It At All

- [x] Same sweep, one category over: `lib/shortcuts.ts` has declared
      `command-palette` (Cmd+/) since the shortcut list existed,
      `ShortcutsModal` has always listed it with a correct platform-formatted
      key combo, and `useKeyboardShortcuts` even special-cases it to fire
      while typing in a note — the same treatment given to Help and Search.
      Unlike Bold or Italic, nothing was missing a wire: there was no feature
      on the other end of it anywhere in the codebase to wire to
- [x] Built `CommandPalette.tsx` — a small quick-actions dialog, filterable by
      typing, navigable with arrow keys, opened by the shortcut that already
      claimed to open it. Seven actions: New Note, New Folder, Search Notes,
      Version History, Share Note, Toggle Theme, Keyboard Shortcuts — each
      reusing the exact function `NotesApp.tsx` already had for its toolbar
      or its own (now real) keyboard shortcut, not a second copy of the same
      logic
- [x] `new-folder` and `toggle-theme` were two more Navigation/General
      shortcuts `ShortcutsModal` listed with nothing behind them, found while
      building the palette's own action list. Wired both as real global
      shortcuts too — not just reachable through the palette — since showing
      a key combo next to a palette row that does not work when pressed
      directly outside it would have been the same lie at a smaller scale
- [x] An action the palette cannot usefully run is left out of the list
      entirely, not shown disabled: Share Note and Version History need a
      note open, and hiding them is more honest than a greyed-out row inviting
      a click that would open a dialog with nothing in it
- [x] First test for this component: filtering, arrow-key navigation with
      wraparound, Enter running the selected command, click running the
      clicked one, the dialog resetting on reopen, and the shortcut hint
      reading `Ctrl+N`/`⌘N` by platform like everywhere else in the app
- [x] Verified live in real Chromium against the production build: opened
      the palette with Ctrl+/ from inside the note editor itself — the one
      case the fix is actually for — filtered down to "New Folder", ran it
      with Enter, and confirmed a folder actually landed in IndexedDB and the
      palette closed
- [x] `delete-note` (Cmd+Delete) was the one Editing-category shortcut left
      in the same advertised-but-unwired state after the palette's own two
      finds. Wired it to the same `removeNote` the sidebar's delete button
      already calls — soft-delete, so there is a Recently Deleted net under
      it the same as every other way of deleting a note
- [x] `undo`/`redo` (Cmd+Z / Cmd+Shift+Z) were left unwired here because their
      state lives private inside `RichTextEditor.tsx`; wired in a follow-up
      (see "Undo And Redo, Reached From The Keyboard" below)
- [x] Verified live in real Chromium against the production build: opened a
      note, clicked outside any input, pressed Ctrl+Delete, and confirmed the
      note count in IndexedDB dropped by one and the editor closed — the
      exact shape `removeNote` already produces from the sidebar's own
      delete button

## Undo And Redo, Reached From The Keyboard

- [x] Handle `undo` and `redo` in the textarea's `onKeyDown`, through the same
      functions the toolbar buttons call — focus is in the textarea whenever
      these keys are pressed, so no ref has to cross the component boundary
- [x] Refresh the character and word counts on undo and redo, which left them
      showing the pre-undo text
- [x] Prove it: Ctrl+Z / Ctrl+Shift+Z and Cmd+Z through a stateful harness,
      the empty-history case, and the counts — three of the four fail against
      the pre-fix component
- [ ] Not wired when focus is outside the editor; nothing is lost, the keys do
      nothing there

## A Save Shortcut That Only Said It Saved

- [x] `save` (Cmd+S) was a bare "Note saved" toast over a two-second autosave
      debounce, so it announced a write that may not have happened — and
      would have announced it even if the write then failed
- [x] Hand the debounce's flush to the page as `saveNow`, resolving to whether
      the write landed, and toast the answer; nothing pending counts as saved
- [x] Prove it through the real hook: an edit still inside the window reaches
      the store, nothing pending resolves true, and a failing write resolves
      false with the error set and the stored text untouched
- [ ] Not verified in a real browser; only the jsdom hook tests were run

## A Restore That Depends On An Ordering Nobody Tested

- [x] Read the path rather than assume it: `restoreDeletedNote` pushes nothing,
      so a restored note survives only if the next sync reads it as newer than
      the tombstone and, when the tombstone is still owed, sends the tombstone
      before the note
- [x] Prove it through the real hook against a stateful fake server that follows
      the real procedure's semantics: tombstone landed, tombstone still owed,
      and a second sync after both
- [x] No bug found. The tests pin the behaviour; moving `flushOwed` after the
      `plan.push` loop makes two of the three fail
- [x] The gap this left — a restore not pushed until the next sync — is closed
      in "A Restore That Is Told To The Server" below

## A Full-Height Layout Taller Than The Screen It Is On

- [x] Same sweep as the clipboard, voice memo and drag finds, on the mobile
      axis: `h-screen` is `100vh`, which on mobile browsers includes the area
      behind the collapsing URL bar, so a fixed-height shell with its own
      scrolling regions is taller than the visible screen and its bottom is
      clipped
- [x] Swap `h-screen` for `h-dvh` in the app shell and the shared-note view
      (five places, including their loading states so the page does not change
      height when it loads); leave `min-h-screen` pages alone, which scroll
- [x] Checked in real Chromium at 390x664, 390x844 and 1280x720: the shell is
      exactly the viewport tall and the page does not overflow; `pnpm test:e2e`
      still passes
- [ ] Not verified on a real phone: headless Chromium has no collapsing URL
      bar, so `dvh` and `vh` are equal there and the clipping itself cannot be
      reproduced here
- [ ] `Browser compatibility testing` stays open — four classes closed now

## A Backup That Could Be Of Nothing, Or One Edit Short

- [x] Follow the "success message without checking" thread from Cmd+S to the
      backup paths: `handleBackup`, `runCloudBackup`, the restore preview and
      the account export all read notes through `getAllNotesForExport`
- [x] It read the store directly, so an edit inside the two-second autosave
      window was missing from the file; it now writes the pending edit first
- [x] It swallowed a read failure into `[]`, which became a successful backup of
      zero notes, a cloud archive that reset the backup schedule, a restore plan
      with nothing to displace, and an empty "download everything" above the
      delete-account button; it now throws, and each caller's existing failure
      message is finally true
- [x] Prove it through the real hook: an in-window edit is included, a failing
      read rejects instead of returning `[]`, and an edit that cannot be saved
      rejects instead of being left out; all three fail against the old code
- [ ] Not exercised through the UI buttons themselves, only the hook

## A Restore That Is Told To The Server

- [x] `restoreDeletedNote` now pushes the restored note straight away through
      `pushNoteToServer`, instead of leaving the server to find out at the next
      sync: another device stops showing the note as deleted at once
- [x] It also replaces a tombstone the first attempt never landed. A successful
      push clears what was owed for the note, a failed one records the note as
      owed in place of the deletion, so no stale tombstone is left to be flushed
      at the server ahead of the note
- [x] Prove it through the real hook, with no sync in between: the server holds
      the note after a restore when the tombstone had landed, and when it was
      still owed the queue empties and the server never sees the tombstone; both
      fail against the old code
- [x] Check what the change did to the guard written last time: the mutation
      that moved `flushOwed` after the note pushes no longer fails anything,
      because the restore no longer leaves a tombstone to flush in the wrong
      order. The older tests are outcome checks now and their comments say so
- [ ] Not exercised through the Recently Deleted panel, only the hook

## An Undo History That Followed You To The Next Note

- [x] Found while reading what the new Cmd+Z could reach: `RichTextEditor` has no
      `key` and is never remounted, so its undo history (state) belonged to the
      first note it showed. Switching notes, typing and pressing Cmd+Z wrote the
      previous note's text into the new one
- [x] Reproduced in real Chromium, not only in jsdom: undo in a second note gave
      the first note's `alpha one`; the same run on the fix gives the second
      note's own starting text
- [x] `noteId` prop (required) resets the history when it changes, done during
      render so the new note never renders against the old history
- [x] The character and word counts were state only the editor's own typing
      updated, so AI inserts, voice transcription, restored versions and sync
      left them stale; derived from `content` now
- [x] Prove it: three component tests (no undo into the previous note, nothing to
      undo right after a switch, counts follow content changed from outside),
      all failing against the old component
- [ ] Undo still steps over an external change (an AI insertion is not its own
      history entry); left alone, it is the pre-existing shape and nothing is
      written into the wrong note

## A Transcription That Overwrote What You Typed While It Ran

- [x] Looked for the editor's bug (component mounted once, state from the first
      note) in the other panels: `VoiceMemo` is mounted once too, and a
      transcription takes seconds
- [x] `handleVoiceTranscription` built the new content from `currentNote.content`
      as of the click, and `updateCurrentNote` applies a patch to whichever note
      is current when it runs. Typing in the note while it transcribed, or
      switching notes, meant the reply replaced the note's content with the old
      text plus the transcript, and autosave then saved it
- [x] `updateCurrentNote` accepts a function handed the latest note; the voice
      handler appends through it, so nothing typed in the meantime is lost
- [x] `VoiceMemo` takes the note's id (required) and does not insert a
      transcription whose note is no longer open; the recording is kept and a
      message says why
- [x] Prove it: the updater sees content set a moment earlier in the same batch,
      and a transcription that lands after the note changed is not inserted,
      while one for the same note is; both new behaviours fail against the old
      code
- [ ] Not exercised through `NotesApp` itself, only the two pieces it connects.
      A real recording needs a microphone and the transcription needs a server
- [ ] The AI assistant and chat insert on a click, from the current closure, so
      they do not have this shape; checked by reading, not by a test

## A Selection The Assistant Kept After It Was Gone

- [x] Followed the assistant's `selectedText || noteContent` back to where
      `selectedText` comes from: a page-wide `mouseup` reading
      `window.getSelection()`
- [x] Mouse-only (a Shift+arrow selection never arrived; one edited away stayed),
      never cleared on a note switch (note B could be rewritten from note A's
      selection), and documented not to report text inside a `<textarea>` in
      Firefox
- [x] `RichTextEditor` reports the selection from its own textarea's `select`
      event via `onSelectionChange`; `NotesApp.tsx` clears it on a note change
      and the page-wide handler is gone
- [x] Prove it: reports the selected range, reports empty once it collapses,
      and needs no listener; the first two fail against the old component
- [ ] Not reproduced in Firefox (Chromium only here), and not seen in a real
      browser at all: the AI column is signed-in only and the browser suite runs
      in local mode
- [ ] The clearing on a note switch is an effect in `NotesApp.tsx` with no test
      of its own

## Completed Features

### Core Infrastructure

- Hand-drawn sketch aesthetic design system with warm cream, charcoal, and organic shapes
- Custom typography with Caveat (marker-style headers) and JetBrains Mono (code)
- IndexedDB database with AES-GCM encryption for secure local storage
- Auto-save functionality with 2-second debounce

### Note Management

- Rich text editor with markdown toolbar (bold, italic, headings, lists, code, quotes, links)
- Undo/redo functionality with history management
- Character and word count display
- Hierarchical folder organization with create/edit/delete operations
- Full-text search across all notes and folders
- Note tagging system for organization

### AI Features

- Content generation from prompts
- Auto-completion suggestions
- Text summarization (short/medium/long options)
- Content expansion
- Tone adjustment (formal, casual, friendly, professional, creative)
- Grammar and spelling correction
- Intelligent suggestions based on context
- Title generation
- Key point extraction
- Brainstorming ideas

### Voice & Transcription

- Voice memo recording with duration tracking
- Audio playback and download
- Automatic transcription with timestamp markers
- Integration of transcribed text into notes

### Export & Backup

- Export to Markdown format
- Export to plain text format
- Export to HTML format
- Export to JSON format
- CSV export for multiple notes
- Full backup creation with metadata
- Automatic filename generation with timestamps

### Testing

- Comprehensive unit tests for storage operations
- Encryption/decryption tests
- Export service tests
- All tests passing successfully

## UI Redesign - Notion-like Modern Theme

- [x] Update color scheme to dark theme with cool accent colors
- [x] Redesign sidebar with Notion-style hierarchy and smooth interactions
- [x] Modernize editor toolbar with icon-based controls
- [x] Add smooth animations and transitions throughout
- [x] Update AI assistant panel styling
- [x] Update voice memo component styling
- [x] Implement Notion-like drag-and-drop for notes/folders
- [x] Add smooth page transitions and loading states

## Drag-and-Drop Implementation

- [x] Add order field to notes and folders schema
- [x] Create drag-and-drop event handlers
- [x] Implement visual feedback during drag operations
- [x] Add drop zone detection and reordering logic
- [x] Persist reorder changes to IndexedDB
- [x] Add smooth animations for reordered items
- [x] Test cross-folder drag operations
- [x] Test nested folder drag operations

## Premium UI/UX Redesign

- [x] Create sophisticated landing page with compelling homepage
- [x] Implement Sign-In/Log-Out authentication functionality
- [x] Build Dark Mode toggle with persistent theme storage
- [x] Create subscription model showcase with pricing tiers
- [x] Build templates sneak peek section with high-quality examples
- [x] Enhance overall visual design with premium aesthetics
- [x] Add smooth animations and transitions
- [x] Implement responsive design for all screen sizes

## Quick-Start Note/Project Creation

- [x] Add quick-start buttons on landing page for creating notes and projects
- [x] Create template selection modal with preview
- [x] Implement template initialization with pre-filled content
- [x] Add smooth transitions between landing page and editor
- [x] Create project plan template with sections and structure
- [x] Create meeting notes template with agenda and action items
- [x] Create daily journal template with prompts
- [x] Add ability to start from blank note
- [x] Implement auto-save for newly created notes
- [x] Add template customization options

## Recently Deleted Feature

- [x] Update storage schema to track deleted notes with timestamps
- [x] Implement soft delete functionality for notes
- [x] Create Recently Deleted folder UI component
- [x] Add restore note functionality
- [x] Add permanent delete functionality
- [x] Implement 30-day auto-cleanup for expired deleted notes
- [x] Add visual indicators for deletion date and restore deadline
- [x] Create tests for Recently Deleted feature

## Version History Feature

- [x] Update storage schema with versions store and metadata
- [x] Implement automatic version snapshot creation on edits
- [x] Create version history UI component with timeline
- [x] Implement version comparison and diff view
- [x] Add version preview functionality
- [x] Implement version restore with confirmation
- [x] Add change summary generation
- [x] Create tests for version history functionality

## Collaborative Sharing Feature

- [x] Update storage schema with sharing and permissions
- [x] Implement sharing link generation with unique tokens
- [x] Create Share modal UI with permission controls
- [x] Build shared note access validation
- [x] Implement permission enforcement (view/comment/edit)
- [x] Add comment system for collaborative feedback
- [x] Create shared notes view for recipients
- [x] Implement access revocation and link expiry
- [x] Add sharing history and activity log
- [x] Create tests for sharing functionality

## Sync That Says What It Is Doing

- [x] Remember pushes the server did not take, and send them again
- [x] Sync on returning to the tab and on the network coming back, not once per load
- [x] Retry on a slow beat while something is owed, and stay silent when nothing is
- [x] Flush owed pushes before pulling, so a pending deletion is not resurrected
- [x] Header indicator: synced, syncing, or how many changes are waiting and why
- [x] Name the sidebar's icon-only delete and expand controls

## Taking Your Data With You

- [x] Read every saved conversation back out, past the sidebar's 50-row cap
- [x] account.export, ownership-guarded by shape and rate limited
- [x] One archive of notes, folders and chats, with a manifest of what it omits
- [x] Keep "could not ask" apart from "none saved"
- [x] Put the download directly above the delete button

## Account Deletion

- [x] Erase every row an account owns, backups and S3 objects included
- [x] Require the strongest proof the account has (code, else password)
- [x] Rate limit deletion attempts per account
- [x] Account panel with a danger zone and a typed confirmation phrase
- [x] Offer to erase the browser's own copy, without assuming it
- [x] State what deletion does and does not do, on the privacy page

## Keyboard Shortcuts Feature

- [x] Create keyboard shortcuts configuration
- [x] Implement keyboard event listeners
- [x] Build help modal UI with shortcut categories
- [x] Add Cmd+? shortcut to open help modal
- [x] Implement Cmd+N for new note
- [x] Implement Cmd+/ for command palette
- [x] Implement Cmd+S for save
- [x] Add keyboard shortcut indicators to UI
- [x] Create tests for keyboard shortcuts

## Real-Time Collaboration Feature

- [x] Set up WebSocket server infrastructure
- [x] Implement presence tracking and user sessions
- [x] Build live cursor position tracking
- [x] Create presence indicators UI component
- [x] Implement real-time content synchronization
- [x] Add conflict resolution for simultaneous edits
- [x] Build operational transformation (OT) for concurrent editing
- [x] Create live cursor display with user colors
- [x] Implement session management and cleanup
- [x] Add tests for real-time collaboration

## Apple-Inspired UI Redesign & Resources

- [x] Generate product screenshots and demo images
- [x] Create tutorial and how-to guide images
- [x] Redesign landing page with Apple-style animations
- [x] Implement parallax scrolling effects
- [x] Add scroll-triggered animations
- [x] Create resources section with tutorials
- [x] Add product showcase gallery
- [x] Implement smooth page transitions
- [x] Add advanced micro-interactions
- [x] Optimize animations for performance

## Stopping the Stylesheet From Overruling the Call Site

- [x] Move `.btn-notion*`, `.input-notion` and `.editor-*` into `@layer components`
- [x] Make the button classes self-sufficient so they need no shadcn `Button` underneath
- [x] Render the 50 notion buttons as plain `<button>` elements
- [x] Add `.btn-notion-sm` and `.btn-notion-destructive` for the states the cva variants carried
- [x] Give `Input`, `Textarea` and `SelectTrigger` a `variant="notion"` instead of a class fight
- [x] Drop the two `!important` workarounds the trap had forced
- [x] Prove it inert by diffing computed styles in Chromium, light and dark
- [x] One rule the audit missed, found later: `.container` — both the base
      definition and its own 768px override — sat unlayered at the bottom of
      the file the whole time. Nothing currently writes `className="container"`
      anywhere, so it changed nothing visible; moved into `@layer components`
      alongside `.btn-notion`, consolidated with its responsive override, so
      the day something does use it, a call-site utility wins rather than
      losing silently. Confirmed in the built CSS that cascade layer order is
      `base < components < utilities`, so `@layer components` is correctly
      outranked by any Tailwind utility class, same as `.btn-notion` already is

## Never Losing the Other Side of an Edit

- [x] Record what this device and the server last agreed, per note
- [x] Detect a real conflict instead of picking a winner on the clock
- [x] Keep the losing version as a note of its own rather than overwriting it
- [x] Pull before flushing, so an owed push cannot erase the other version first
- [x] Record the baseline on direct pushes, so a pending push is not read as a conflict
- [x] Say when the server holds notes this browser has no key for
- [x] Key portability, so a second device can read its own notes at all
- [x] Refresh the open editor when a sync replaces the note being looked at

## The Note You Are Looking At

- [x] Persist the debounced edit locally before the pull, so the merge can see it
- [x] Refresh the open editor when the merge replaced its note
- [x] Close it when the merge deleted it, instead of autosaving it back
- [x] Keep what is being typed when the store is behind

## Carrying the Key to Another Device

- [x] Read the key bytes out without making the live key extractable
- [x] A checksummed phrase that catches every single-character typo and transposition
- [x] Re-encrypt this device's notes, deleted notes and versions onto an imported key
- [x] Leave untouched anything the old key cannot open — it is what the new key is for
- [x] Reveal, copy and download the phrase from the account panel
- [x] Say in the export manifest where the key is, now that there is somewhere
- [x] Encrypt version history at rest, so it can travel too

## Version History That Is Actually Encrypted

- [x] Encrypt the snapshot, and set `isEncrypted` from what was done to it
- [x] Fix restore, which threw on every encrypted note and did nothing
- [x] Read the plaintext rows already in people's browsers rather than dropping them
- [x] Refuse to restore a snapshot this browser cannot read, instead of writing base64 over the note
- [x] Decrypt the preview, so it is not a screen of base64
- [x] Carry version history onto an imported key with everything else

## An Insertion That Found The Editor By Searching The Page

- [x] `handleAIInsert` read the cursor from `document.querySelector("textarea")`,
      the first textarea in the document; correct only while the editor renders
      first
- [x] The editor reports its range with the selection; `NotesApp` keeps it per
      note and `insertAtRange` splices it into the latest content, clamped, with
      append as the fallback
- [x] Prove it: `insertText.test.ts` (cursor, selection, none, stale range,
      reversed range) and the editor's reported range
- [ ] A latent hazard, not a live bug: nothing failed before, so there is no
      failing-before test for the old code path
- [ ] Not exercised through `NotesApp` or in a real browser; the AI column is
      signed-in only
