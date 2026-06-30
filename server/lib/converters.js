'use strict';

// Convert between the three content model shapes so that any uploaded
// format can be downloaded as Word, PowerPoint, or Excel.
//
// Content models:
//   blocks  = [{ type: 'heading'|'paragraph', text, level? }]  → Word/PDF/TXT
//   slides  = [{ title, bullets: [string], notes? }]            → PowerPoint
//   sheets  = [{ name, rows: [[cell, ...], ...] }]              → Excel

// ── blocks → slides ──────────────────────────────────────────
// Each heading starts a new slide (becomes the title).
// Paragraphs between headings become bullets on that slide.
function blocksToSlides(blocks) {
  const slides = [];
  let current = null;

  for (const b of blocks) {
    if (b.type === 'heading') {
      if (current) slides.push(current);
      current = { title: b.text || '', bullets: [], notes: '' };
    } else {
      if (!current) current = { title: '', bullets: [], notes: '' };
      if (b.text && b.text.trim()) {
        current.bullets.push(b.text.trim());
      }
    }
  }
  if (current) slides.push(current);

  // If we ended up with zero slides (e.g. a file with only paragraphs and
  // no headings), make one slide with all text as bullets.
  if (slides.length === 0 && blocks.length > 0) {
    slides.push({
      title: 'Content',
      bullets: blocks.map((b) => b.text || '').filter(Boolean),
      notes: '',
    });
  }

  return slides;
}

// ── blocks → sheets ──────────────────────────────────────────
// Simple two-column layout: Type | Content
function blocksToSheets(blocks) {
  const rows = [['Type', 'Content']];
  for (const b of blocks) {
    rows.push([
      b.type === 'heading' ? `Heading ${b.level || 1}` : 'Paragraph',
      b.text || '',
    ]);
  }
  return [{ name: 'Content', rows }];
}

// ── slides → blocks ──────────────────────────────────────────
// Each slide title becomes a heading, bullets become paragraphs.
function slidesToBlocks(slides) {
  const blocks = [];
  for (const s of slides) {
    if (s.title) {
      blocks.push({ type: 'heading', text: s.title, level: 1 });
    }
    for (const bullet of s.bullets || []) {
      blocks.push({ type: 'paragraph', text: bullet });
    }
  }
  return blocks;
}

// ── slides → sheets ──────────────────────────────────────────
// Three columns: Slide # | Title | Bullets (joined with newlines)
function slidesToSheets(slides) {
  const rows = [['Slide', 'Title', 'Content', 'Notes']];
  slides.forEach((s, i) => {
    rows.push([
      String(i + 1),
      s.title || '',
      (s.bullets || []).join('\n'),
      s.notes || '',
    ]);
  });
  return [{ name: 'Slides', rows }];
}

// ── sheets → blocks ──────────────────────────────────────────
// Each sheet becomes a heading, then each row becomes a paragraph
// with cells joined by " | ".
function sheetsToBlocks(sheets) {
  const blocks = [];
  for (const sheet of sheets) {
    blocks.push({ type: 'heading', text: sheet.name || 'Sheet', level: 1 });
    for (const row of sheet.rows || []) {
      const line = row.map((c) => String(c ?? '')).join(' | ');
      if (line.trim()) {
        blocks.push({ type: 'paragraph', text: line });
      }
    }
  }
  return blocks;
}

// ── sheets → slides ──────────────────────────────────────────
// Each sheet becomes a slide. First row is treated as column headers
// (mentioned in the title), remaining rows become bullets.
function sheetsToSlides(sheets) {
  const slides = [];
  for (const sheet of sheets) {
    const rows = sheet.rows || [];
    const headers = rows[0] || [];
    const dataRows = rows.slice(1);

    const title = sheet.name || 'Data';
    const bullets = dataRows.map((row) =>
      row
        .map((cell, i) => {
          const header = headers[i] ? `${headers[i]}: ` : '';
          return `${header}${cell ?? ''}`;
        })
        .join('  •  ')
    );

    slides.push({ title, bullets, notes: '' });
  }
  return slides;
}

module.exports = {
  blocksToSlides,
  blocksToSheets,
  slidesToBlocks,
  slidesToSheets,
  sheetsToBlocks,
  sheetsToSlides,
};
