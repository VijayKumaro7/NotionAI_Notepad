import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
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
  Wand2,
  Copy,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface AIAssistantProps {
  selectedText?: string;
  noteContent: string;
  onInsert: (text: string) => void;
}

type AIAction =
  | "generate"
  | "complete"
  | "summarize"
  | "expand"
  | "tone"
  | "grammar"
  | "suggestions"
  | "titles"
  | "keypoints"
  | "brainstorm";

export function AIAssistant({
  selectedText,
  noteContent,
  onInsert,
}: AIAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [action, setAction] = useState<AIAction>("generate");
  const [prompt, setPrompt] = useState("");
  const [tone, setTone] = useState<
    "formal" | "casual" | "friendly" | "professional" | "creative"
  >("professional");
  const [summaryLength, setSummaryLength] = useState<
    "short" | "medium" | "long"
  >("medium");
  const [result, setResult] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showResult, setShowResult] = useState(false);

  const assist = trpc.ai.assist.useMutation();

  const handleAction = useCallback(async () => {
    // Whichever the operation reads: the selection if there is one, the whole
    // note otherwise. 'generate' and 'brainstorm' work from the typed prompt
    // instead, and 'titles' always considers the whole note.
    const subject = selectedText || noteContent;

    // The server rejects empty input, and a clear message here beats a
    // validation error from a procedure the person did not know they called.
    const needsSubject = !["generate", "brainstorm"].includes(action);
    if (needsSubject && !subject.trim()) {
      toast.error("Write something first, or select the text to work on");
      return;
    }
    if (!needsSubject && !prompt.trim()) {
      toast.error("Describe what you want first");
      return;
    }

    setIsLoading(true);
    setShowResult(false);

    try {
      const { text } = await assist.mutateAsync(
        action === "generate"
          ? { kind: "generate", prompt, context: noteContent || undefined }
          : action === "brainstorm"
            ? { kind: "brainstorm", topic: prompt }
            : action === "summarize"
              ? { kind: "summarize", text: subject, length: summaryLength }
              : action === "tone"
                ? { kind: "tone", text: subject, tone }
                : action === "suggestions"
                  ? {
                      kind: "suggestions",
                      text: subject,
                      context: noteContent || undefined,
                    }
                  : action === "titles"
                    ? { kind: "titles", text: noteContent }
                    : { kind: action, text: subject }
      );

      setResult(text);
      setShowResult(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AI request failed");
    } finally {
      setIsLoading(false);
    }
  }, [action, prompt, selectedText, noteContent, tone, summaryLength, assist]);

  const handleInsert = useCallback(() => {
    if (result) {
      onInsert(result);
      toast.success("Content inserted");
      setShowResult(false);
      setResult("");
    }
  }, [result, onInsert]);

  const handleCopy = useCallback(() => {
    if (result) {
      navigator.clipboard.writeText(result);
      toast.success("Copied to clipboard");
    }
  }, [result]);

  return (
    <div className="bg-card border border-border rounded-lg flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="p-4 border-b border-border cursor-pointer hover:bg-muted/30 flex items-center justify-between transition-colors duration-200"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-accent" />
          <h3 className="font-semibold text-foreground">AI Assistant</h3>
        </div>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        )}
      </div>

      {/* Content */}
      {isOpen && (
        <div className="flex-1 overflow-y-auto flex flex-col">
          {/* Action Selection */}
          <div className="p-4 border-b border-border space-y-3">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Action
            </label>
            <Select
              value={action}
              onValueChange={value => setAction(value as AIAction)}
            >
              <SelectTrigger className="w-full input-notion">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="generate">✨ Generate Content</SelectItem>
                <SelectItem value="complete">→ Auto-Complete</SelectItem>
                <SelectItem value="summarize">📝 Summarize</SelectItem>
                <SelectItem value="expand">📖 Expand</SelectItem>
                <SelectItem value="tone">🎭 Adjust Tone</SelectItem>
                <SelectItem value="grammar">✓ Fix Grammar</SelectItem>
                <SelectItem value="suggestions">💡 Get Suggestions</SelectItem>
                <SelectItem value="titles">📌 Generate Titles</SelectItem>
                <SelectItem value="keypoints">🎯 Extract Key Points</SelectItem>
                <SelectItem value="brainstorm">🧠 Brainstorm Ideas</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Action-Specific Options */}
          <div className="p-4 border-b border-border space-y-3">
            {(action === "generate" || action === "brainstorm") && (
              <>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Prompt
                </label>
                <Textarea
                  placeholder="What would you like to generate?"
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  className="text-sm input-notion"
                  rows={3}
                />
              </>
            )}

            {action === "tone" && (
              <>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Tone
                </label>
                <Select
                  value={tone}
                  onValueChange={value => setTone(value as any)}
                >
                  <SelectTrigger className="w-full input-notion">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="formal">Formal</SelectItem>
                    <SelectItem value="casual">Casual</SelectItem>
                    <SelectItem value="friendly">Friendly</SelectItem>
                    <SelectItem value="professional">Professional</SelectItem>
                    <SelectItem value="creative">Creative</SelectItem>
                  </SelectContent>
                </Select>
              </>
            )}

            {action === "summarize" && (
              <>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Length
                </label>
                <Select
                  value={summaryLength}
                  onValueChange={value => setSummaryLength(value as any)}
                >
                  <SelectTrigger className="w-full input-notion">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="short">Short (1-2 sentences)</SelectItem>
                    <SelectItem value="medium">
                      Medium (2-3 sentences)
                    </SelectItem>
                    <SelectItem value="long">Long (3-5 sentences)</SelectItem>
                  </SelectContent>
                </Select>
              </>
            )}
          </div>

          {/* Action Button */}
          <div className="p-4 border-b border-border">
            <Button
              onClick={handleAction}
              disabled={
                isLoading ||
                (action === "generate" && !prompt) ||
                (action === "brainstorm" && !prompt)
              }
              className="w-full btn-notion"
            >
              {isLoading ? (
                <>
                  <Spinner className="mr-2" />
                  Processing...
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4 mr-2" />
                  Generate
                </>
              )}
            </Button>
          </div>

          {/* Result */}
          {showResult && result && (
            <div className="flex-1 p-4 space-y-3 overflow-y-auto">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Result
              </label>
              <div className="bg-muted/20 p-3 rounded-lg text-sm whitespace-pre-wrap break-words max-h-48 overflow-y-auto border border-border/50">
                {result}
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleInsert}
                  size="sm"
                  className="flex-1 btn-notion"
                >
                  Insert
                </Button>
                <Button
                  onClick={handleCopy}
                  size="sm"
                  className="btn-notion-secondary"
                >
                  <Copy className="w-4 h-4" />
                </Button>
                <Button
                  onClick={() => setShowResult(false)}
                  size="sm"
                  className="btn-notion-secondary"
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
