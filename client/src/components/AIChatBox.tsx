import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  CornerDownLeft,
  MessageSquare,
  Plus,
} from "lucide-react";
import { CHAT_LIMITS, chatPayloadSize, type ChatTurn } from "@shared/chat";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

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
  const transcriptEnd = useRef<HTMLDivElement>(null);

  const chat = trpc.ai.chat.useMutation();

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

  const startNewChat = useCallback(() => {
    setMessages([]);
    setDraft("");
    chat.reset();
  }, [chat]);

  const send = useCallback(async () => {
    const message = draft.trim();
    if (!message || chat.isPending || isFull) return;

    // The turn goes up before the reply comes back, so the transcript reads as
    // a conversation rather than jumping two messages at a time. `history` is
    // what was on screen before it — the server appends `message` itself.
    const history = messages;
    setMessages([...history, { role: "user", content: message }]);
    setDraft("");

    try {
      const { text } = await chat.mutateAsync({
        message,
        history,
        noteContext: attachesNote ? note : undefined,
      });
      setMessages(current => [
        ...current,
        { role: "assistant", content: text },
      ]);
    } catch (error) {
      // The message goes back in the box: it was never answered, and retyping
      // it would be the second annoyance after the failure itself.
      setMessages(history);
      setDraft(message);
      toast.error(error instanceof Error ? error.message : "Chat failed");
    }
  }, [draft, messages, chat, isFull, attachesNote, note]);

  const copy = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  }, []);

  return (
    <div className="bg-card border border-border rounded-lg flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="p-4 border-b border-border cursor-pointer hover:bg-muted/30 flex items-center justify-between transition-colors duration-200"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2">
          <MessageSquare className="w-5 h-5 text-accent" />
          <h3 className="font-semibold text-foreground">Chat</h3>
        </div>
        <div className="flex items-center gap-2">
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
                  a new one to carry on — the note stays as it is.
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

                <div className="flex items-center justify-between gap-2">
                  {note.length === 0 ? (
                    <span className="text-xs text-muted-foreground">
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
                    // answering without the note it was asked about looks like
                    // a bad model, not a size limit.
                    <span className="text-xs text-muted-foreground">
                      Note too long to include — select a section and paste it
                    </span>
                  )}

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
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
