import { jsPDF } from 'jspdf';
import { Note, Folder } from '@/lib/storage';

/**
 * Export service for converting notes to various formats
 */

/**
 * Export note as Markdown
 */
export function exportAsMarkdown(note: Note): string {
  return `# ${note.title}\n\n${note.content}\n\n---\n\nCreated: ${new Date(note.createdAt).toLocaleString()}\nUpdated: ${new Date(note.updatedAt).toLocaleString()}\nTags: ${note.tags.join(', ') || 'None'}`;
}

/**
 * Export multiple notes as Markdown
 */
export function exportNotesAsMarkdown(notes: Note[]): string {
  return notes
    .map((note) => exportAsMarkdown(note))
    .join('\n\n---\n\n');
}

/**
 * Export note as plain text
 */
export function exportAsPlainText(note: Note): string {
  return `${note.title}\n${'='.repeat(note.title.length)}\n\n${note.content}\n\n---\n\nCreated: ${new Date(note.createdAt).toLocaleString()}\nUpdated: ${new Date(note.updatedAt).toLocaleString()}\nTags: ${note.tags.join(', ') || 'None'}`;
}

/**
 * Export multiple notes as plain text
 */
export function exportNotesAsPlainText(notes: Note[]): string {
  return notes
    .map((note) => exportAsPlainText(note))
    .join('\n\n---\n\n');
}

/**
 * Export note as HTML
 */
export function exportAsHTML(note: Note): string {
  const escapedTitle = escapeHTML(note.title);
  const escapedContent = escapeHTML(note.content);
  const createdDate = new Date(note.createdAt).toLocaleString();
  const updatedDate = new Date(note.updatedAt).toLocaleString();
  const tags = note.tags.join(', ') || 'None';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapedTitle}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1.6;
      color: #333;
      background: #f5f5f5;
      padding: 20px;
    }
    .container {
      max-width: 800px;
      margin: 0 auto;
      background: white;
      padding: 40px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 {
      color: #2c3e50;
      border-bottom: 2px solid #3498db;
      padding-bottom: 10px;
    }
    .metadata {
      font-size: 0.9em;
      color: #666;
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px solid #eee;
    }
    .metadata p {
      margin: 5px 0;
    }
    pre {
      background: #f4f4f4;
      padding: 10px;
      border-radius: 4px;
      overflow-x: auto;
    }
    code {
      background: #f4f4f4;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: 'Courier New', monospace;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>${escapedTitle}</h1>
    <div class="content">
      ${escapedContent.replace(/\n/g, '<br>')}
    </div>
    <div class="metadata">
      <p><strong>Created:</strong> ${createdDate}</p>
      <p><strong>Updated:</strong> ${updatedDate}</p>
      <p><strong>Tags:</strong> ${tags}</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Export note as JSON
 */
export function exportAsJSON(note: Note): string {
  return JSON.stringify(note, null, 2);
}

/**
 * Export multiple notes as JSON
 */
export function exportNotesAsJSON(notes: Note[]): string {
  return JSON.stringify(notes, null, 2);
}

/**
 * Export a note as a PDF document.
 *
 * PDF is binary, so this returns a Blob rather than a string like the other
 * exporters. Use downloadBlob to save it.
 */
export function exportAsPDF(note: Note): Blob {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  renderNoteToPDF(doc, note);
  return doc.output('blob');
}

/**
 * Export multiple notes as a single PDF, one note per page.
 */
export function exportNotesAsPDF(notes: Note[]): Blob {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  notes.forEach((note, index) => {
    if (index > 0) doc.addPage();
    renderNoteToPDF(doc, note);
  });

  return doc.output('blob');
}

const PDF_MARGIN = 56;
const PDF_LINE_HEIGHT = 16;

function renderNoteToPDF(doc: jsPDF, note: Note): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - PDF_MARGIN * 2;
  let y = PDF_MARGIN;

  const writeLines = (lines: string[], lineHeight: number) => {
    for (const line of lines) {
      // Start a new page before writing past the bottom margin, otherwise
      // jsPDF happily draws text off the page where it cannot be read.
      if (y + lineHeight > pageHeight - PDF_MARGIN) {
        doc.addPage();
        y = PDF_MARGIN;
      }
      doc.text(line, PDF_MARGIN, y);
      y += lineHeight;
    }
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  writeLines(doc.splitTextToSize(note.title || 'Untitled', maxWidth), 22);

  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(120);
  writeLines(
    [
      `Created: ${new Date(note.createdAt).toLocaleString()}`,
      `Updated: ${new Date(note.updatedAt).toLocaleString()}`,
      ...(note.tags.length > 0 ? [`Tags: ${note.tags.join(', ')}`] : []),
    ],
    12
  );

  y += 10;
  doc.setFontSize(11);
  doc.setTextColor(0);
  // Blank lines carry paragraph structure, and splitTextToSize drops them, so
  // split on newlines first and measure each paragraph separately.
  for (const paragraph of note.content.split('\n')) {
    if (paragraph.trim() === '') {
      y += PDF_LINE_HEIGHT / 2;
      continue;
    }
    writeLines(doc.splitTextToSize(paragraph, maxWidth), PDF_LINE_HEIGHT);
  }
}

/**
 * Save a Blob to disk. Mirrors downloadFile for binary formats.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Create a downloadable file
 */
export function downloadFile(content: string, filename: string, mimeType: string = 'text/plain'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export note with automatic format detection
 */
export function exportNote(
  note: Note,
  format: 'markdown' | 'plaintext' | 'html' | 'json' = 'markdown'
): string {
  switch (format) {
    case 'markdown':
      return exportAsMarkdown(note);
    case 'plaintext':
      return exportAsPlainText(note);
    case 'html':
      return exportAsHTML(note);
    case 'json':
      return exportAsJSON(note);
    default:
      return exportAsMarkdown(note);
  }
}

/**
 * Helper function to escape HTML special characters
 */
function escapeHTML(text: string): string {
  const map: { [key: string]: string } = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

/**
 * Generate CSV export for multiple notes
 */
export function exportNotesAsCSV(notes: Note[]): string {
  const headers = ['Title', 'Content', 'Tags', 'Created', 'Updated'];
  const rows = notes.map((note) => [
    `"${note.title.replace(/"/g, '""')}"`,
    `"${note.content.replace(/"/g, '""').replace(/\n/g, ' ')}"`,
    `"${note.tags.join(', ')}"`,
    new Date(note.createdAt).toISOString(),
    new Date(note.updatedAt).toISOString(),
  ]);

  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

/**
 * Create a backup of all notes
 */
export function createBackup(notes: Note[], folders: Folder[]): string {
  return JSON.stringify(
    {
      version: '1.0',
      exportDate: new Date().toISOString(),
      notes,
      folders,
    },
    null,
    2
  );
}

/**
 * Get file extension for format
 */
export function getFileExtension(format: string): string {
  const extensions: { [key: string]: string } = {
    markdown: 'md',
    plaintext: 'txt',
    html: 'html',
    json: 'json',
    csv: 'csv',
    pdf: 'pdf',
  };
  return extensions[format] || 'txt';
}

/**
 * Get MIME type for format
 */
export function getMimeType(format: string): string {
  const mimeTypes: { [key: string]: string } = {
    markdown: 'text/markdown',
    plaintext: 'text/plain',
    html: 'text/html',
    json: 'application/json',
    csv: 'text/csv',
    pdf: 'application/pdf',
  };
  return mimeTypes[format] || 'text/plain';
}
