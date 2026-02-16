import React, { useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Heading2,
  Code,
  Quote,
  Link2,
  Undo2,
  Redo2,
} from 'lucide-react';

interface RichTextEditorProps {
  content: string;
  onChange: (content: string) => void;
  placeholder?: string;
  readOnly?: boolean;
}

export function RichTextEditor({
  content,
  onChange,
  placeholder = 'Start typing your note...',
  readOnly = false,
}: RichTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<string[]>([content]);
  const historyIndexRef = useRef<number>(0);

  const insertMarkdown = useCallback(
    (before: string, after: string = '') => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selectedText = content.substring(start, end);
      const newContent =
        content.substring(0, start) +
        before +
        selectedText +
        after +
        content.substring(end);

      onChange(newContent);

      // Restore cursor position
      setTimeout(() => {
        if (textarea) {
          const newCursorPos = start + before.length + selectedText.length;
          textarea.setSelectionRange(newCursorPos, newCursorPos);
          textarea.focus();
        }
      }, 0);
    },
    [content, onChange]
  );

  const handleUndo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      historyIndexRef.current--;
      onChange(historyRef.current[historyIndexRef.current]);
    }
  }, [onChange]);

  const handleRedo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current++;
      onChange(historyRef.current[historyIndexRef.current]);
    }
  }, [onChange]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newContent = e.target.value;
      onChange(newContent);

      // Add to history
      if (newContent !== historyRef.current[historyIndexRef.current]) {
        historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
        historyRef.current.push(newContent);
        historyIndexRef.current++;
      }
    },
    [onChange]
  );

  // Update history when content changes externally
  useEffect(() => {
    if (content !== historyRef.current[historyIndexRef.current]) {
      historyRef.current = [content];
      historyIndexRef.current = 0;
    }
  }, [content]);

  return (
    <div className="flex flex-col h-full bg-card rounded-lg sketch-border">
      {/* Toolbar */}
      {!readOnly && (
        <div className="flex flex-wrap gap-1 p-3 border-b border-border bg-muted/20 rounded-t-lg">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => insertMarkdown('**', '**')}
            title="Bold (Ctrl+B)"
            className="h-8 w-8 p-0"
          >
            <Bold className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => insertMarkdown('*', '*')}
            title="Italic (Ctrl+I)"
            className="h-8 w-8 p-0"
          >
            <Italic className="w-4 h-4" />
          </Button>
          <div className="w-px bg-border mx-1" />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => insertMarkdown('# ')}
            title="Heading"
            className="h-8 w-8 p-0"
          >
            <Heading2 className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => insertMarkdown('- ')}
            title="Bullet List"
            className="h-8 w-8 p-0"
          >
            <List className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => insertMarkdown('1. ')}
            title="Numbered List"
            className="h-8 w-8 p-0"
          >
            <ListOrdered className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => insertMarkdown('`', '`')}
            title="Code"
            className="h-8 w-8 p-0"
          >
            <Code className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => insertMarkdown('> ')}
            title="Quote"
            className="h-8 w-8 p-0"
          >
            <Quote className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => insertMarkdown('[', '](url)')}
            title="Link"
            className="h-8 w-8 p-0"
          >
            <Link2 className="w-4 h-4" />
          </Button>
          <div className="w-px bg-border mx-1" />
          <Button
            size="sm"
            variant="ghost"
            onClick={handleUndo}
            title="Undo"
            className="h-8 w-8 p-0"
            disabled={historyIndexRef.current === 0}
          >
            <Undo2 className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleRedo}
            title="Redo"
            className="h-8 w-8 p-0"
            disabled={historyIndexRef.current === historyRef.current.length - 1}
          >
            <Redo2 className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Editor */}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={handleChange}
        placeholder={placeholder}
        readOnly={readOnly}
        className="flex-1 p-4 bg-card text-foreground placeholder-muted-foreground resize-none focus:outline-none font-mono text-sm leading-relaxed"
        spellCheck="true"
      />

      {/* Character count */}
      <div className="px-4 py-2 text-xs text-muted-foreground border-t border-border">
        {content.length} characters • {content.split(/\s+/).filter(Boolean).length} words
      </div>
    </div>
  );
}
