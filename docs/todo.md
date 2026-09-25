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
- [x] Cover the order `runSync` applies a plan in, which these tests mirror rather than call

## Testing the Wiring, Not Only the Decisions

- [x] A harness that can render a component and drive a hook
- [x] Cover the sync-to-editor refresh, end to end through the real hook
- [x] Cover the autosave guard on a note the sync installed
- [x] Cover a pending edit being written down before the pull
- [x] Stop merely opening a note re-dating it, and beating a newer edit
- [ ] Performance optimization
- [ ] Browser compatibility testing
- [x] Security audit for encryption
- [ ] User experience testing

## A Real Browser, At Least One

- [x] Run the actual build in a real engine, not jsdom — nothing else in this repo did
- [x] Prove content is ciphertext on disk in real IndexedDB, not just in a polyfill
- [x] Prove a note survives a real reload, through the real autosave debounce
- [ ] The same, in Firefox and Safari — left undone; only Chromium is installed here

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
