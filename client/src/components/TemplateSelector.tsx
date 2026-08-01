import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  noteTemplates,
  NoteTemplate,
  extractPlaceholders,
  suggestPlaceholderValue,
  applyTemplateValues,
} from '@/lib/templates';
import { Search, ArrowRight, X } from 'lucide-react';

interface TemplateSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTemplate: (template: NoteTemplate, customName?: string) => void;
}

export function TemplateSelector({
  isOpen,
  onClose,
  onSelectTemplate,
}: TemplateSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'work' | 'personal' | 'academic'>('all');
  const [previewTemplate, setPreviewTemplate] = useState<NoteTemplate | null>(null);
  const [customName, setCustomName] = useState('');
  const [placeholderValues, setPlaceholderValues] = useState<Record<string, string>>({});

  const placeholders = useMemo(
    () => (previewTemplate ? extractPlaceholders(previewTemplate.content) : []),
    [previewTemplate]
  );

  // Content as it will actually be created, so the preview shows the real thing.
  const resolvedContent = useMemo(
    () => (previewTemplate ? applyTemplateValues(previewTemplate.content, placeholderValues) : ''),
    [previewTemplate, placeholderValues]
  );

  const openPreview = (template: NoteTemplate) => {
    setPreviewTemplate(template);
    // Pre-fill the ones worth guessing at; the rest start blank.
    const suggested: Record<string, string> = {};
    for (const placeholder of extractPlaceholders(template.content)) {
      const value = suggestPlaceholderValue(placeholder);
      if (value) suggested[placeholder] = value;
    }
    setPlaceholderValues(suggested);
  };

  const categories = [
    { id: 'all', label: 'All Templates' },
    { id: 'work', label: 'Work' },
    { id: 'personal', label: 'Personal' },
    { id: 'academic', label: 'Academic' },
  ];

  const filteredTemplates = noteTemplates.filter((template) => {
    const matchesSearch = template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || template.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const handleSelectTemplate = (template: NoteTemplate) => {
    // Substitute here so everything downstream just sees finished content.
    onSelectTemplate(
      { ...template, content: applyTemplateValues(template.content, placeholderValues) },
      customName
    );
    setCustomName('');
    setPlaceholderValues({});
    setPreviewTemplate(null);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      {/* sm: prefix required — DialogContent's own sm:max-w-lg would otherwise
          win and squeeze the three-column grid into 512px. */}
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Choose a Template</DialogTitle>
          <DialogDescription>
            Select a template to get started or create a blank note
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search templates..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-premium pl-10"
            />
          </div>

          {/* Category Filter */}
          <div className="flex gap-2 flex-wrap">
            {categories.map((category) => (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.id as any)}
                className={`px-4 py-2 rounded-lg font-medium transition-all duration-200 ${
                  selectedCategory === category.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card border border-border hover:border-primary/50'
                }`}
              >
                {category.label}
              </button>
            ))}
          </div>

          {/* Templates Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredTemplates.map((template) => (
              <div
                key={template.id}
                className="card-premium cursor-pointer group hover:border-primary/50 transition-all duration-300 flex flex-col"
                onClick={() => openPreview(template)}
              >
                <div className="text-4xl mb-3">{template.icon}</div>
                <h3 className="text-lg font-semibold mb-2">{template.name}</h3>
                <p className="text-sm text-muted-foreground mb-4 flex-1">
                  {template.description}
                </p>
                <Button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectTemplate(template);
                  }}
                  className="btn-premium w-full text-sm gap-2"
                >
                  Use Template
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>

          {filteredTemplates.length === 0 && (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No templates found matching your search.</p>
            </div>
          )}
        </div>

        {/* Preview Modal */}
        {previewTemplate && (
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-card rounded-2xl border border-border max-w-2xl w-full max-h-[80vh] overflow-y-auto">
              <div className="sticky top-0 bg-card border-b border-border p-6 flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold flex items-center gap-3">
                    <span className="text-3xl">{previewTemplate.icon}</span>
                    {previewTemplate.name}
                  </h2>
                  <p className="text-muted-foreground mt-1">{previewTemplate.description}</p>
                </div>
                <button
                  onClick={() => setPreviewTemplate(null)}
                  className="p-2 hover:bg-muted rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                {/* Custom Name Input */}
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Note Name (Optional)</label>
                  <Input
                    placeholder={`e.g., ${previewTemplate.name} - Q1 2026`}
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    className="input-premium"
                  />
                </div>

                {/* Fill in the blanks */}
                {placeholders.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-sm font-semibold">
                      Fill in the blanks{' '}
                      <span className="font-normal text-muted-foreground">
                        — anything left blank stays in the note
                      </span>
                    </label>
                    <div className="grid sm:grid-cols-2 gap-3 max-h-52 overflow-y-auto pr-1">
                      {placeholders.map((placeholder) => (
                        <div key={placeholder} className="space-y-1">
                          <label
                            htmlFor={`placeholder-${placeholder}`}
                            className="text-xs text-muted-foreground"
                          >
                            {placeholder}
                          </label>
                          <Input
                            id={`placeholder-${placeholder}`}
                            value={placeholderValues[placeholder] ?? ''}
                            placeholder={placeholder}
                            onChange={(e) =>
                              setPlaceholderValues((current) => ({
                                ...current,
                                [placeholder]: e.target.value,
                              }))
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Preview */}
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Preview</label>
                  <div className="bg-background rounded-lg p-4 border border-border max-h-64 overflow-y-auto">
                    <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">
                      {resolvedContent.substring(0, 500)}...
                    </pre>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-4">
                  {/* btn-premium-outline never sets a background, so on a
                      Button it just inherited the filled variant — two
                      identical primary buttons side by side. */}
                  <Button
                    variant="outline"
                    onClick={() => setPreviewTemplate(null)}
                    className="flex-1"
                  >
                    Back
                  </Button>
                  <Button
                    onClick={() => handleSelectTemplate(previewTemplate)}
                    className="btn-premium flex-1 gap-2"
                  >
                    Create Note
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
