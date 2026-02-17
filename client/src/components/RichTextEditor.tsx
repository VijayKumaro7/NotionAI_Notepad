import React, { useRef, useCallback, useState } from 'react';
import {
  Bold,
  Italic,
  Underline,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Code,
  Quote,
  Link,
  Undo2,
  Redo2,
  MoreHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface RichTextEditorProps {
  content: string;
  onChange: (content: string) => void;
  placeholder?: string;
}

export function RichTextEditor({
  content,
  onChange,
  placeholder = 'Start typing...',
}: RichTextEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [history, setHistory] = useState<string[]>([content]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [charCount, setCharCount] = useState(content.length);
  const [wordCount, setWordCount] = useState(content.split(/\s+/).filter(Boolean).length);

  const updateContent = useCallback(
    (newContent: string) => {
      onChange(newContent);
      setCharCount(newContent.length);
      setWordCount(newContent.split(/\s+/).filter(Boolean).length);

      // Update history
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(newContent);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    },
    [history, historyIndex, onChange]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateContent(e.target.value);
    },
    [updateContent]
  );

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

      updateContent(newContent);

      // Restore cursor position
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(
          start + before.length,
          start + before.length + selectedText.length
        );
      }, 0);
    },
    [content, updateContent]
  );

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      onChange(history[newIndex]);
    }
  }, [history, historyIndex, onChange]);

  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      onChange(history[newIndex]);
    }
  }, [history, historyIndex, onChange]);

  const toolbarButtons = [
    {
      icon: Bold,
      label: 'Bold',
      onClick: () => insertMarkdown('**', '**'),
      shortcut: 'Ctrl+B',
    },
    {
      icon: Italic,
      label: 'Italic',
      onClick: () => insertMarkdown('*', '*'),
      shortcut: 'Ctrl+I',
    },
    {
      icon: Underline,
      label: 'Underline',
      onClick: () => insertMarkdown('__', '__'),
      shortcut: 'Ctrl+U',
    },
    { divider: true },
    {
      icon: Heading1,
      label: 'Heading 1',
      onClick: () => insertMarkdown('# ', ''),
    },
    {
      icon: Heading2,
      label: 'Heading 2',
      onClick: () => insertMarkdown('## ', ''),
    },
    { divider: true },
    {
      icon: List,
      label: 'Bullet List',
      onClick: () => insertMarkdown('- ', ''),
    },
    {
      icon: ListOrdered,
      label: 'Numbered List',
      onClick: () => insertMarkdown('1. ', ''),
    },
    { divider: true },
    {
      icon: Code,
      label: 'Code',
      onClick: () => insertMarkdown('`', '`'),
    },
    {
      icon: Quote,
      label: 'Quote',
      onClick: () => insertMarkdown('> ', ''),
    },
    { divider: true },
    {
      icon: Undo2,
      label: 'Undo',
      onClick: undo,
      disabled: historyIndex === 0,
    },
    {
      icon: Redo2,
      label: 'Redo',
      onClick: redo,
      disabled: historyIndex === history.length - 1,
    },
  ];

  return (
    <div className="flex flex-col h-full bg-card rounded-lg border border-border overflow-hidden">
      {/* Toolbar */}
      <div className="editor-toolbar">
        {toolbarButtons.map((btn, idx) => {
          if ('divider' in btn) {
            return (
              <div
                key={`divider-${idx}`}
                className="h-6 w-px bg-border/50 mx-1"
              />
            );
          }

          const Icon = btn.icon;
          return (
            <Button
              key={btn.label}
              size="sm"
              variant="ghost"
              onClick={btn.onClick}
              disabled={btn.disabled}
              title={btn.label}
              className="editor-toolbar-button"
            >
              <Icon className="w-4 h-4" />
            </Button>
          );
        })}
      </div>

      {/* Editor */}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={handleChange}
        placeholder={placeholder}
        className="editor-textarea flex-1"
        spellCheck="true"
      />

      {/* Footer Stats */}
      <div className="flex items-center justify-between px-4 py-2 bg-card/50 border-t border-border text-xs text-muted-foreground">
        <div className="flex gap-4">
          <span>{charCount} characters</span>
          <span>{wordCount} words</span>
        </div>
        <div className="text-xs">
          💡 Tip: Use **bold**, *italic*, # heading, - list
        </div>
      </div>
    </div>
  );
}
