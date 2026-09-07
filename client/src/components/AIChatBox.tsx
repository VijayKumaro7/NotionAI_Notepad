import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart3,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  CornerDownLeft,
  Lightbulb,
  MessageSquare,
  Pencil,
  PenLine,
  Plus,
  ScrollText,
  Sparkles,
  Square,
  Trash2,
  Wand2,
} from "lucide-react";
import { CHAT_LIMITS, type ChatTurn } from "@shared/chat";
import {
  actionSubject,
  composerState,
  failureMessage,
  fits,
} from "@/lib/chatComposer";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { createInFlight } from "@/lib/inFlight";
import { toast } from "sonner";

const SAVE_CHATS_KEY = "ai-chat-save";

/**
 * The assistant's operations, as the chat box offers them.
 *
 * `action` names an instruction the server holds (server/chat.ts, ACTIONS) —
 * the same arrangement `ai.assist` uses, so a button cannot write the
 * assistant's instructions, only choose from a list the server defines. The
 * enum is checked at compile time by the tRPC client's input type.
 *
 * `needsText` marks the actions that work on something rather than on the
 * conversation: they take the selection when there is one and the note
 * otherwise, and say so rather than running on nothing.
 */
const QUICK_ACTIONS = [
  {
    action: "summarize" as const,
    label: "Summarise chat",
    icon: ScrollText,
    needsText: false,
    prompt: () => "Summarise this conversation.",
  },
  {
    action: "rewrite" as const,
    label: "Rewrite",
    icon: Wand2,
    needsText: true,
    prompt: (text: string) => `Rewrite this:\n\n${text}`,
  },
  {
    action: "explain" as const,
    label: "Explain",
    icon: Sparkles,
    needsText: true,
    prompt: (text: string) => `Explain this:\n\n${text}`,
  },
  {
    action: "analyse" as const,
    label: "Analyse",
    icon: BarChart3,
    needsText: true,
    prompt: (text: string) => `Analyse this:\n\n${text}`,
  },
  {
    action: "brainstorm" as const,
    label: "Brainstorm",
    icon: Lightbulb,
    needsText: true,
    prompt: (text: string) => `Brainstorm ideas about this:\n\n${text}`,
  },
];

interface AIChatBoxProps {
  /** The open note, offered to the assistant as context. */
  noteContent: string;
  /** What the person has highlighted in the editor, if anything. */
  selectedText?: string;
  onInsert: (text: string) => void;
}

export function AIChatBox({
  noteContent,
  selectedText,
  onInsert,
}: AIChatBoxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [useNote, setUseNote] = useState(true);
  /**
   * The saved conversation this transcript belongs to, once there is one. The
   * server answers with it, so a chat becomes saved by being sent rather than
   * by anyone pressing save — and stays null where nothing is stored, which is
   * an installation with no database.
   */
  const [conversationId, setConversationId] = useState<number | null>(null);
  /**
   * Whether to keep transcripts. Notes are encrypted and unreadable by the
   * server; a saved chat is not, so this is a choice rather than a default
   * nobody was told about. Kept per device, like the theme.
   */
  const [saving, setSaving] = useState(
    () => localStorage.getItem(SAVE_CHATS_KEY) !== "off"
  );
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  /**
   * A turn in flight, and the handle that stops it.
   *
   * Not `mutation.isPending`: cancelling needs an AbortSignal per request, and
   * the React hook has nowhere to put one — it builds its own call. The vanilla
   * client under `utils.client` takes one, so the request goes through that and
   * the pending state is kept here instead.
   */
  const [generating, setGenerating] = useState(false);
  const inFlight = useMemo(createInFlight, []);
  /**
   * How to put the box back the way it was before the turn in flight — the
   * transcript without it, and the message back in the composer.
   *
   * Held here because only Stop needs it, and Stop is a button at the top of
   * the component with no view of the turn's own variables. Leaving the
   * restore to the request's catch worked only while a stop was guaranteed to
   * make the request fail, which it is not: a reply already on its way still
   * arrives, and then nothing rejects and nothing is given back.
   */
  const restoreTurn = useRef<(() => void) | null>(null);
  const transcriptEnd = useRef<HTMLDivElement>(null);

  const utils = trpc.useUtils();
  // A protected query, and a 401 from one trips the global unauthorized
  // handler, which would send a demo visitor to the login page.
  const { isAuthenticated } = useAuth();

  const conversations = trpc.ai.chatConversations.useQuery(undefined, {
    retry: false,
    enabled: isAuthenticated,
  });
  const rename = trpc.ai.renameChat.useMutation();
  const remove = trpc.ai.deleteChat.useMutation();

  const saved = conversations.data ?? [];
  const current = saved.find(c => c.id === conversationId);

  const note = noteContent.trim().slice(0, CHAT_LIMITS.noteContext);

  // Worked out before sending and shown, rather than discovered as an error
  // afterwards — see client/src/lib/chatComposer.ts.
  const { noteFits, isFull, draftFits } = composerState({
    draft,
    messages,
    note,
  });
  const attachesNote = useNote && noteFits;

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: "end" });
  }, [messages, generating]);

  useEffect(() => {
    localStorage.setItem(SAVE_CHATS_KEY, saving ? "on" : "off");
  }, [saving]);

  // Closing the note, or the panel, should not leave a request running against
  // a component that is gone — React would warn, and nobody is waiting for it.
  useEffect(
    () => () => {
      inFlight.abandon();
    },
    [inFlight]
  );

  /**
   * Turning saving off detaches from the stored conversation rather than
   * deleting it: what is already saved stays saved, and is still in the list to
   * delete deliberately. From here the transcript is only on this device, and
   * turning saving back on stores it from the beginning.
   */
  /**
   * Walk away from a turn still in flight.
   *
   * Aborting alone is not enough: the request rejects a moment later, and its
   * catch would restore the abandoned conversation's transcript and message
   * into a box that has moved on. Dropping the handle is what makes the
   * identity check in send() say "this turn is nobody's".
   */
  const abandonTurn = useCallback(() => {
    inFlight.abandon();
    // Dropped rather than run: these callers are leaving the conversation on
    // purpose, and putting its message back in the composer would undo the
    // clearing they just asked for. Stop is the one that gives it back.
    restoreTurn.current = null;
    setGenerating(false);
  }, [inFlight]);

  const setSavingChoice = useCallback(
    (next: boolean) => {
      setSaving(next);
      if (!next) {
        // The reply in flight would otherwise come back with a conversation id
        // and re-attach the chat that was just detached — the one combination
        // the procedure refuses, leaving every later turn failing.
        abandonTurn();
        setConversationId(null);
      }
    },
    [abandonTurn]
  );

  const startNewChat = useCallback(() => {
    // A turn still running belongs to the conversation being left behind.
    abandonTurn();
    setMessages([]);
    setDraft("");
    setConversationId(null);
    setRenaming(null);
    setConfirmingDelete(false);
  }, [abandonTurn]);

  const openConversation = useCallback(
    async (id: number) => {
      // Whatever was being written belongs to the conversation being left.
      abandonTurn();
      setRenaming(null);
      setConfirmingDelete(false);
      try {
        const stored = await utils.ai.chatHistory.fetch({ conversationId: id });
        setMessages(stored.map(({ role, content }) => ({ role, content })));
        setConversationId(id);
        setDraft("");
        // Continuing a saved conversation is asking for it to be kept.
        setSaving(true);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not open that chat"
        );
        void conversations.refetch();
      }
    },
    [utils, conversations, abandonTurn]
  );

  /**
   * Stop a turn in flight.
   *
   * The person's message stays in the transcript and the draft is left alone —
   * stopping is "I do not want this answer", not "forget I asked". The request
   * is aborted so the browser is not left holding a connection, though the
   * model call it started is already paid for.
   */
  const stop = useCallback(() => {
    // Letting go as well as aborting: the reply may already be on its way, and
    // a turn the box still holds is one it would write into the transcript
    // when it lands.
    if (!inFlight.abandon()) return;
    restoreTurn.current?.();
    restoreTurn.current = null;
    setGenerating(false);
    // Said here rather than left to the request's catch, which never runs when
    // the reply wins the race.
    toast("Stopped.");
  }, [inFlight]);

  /**
   * Send one turn: a typed question, or an action from the bar above.
   *
   * `action` shapes the reply and lives on the server; `text` is what appears
   * in the transcript, so the conversation reads as what was actually asked.
   */
  const send = useCallback(
    async (
      text: string,
      action: (typeof QUICK_ACTIONS)[number]["action"] | "ask" = "ask"
    ) => {
      const message = text.trim();
      if (!message || generating || isFull) return;

      // Asked with the message about to be sent. An action builds its own from
      // the selection, so whether the draft fitted says nothing about it.
      if (!fits({ message, messages, note: attachesNote ? note : "" })) {
        toast.error(
          "That is too much for one turn. Select a shorter passage, or start a new chat."
        );
        return;
      }

      // The turn goes up before the reply comes back, so the transcript reads
      // as a conversation rather than jumping two messages at a time.
      const history = messages;
      setMessages([...history, { role: "user", content: message }]);
      setDraft("");

      const attempt = inFlight.start();
      // The turn did not happen, so the transcript goes back to what it was
      // and the message returns to the box rather than making someone retype
      // it. Stop and a failed request both want this, from different places.
      const restore = () => {
        setMessages(history);
        setDraft(message);
      };
      restoreTurn.current = restore;
      setGenerating(true);

      try {
        const result = await utils.client.ai.chat.mutate(
          {
            message,
            action,
            // A saved conversation carries its own past; the server reads it
            // and refuses a request that sends both.
            history: conversationId ? [] : history,
            noteContext: attachesNote ? note : undefined,
            conversationId: conversationId ?? undefined,
            save: saving,
          },
          { signal: attempt.signal }
        );

        // Only the turn still being waited on may write to the box. Anything
        // else — a reply arriving after Stop, after New chat, after another
        // conversation was opened, after saving was switched off — would put
        // an answer in a conversation that did not ask the question, and
        // re-set the conversation id that those actions had just cleared.
        if (!inFlight.owns(attempt)) return;

        setMessages(transcript => [
          ...transcript,
          { role: "assistant", content: result.text },
        ]);
        if (result.conversationId !== null) {
          setConversationId(result.conversationId);
          void utils.ai.chatConversations.invalidate();
        }
      } catch (error) {
        // A stop has already put the box back and said so; an unmount has no
        // box left to put anything into.
        if (attempt.signal.aborted) return;

        // Same rule as the reply for a failure: restoring this turn's
        // transcript into a box that has moved on would resurrect a
        // conversation someone just left.
        if (!inFlight.owns(attempt)) return;

        restore();
        toast.error(failureMessage(error));
      } finally {
        // Only the turn still being waited on: a stop followed quickly by a
        // new send must not have the old request switch the new one off.
        if (inFlight.settle(attempt)) {
          restoreTurn.current = null;
          setGenerating(false);
        }
      }
    },
    [
      messages,
      generating,
      isFull,
      attachesNote,
      note,
      conversationId,
      saving,
      utils,
      inFlight,
    ]
  );

  /**
   * Run one of the actions from the bar.
   *
   * The ones that work on text take the selection when there is one and fall
   * back to the note, and say so when there is neither rather than sending an
   * empty request the server would refuse.
   */
  const runAction = useCallback(
    (quick: (typeof QUICK_ACTIONS)[number]) => {
      if (!quick.needsText) {
        if (messages.length === 0) {
          toast.error("There is no conversation to summarise yet");
          return;
        }
        void send(quick.prompt(""), quick.action);
        return;
      }

      const subject = actionSubject(selectedText, note);
      if (!subject) {
        toast.error("Select some text, or write something in the note first");
        return;
      }

      void send(quick.prompt(subject), quick.action);
    },
    [messages, note, selectedText, send]
  );

  const saveTitle = useCallback(async () => {
    const title = renaming?.trim();
    setRenaming(null);
    if (!conversationId || !title || title === current?.title) return;

    try {
      await rename.mutateAsync({ conversationId, title });
      await utils.ai.chatConversations.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Rename failed");
    }
  }, [renaming, conversationId, current, rename, utils]);

  const deleteConversation = useCallback(async () => {
    if (!conversationId) return;

    try {
      await remove.mutateAsync({ conversationId });
      await utils.ai.chatConversations.invalidate();
      startNewChat();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed");
    }
  }, [conversationId, remove, utils, startNewChat]);

  const copy = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  }, []);

  return (
    // `shrink-0` and no `h-full`: this card sits in a scrolling column beside
    // the editor, and a percentage height there lets flexbox compress it until
    // the composer is cut off — the "not saved" line was the first casualty.
    <div className="bg-card border border-border rounded-lg flex flex-col shrink-0 overflow-hidden">
      {/* Header */}
      <div
        className="p-4 border-b border-border cursor-pointer hover:bg-muted/30 flex items-center justify-between gap-2 transition-colors duration-200"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="w-5 h-5 text-accent shrink-0" />
          <h3 className="text-base font-semibold text-foreground truncate">
            {current?.title ?? "Chat"}
          </h3>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {messages.length > 0 && (
            <Button
              size="sm"
              className="btn-notion-secondary"
              aria-label="New chat"
              onClick={event => {
                event.stopPropagation();
                startNewChat();
              }}
            >
              <Plus className="w-4 h-4" />
            </Button>
          )}
          {isOpen ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {isOpen && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Saved conversations */}
          {saved.length > 0 && (
            <div className="p-4 border-b border-border space-y-2">
              <Select
                value={conversationId ? String(conversationId) : ""}
                disabled={generating}
                onValueChange={value => void openConversation(Number(value))}
              >
                <SelectTrigger className="w-full input-notion">
                  <SelectValue placeholder="Saved chats" />
                </SelectTrigger>
                <SelectContent>
                  {saved.map(conversation => (
                    <SelectItem
                      key={conversation.id}
                      value={String(conversation.id)}
                    >
                      {conversation.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {current &&
                (renaming !== null ? (
                  <div className="flex gap-2">
                    <Input
                      value={renaming}
                      autoFocus
                      maxLength={200}
                      onChange={e => setRenaming(e.target.value)}
                      onKeyDown={event => {
                        if (event.key === "Enter") void saveTitle();
                        if (event.key === "Escape") setRenaming(null);
                      }}
                      className="text-sm input-notion"
                    />
                    <Button
                      size="sm"
                      className="btn-notion"
                      aria-label="Save title"
                      onClick={() => void saveTitle()}
                    >
                      <Check className="w-4 h-4" />
                    </Button>
                  </div>
                ) : confirmingDelete ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      Delete this chat for good?
                    </span>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="btn-notion"
                        onClick={() => void deleteConversation()}
                      >
                        Delete
                      </Button>
                      <Button
                        size="sm"
                        className="btn-notion-secondary"
                        onClick={() => setConfirmingDelete(false)}
                      >
                        Keep
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="btn-notion-secondary"
                      onClick={() => setRenaming(current.title)}
                    >
                      <Pencil className="w-4 h-4 mr-2" />
                      Rename
                    </Button>
                    <Button
                      size="sm"
                      className="btn-notion-secondary"
                      onClick={() => setConfirmingDelete(true)}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete
                    </Button>
                  </div>
                ))}
            </div>
          )}

          {/* Transcript */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-40 max-h-96">
            {messages.length === 0 && !generating && (
              <p className="text-sm text-muted-foreground">
                Ask about this note, or anything you are trying to write.
              </p>
            )}

            {messages.map((message, index) => (
              <div
                key={index}
                // Indent, ground and border all differ, so which side a turn
                // came from is legible without reading the label — and the
                // label is there for anyone the colours do not reach.
                className={
                  message.role === "user"
                    ? "ml-6 bg-accent/10 border border-accent/20 rounded-lg p-3"
                    : "mr-2 bg-muted/20 border-l-2 border-l-accent border-y border-r border-border/50 rounded-lg p-3"
                }
              >
                {message.role === "assistant" && (
                  <div className="flex items-center gap-1.5 mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
                    <Sparkles className="w-3 h-3" aria-hidden="true" />
                    AI assistant
                  </div>
                )}
                <p
                  className="text-sm whitespace-pre-wrap break-words text-foreground"
                  aria-label={
                    message.role === "assistant"
                      ? "AI-generated reply"
                      : undefined
                  }
                >
                  {message.content}
                </p>
                {message.role === "assistant" && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    <Button
                      size="sm"
                      className="btn-notion-secondary"
                      onClick={() => onInsert(message.content)}
                    >
                      Insert in note
                    </Button>
                    {/* The other half of the choice: rather than taking the
                        reply as it stands, put it in the composer and work on
                        it before asking again. */}
                    <Button
                      size="sm"
                      className="btn-notion-secondary"
                      onClick={() => setDraft(message.content)}
                    >
                      <PenLine className="w-4 h-4 mr-2" />
                      Edit as draft
                    </Button>
                    <Button
                      size="sm"
                      className="btn-notion-secondary"
                      aria-label="Copy reply"
                      onClick={() => copy(message.content)}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))}

            {generating && (
              <div
                className="flex items-center justify-between gap-3"
                role="status"
                aria-live="polite"
              >
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="flex gap-1" aria-hidden="true">
                    {[0, 1, 2].map(dot => (
                      <span
                        key={dot}
                        className="w-1.5 h-1.5 rounded-full bg-accent motion-safe:animate-bounce"
                        style={{ animationDelay: `${dot * 150}ms` }}
                      />
                    ))}
                  </span>
                  The assistant is writing…
                </span>
                <Button
                  size="sm"
                  className="btn-notion-secondary"
                  onClick={stop}
                >
                  <Square className="w-3 h-3 mr-2" />
                  Stop
                </Button>
              </div>
            )}

            <div ref={transcriptEnd} />
          </div>

          {/* Composer */}
          <div className="p-4 border-t border-border space-y-2">
            {isFull ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  This conversation is as long as the assistant can hold. Start
                  a new one to carry on — this one stays saved.
                </p>
                <Button onClick={startNewChat} size="sm" className="btn-notion">
                  <Plus className="w-4 h-4 mr-2" />
                  New chat
                </Button>
              </div>
            ) : (
              <>
                {/* Ask AI: the assistant's operations, where the conversation
                    is, rather than in a panel someone has to leave the chat
                    for. Wraps to as many rows as the width allows, so the bar
                    survives the 320px column and a phone alike. */}
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_ACTIONS.map(quick => (
                    <button
                      key={quick.action}
                      type="button"
                      disabled={generating}
                      onClick={() => runAction(quick)}
                      title={
                        quick.needsText
                          ? selectedText?.trim()
                            ? "Runs on the selected text"
                            : "Runs on this note"
                          : "Runs on this conversation"
                      }
                      className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/30 px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-accent/10 hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <quick.icon className="w-3.5 h-3.5 text-accent" />
                      {quick.label}
                    </button>
                  ))}
                </div>

                {selectedText?.trim() && (
                  <p className="text-xs text-muted-foreground">
                    Actions will use your selection (
                    {selectedText.trim().length} characters).
                  </p>
                )}

                <Textarea
                  placeholder="Ask the assistant…"
                  value={draft}
                  maxLength={CHAT_LIMITS.message}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={event => {
                    // Enter sends, shift+Enter breaks the line. The reverse
                    // makes a chat box feel like a form.
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send(draft);
                    }
                  }}
                  className="text-sm input-notion"
                  rows={3}
                />

                <div className="flex items-end justify-between gap-2">
                  <div className="space-y-1 min-w-0">
                    {note.length === 0 ? (
                      <span className="block text-xs text-muted-foreground">
                        This note is empty
                      </span>
                    ) : noteFits ? (
                      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                        <input
                          type="checkbox"
                          checked={useNote}
                          onChange={e => setUseNote(e.target.checked)}
                          className="accent-accent"
                        />
                        Use this note as context
                      </label>
                    ) : (
                      // Said out loud rather than dropped quietly: an assistant
                      // answering without the note it was asked about looks
                      // like a bad model, not a size limit.
                      <span className="block text-xs text-muted-foreground">
                        Note too long to include — select a section and paste it
                      </span>
                    )}

                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={saving}
                        onChange={e => setSavingChoice(e.target.checked)}
                        className="accent-accent"
                      />
                      Save this chat
                    </label>
                  </div>

                  <Button
                    onClick={() => void send(draft)}
                    disabled={generating || !draft.trim() || !draftFits}
                    size="sm"
                    className="btn-notion"
                  >
                    {generating ? (
                      <Spinner />
                    ) : (
                      <>
                        <CornerDownLeft className="w-4 h-4 mr-2" />
                        Send
                      </>
                    )}
                  </Button>
                </div>

                {!saving && (
                  // Notes are encrypted and unreadable by the server. A saved
                  // chat is not, which is the whole reason this switch exists,
                  // so it says what off actually means.
                  <p className="text-xs text-muted-foreground">
                    Not saved — this chat stays on this device and is gone when
                    you reload.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
