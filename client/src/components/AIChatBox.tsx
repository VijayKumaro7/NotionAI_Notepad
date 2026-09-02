import { useCallback, useEffect, useRef, useState } from "react";
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
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  CornerDownLeft,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { CHAT_LIMITS, chatPayloadSize, type ChatTurn } from "@shared/chat";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

const SAVE_CHATS_KEY = "ai-chat-save";

interface AIChatBoxProps {
  /** The open note, offered to the assistant as context. */
  noteContent: string;
  onInsert: (text: string) => void;
}

export function AIChatBox({ noteContent, onInsert }: AIChatBoxProps) {
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
  const transcriptEnd = useRef<HTMLDivElement>(null);

  const utils = trpc.useUtils();
  // A protected query, and a 401 from one trips the global unauthorized
  // handler, which would send a demo visitor to the login page.
  const { isAuthenticated } = useAuth();

  const conversations = trpc.ai.chatConversations.useQuery(undefined, {
    retry: false,
    enabled: isAuthenticated,
  });
  const chat = trpc.ai.chat.useMutation();
  const rename = trpc.ai.renameChat.useMutation();
  const remove = trpc.ai.deleteChat.useMutation();

  const saved = conversations.data ?? [];
  const current = saved.find(c => c.id === conversationId);

  const note = noteContent.trim().slice(0, CHAT_LIMITS.noteContext);

  // The server refuses an oversized request rather than dropping the oldest
  // turns, so the three states a conversation can be in are worked out here and
  // shown, instead of being discovered as an error after pressing send.
  const withNote = chatPayloadSize({
    message: draft,
    history: messages,
    noteContext: note,
  });
  const withoutNote = chatPayloadSize({ message: draft, history: messages });

  const noteFits = note.length > 0 && withNote <= CHAT_LIMITS.total;
  const isFull =
    messages.length >= CHAT_LIMITS.turns || withoutNote > CHAT_LIMITS.total;
  const attachesNote = useNote && noteFits;

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: "end" });
  }, [messages, chat.isPending]);

  useEffect(() => {
    localStorage.setItem(SAVE_CHATS_KEY, saving ? "on" : "off");
  }, [saving]);

  /**
   * Turning saving off detaches from the stored conversation rather than
   * deleting it: what is already saved stays saved, and is still in the list to
   * delete deliberately. From here the transcript is only on this device, and
   * turning saving back on stores it from the beginning.
   */
  const setSavingChoice = useCallback((next: boolean) => {
    setSaving(next);
    if (!next) setConversationId(null);
  }, []);

  const startNewChat = useCallback(() => {
    setMessages([]);
    setDraft("");
    setConversationId(null);
    setRenaming(null);
    setConfirmingDelete(false);
    chat.reset();
  }, [chat]);

  const openConversation = useCallback(
    async (id: number) => {
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
    [utils, conversations]
  );

  const send = useCallback(async () => {
    const message = draft.trim();
    if (!message || chat.isPending || isFull) return;

    // The turn goes up before the reply comes back, so the transcript reads as
    // a conversation rather than jumping two messages at a time.
    const history = messages;
    setMessages([...history, { role: "user", content: message }]);
    setDraft("");

    try {
      const result = await chat.mutateAsync({
        message,
        // A saved conversation carries its own past; the server reads it and
        // refuses a request that sends both.
        history: conversationId ? [] : history,
        noteContext: attachesNote ? note : undefined,
        conversationId: conversationId ?? undefined,
        save: saving,
      });
      setMessages(transcript => [
        ...transcript,
        { role: "assistant", content: result.text },
      ]);
      if (result.conversationId !== null) {
        setConversationId(result.conversationId);
        void utils.ai.chatConversations.invalidate();
      }
    } catch (error) {
      // The message goes back in the box: it was never answered, and retyping
      // it would be the second annoyance after the failure itself.
      setMessages(history);
      setDraft(message);
      toast.error(error instanceof Error ? error.message : "Chat failed");
    }
  }, [
    draft,
    messages,
    chat,
    isFull,
    attachesNote,
    note,
    conversationId,
    saving,
    utils,
  ]);

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
          <h3 className="font-semibold text-foreground truncate">
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
            {messages.length === 0 && !chat.isPending && (
              <p className="text-sm text-muted-foreground">
                Ask about this note, or anything you are trying to write.
              </p>
            )}

            {messages.map((message, index) => (
              <div
                key={index}
                className={
                  message.role === "user"
                    ? "ml-6 bg-accent/10 border border-accent/20 rounded-lg p-3"
                    : "mr-2 bg-muted/20 border border-border/50 rounded-lg p-3"
                }
              >
                <p className="text-sm whitespace-pre-wrap break-words text-foreground">
                  {message.content}
                </p>
                {message.role === "assistant" && (
                  <div className="flex gap-2 mt-2">
                    <Button
                      size="sm"
                      className="btn-notion-secondary"
                      onClick={() => onInsert(message.content)}
                    >
                      Insert
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

            {chat.isPending && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner />
                Thinking…
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
                      void send();
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
                    onClick={() => void send()}
                    disabled={chat.isPending || !draft.trim()}
                    size="sm"
                    className="btn-notion"
                  >
                    {chat.isPending ? (
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
