import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Wand2,
  Loader2,
  Copy,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  generateContent,
  generateCompletion,
  summarizeText,
  expandText,
  adjustTone,
  fixGrammar,
  generateSuggestions,
  generateTitleSuggestions,
  extractKeyPoints,
  brainstormIdeas,
} from '@/lib/aiService';
import { toast } from 'sonner';

interface AIAssistantProps {
  selectedText?: string;
  noteContent: string;
  onInsert: (text: string) => void;
}

type AIAction =
  | 'generate'
  | 'complete'
  | 'summarize'
  | 'expand'
  | 'tone'
  | 'grammar'
  | 'suggestions'
  | 'titles'
  | 'keypoints'
  | 'brainstorm';

export function AIAssistant({ selectedText, noteContent, onInsert }: AIAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [action, setAction] = useState<AIAction>('generate');
  const [prompt, setPrompt] = useState('');
  const [tone, setTone] = useState<'formal' | 'casual' | 'friendly' | 'professional' | 'creative'>('professional');
  const [summaryLength, setSummaryLength] = useState<'short' | 'medium' | 'long'>('medium');
  const [result, setResult] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showResult, setShowResult] = useState(false);

  const handleAction = useCallback(async () => {
    setIsLoading(true);
    setShowResult(false);

    try {
      let aiResult = '';

      switch (action) {
        case 'generate':
          aiResult = await generateContent(prompt, noteContent);
          break;
        case 'complete':
          aiResult = await generateCompletion(selectedText || noteContent);
          break;
        case 'summarize':
          aiResult = await summarizeText(selectedText || noteContent, summaryLength);
          break;
        case 'expand':
          aiResult = await expandText(selectedText || noteContent);
          break;
        case 'tone':
          aiResult = await adjustTone(selectedText || noteContent, tone);
          break;
        case 'grammar':
          aiResult = await fixGrammar(selectedText || noteContent);
          break;
        case 'suggestions':
          const suggestions = await generateSuggestions(selectedText || noteContent, noteContent);
          aiResult = suggestions.join('\n');
          break;
        case 'titles':
          const titles = await generateTitleSuggestions(noteContent);
          aiResult = titles.join('\n');
          break;
        case 'keypoints':
          const keypoints = await extractKeyPoints(selectedText || noteContent);
          aiResult = keypoints.map((kp) => `• ${kp}`).join('\n');
          break;
        case 'brainstorm':
          const ideas = await brainstormIdeas(prompt);
          aiResult = ideas.join('\n');
          break;
      }

      setResult(aiResult);
      setShowResult(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'AI request failed');
    } finally {
      setIsLoading(false);
    }
  }, [action, prompt, selectedText, noteContent, tone, summaryLength]);

  const handleInsert = useCallback(() => {
    if (result) {
      onInsert(result);
      toast.success('Content inserted');
      setShowResult(false);
      setResult('');
    }
  }, [result, onInsert]);

  const handleCopy = useCallback(() => {
    if (result) {
      navigator.clipboard.writeText(result);
      toast.success('Copied to clipboard');
    }
  }, [result]);

  return (
    <div className="w-80 bg-card border-l border-border flex flex-col h-full">
      {/* Header */}
      <div
        className="p-4 border-b border-border cursor-pointer hover:bg-muted/50 flex items-center justify-between"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2">
          <Wand2 className="w-5 h-5 text-accent" />
          <h3 className="font-bold text-foreground">AI Assistant</h3>
        </div>
        {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </div>

      {/* Content */}
      {isOpen && (
        <div className="flex-1 overflow-y-auto flex flex-col">
          {/* Action Selection */}
          <div className="p-4 border-b border-border space-y-3">
            <label className="text-xs font-semibold text-muted-foreground">Action</label>
            <Select value={action} onValueChange={(value) => setAction(value as AIAction)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="generate">Generate Content</SelectItem>
                <SelectItem value="complete">Auto-Complete</SelectItem>
                <SelectItem value="summarize">Summarize</SelectItem>
                <SelectItem value="expand">Expand</SelectItem>
                <SelectItem value="tone">Adjust Tone</SelectItem>
                <SelectItem value="grammar">Fix Grammar</SelectItem>
                <SelectItem value="suggestions">Get Suggestions</SelectItem>
                <SelectItem value="titles">Generate Titles</SelectItem>
                <SelectItem value="keypoints">Extract Key Points</SelectItem>
                <SelectItem value="brainstorm">Brainstorm Ideas</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Action-Specific Options */}
          <div className="p-4 border-b border-border space-y-3">
            {(action === 'generate' || action === 'brainstorm') && (
              <>
                <label className="text-xs font-semibold text-muted-foreground">Prompt</label>
                <Textarea
                  placeholder="What would you like to generate?"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  className="text-sm"
                  rows={3}
                />
              </>
            )}

            {action === 'tone' && (
              <>
                <label className="text-xs font-semibold text-muted-foreground">Tone</label>
                <Select value={tone} onValueChange={(value) => setTone(value as any)}>
                  <SelectTrigger className="w-full">
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

            {action === 'summarize' && (
              <>
                <label className="text-xs font-semibold text-muted-foreground">Length</label>
                <Select value={summaryLength} onValueChange={(value) => setSummaryLength(value as any)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="short">Short (1-2 sentences)</SelectItem>
                    <SelectItem value="medium">Medium (2-3 sentences)</SelectItem>
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
              disabled={isLoading || (action === 'generate' && !prompt) || (action === 'brainstorm' && !prompt)}
              className="w-full btn-sketch"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
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
              <label className="text-xs font-semibold text-muted-foreground">Result</label>
              <div className="bg-muted/20 p-3 rounded text-sm whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
                {result}
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleInsert}
                  size="sm"
                  className="flex-1 btn-sketch"
                >
                  Insert
                </Button>
                <Button
                  onClick={handleCopy}
                  size="sm"
                  variant="outline"
                >
                  <Copy className="w-4 h-4" />
                </Button>
                <Button
                  onClick={() => setShowResult(false)}
                  size="sm"
                  variant="outline"
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
