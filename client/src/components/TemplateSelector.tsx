import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { noteTemplates, NoteTemplate } from '@/lib/templates';
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
    onSelectTemplate(template, customName);
    setCustomName('');
    setPreviewTemplate(null);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
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
                onClick={() => setPreviewTemplate(template)}
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

                {/* Preview */}
                <div className="space-y-2">
                  <label className="text-sm font-semibold">Preview</label>
                  <div className="bg-background rounded-lg p-4 border border-border max-h-64 overflow-y-auto">
                    <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">
                      {previewTemplate.content.substring(0, 500)}...
                    </pre>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3 pt-4">
                  <Button
                    onClick={() => setPreviewTemplate(null)}
                    className="btn-premium-outline flex-1"
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
