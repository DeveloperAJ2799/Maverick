/**
 * pptxExport.js — Client-side PPTX generation from markdown.
 *
 * Uses pptxgenjs (loaded on demand from /static/lib/pptxgenjs.bundle.min.js).
 * Parses markdown into slides: each H1/H2 becomes a slide title, content below
 * becomes the slide body (bullets, code blocks, tables, paragraphs).
 */
(function (root) {
  'use strict';

  let _pptxReady = null;

  function ensurePptxGen() {
    if (_pptxReady) return _pptxReady;
    if (root.PptxGenJS) return (_pptxReady = Promise.resolve());
    _pptxReady = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/static/lib/pptxgenjs.bundle.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load PPTX library'));
      document.head.appendChild(s);
    });
    return _pptxReady;
  }

  // ── Markdown parser ────────────────────────────────────────────────────

  /**
   * Split markdown into an array of slides.
   * Each slide: { title: string, body: string }
   * Splits on H1 (# ) and H2 (## ) headings. Content before the first
   * heading becomes a title slide with empty body.
   */
  function parseMarkdownToSlides(md) {
    const lines = (md || '').split('\n');
    const slides = [];
    let current = null;

    for (const line of lines) {
      const h1 = line.match(/^# (.+)/);
      const h2 = line.match(/^## (.+)/);
      if (h1 || h2) {
        if (current) slides.push(current);
        current = { title: (h1 ? h1[1] : h2[1]).trim(), bodyLines: [] };
      } else if (current) {
        current.bodyLines.push(line);
      } else {
        // Content before any heading — accumulate into a title slide
        if (line.trim()) {
          if (!current) current = { title: '', bodyLines: [] };
          current.bodyLines.push(line);
        }
      }
    }
    if (current) slides.push(current);

    // If no slides were created, make one from the whole text
    if (slides.length === 0) {
      slides.push({ title: 'Document', bodyLines: lines });
    }

    // If the first slide has no title but has body, use first line as title
    if (slides[0] && !slides[0].title && slides[0].bodyLines.length > 0) {
      slides[0].title = slides[0].bodyLines.shift().trim() || 'Document';
    }

    return slides.map(s => ({ title: s.title, body: s.bodyLines.join('\n') }));
  }

  /**
   * Parse a slide body into structured elements for pptxgenjs.
   * Returns an array of objects: { type, text, level?, fontFace?, fontSize?, bold?, italic?, color? }
   */
  function parseBodyElements(body) {
    const lines = body.split('\n');
    const elements = [];
    let inCodeBlock = false;
    let codeLines = [];

    for (const line of lines) {
      // Fenced code blocks
      if (line.trimStart().startsWith('```')) {
        if (inCodeBlock) {
          elements.push({ type: 'code', text: codeLines.join('\n') });
          codeLines = [];
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
        }
        continue;
      }
      if (inCodeBlock) {
        codeLines.push(line);
        continue;
      }

      const trimmed = line.trim();
      if (!trimmed) continue;

      // Bullet lists
      const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
      if (bulletMatch) {
        elements.push({ type: 'bullet', text: bulletMatch[1], level: 0 });
        continue;
      }

      // Nested bullets
      const nestedBullet = trimmed.match(/^(\s{2,})[-*]\s+(.+)/);
      if (nestedBullet) {
        const level = Math.min(Math.floor(nestedBullet[1].length / 2), 3);
        elements.push({ type: 'bullet', text: nestedBullet[2], level: level });
        continue;
      }

      // Numbered lists
      const numMatch = trimmed.match(/^\d+[.)]\s+(.+)/);
      if (numMatch) {
        elements.push({ type: 'numbered', text: numMatch[1], level: 0 });
        continue;
      }

      // Table rows (| col | col |)
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        // Skip separator rows (|---|---|)
        if (/^\|[\s-:|]+\|$/.test(trimmed)) continue;
        const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());
        elements.push({ type: 'table-row', cells });
        continue;
      }

      // Horizontal rule
      if (/^[-*_]{3,}$/.test(trimmed)) {
        elements.push({ type: 'hr' });
        continue;
      }

      // Regular paragraph
      elements.push({ type: 'text', text: trimmed });
    }

    // Flush any unclosed code block
    if (inCodeBlock && codeLines.length > 0) {
      elements.push({ type: 'code', text: codeLines.join('\n') });
    }

    return elements;
  }

  /**
   * Strip inline markdown formatting and return plain text with style hints.
   * Returns { text, bold, italic }
   */
  function stripInlineMarkdown(text) {
    let bold = false, italic = false;
    // Bold
    text = text.replace(/\*\*(.+?)\*\*/g, (_, m) => { bold = true; return m; });
    // Italic
    text = text.replace(/\*(.+?)\*/g, (_, m) => { italic = true; return m; });
    // Inline code
    text = text.replace(/`(.+?)`/g, '$1');
    // Links [text](url)
    text = text.replace(/\[(.+?)\]\(.+?\)/g, '$1');
    return { text, bold, italic };
  }

  // ── PPTX generation ───────────────────────────────────────────────────

  /**
   * Convert parsed elements into pptxgenjs slide objects.
   */
  function buildSlideContent(elements) {
    const rows = [];

    // Group consecutive table rows into a table
    let tableRows = [];
    for (const el of elements) {
      if (el.type === 'table-row') {
        tableRows.push(el.cells);
        continue;
      }
      // Flush accumulated table rows
      if (tableRows.length > 0) {
        rows.push({ type: 'table', rows: tableRows });
        tableRows = [];
      }

      switch (el.type) {
        case 'text': {
          const { text, bold, italic } = stripInlineMarkdown(el.text);
          rows.push({ type: 'text', text, bold, italic });
          break;
        }
        case 'bullet': {
          const { text } = stripInlineMarkdown(el.text);
          rows.push({ type: 'bullet', text, level: el.level || 0 });
          break;
        }
        case 'numbered': {
          const { text } = stripInlineMarkdown(el.text);
          rows.push({ type: 'numbered', text, level: el.level || 0 });
          break;
        }
        case 'code':
          rows.push({ type: 'code', text: el.text });
          break;
        case 'hr':
          rows.push({ type: 'hr' });
          break;
      }
    }

    // Flush trailing table
    if (tableRows.length > 0) {
      rows.push({ type: 'table', rows: tableRows });
    }

    return rows;
  }

  /**
   * Add a slide to the PptxGenJS presentation.
   */
  function addSlide(pptx, slideData, slideNumber, totalSlides) {
    const slide = pptx.addSlide();

    // Background
    slide.background = { color: 'FFFFFF' };

    // Title
    if (slideData.title) {
      slide.addText(slideData.title, {
        x: 0.5, y: 0.3, w: 9.0, h: 0.7,
        fontSize: 24, fontFace: 'Fira Code',
        color: '333333', bold: true,
      });
    }

    // Slide number
    slide.addText(`${slideNumber} / ${totalSlides}`, {
      x: 8.5, y: 5.2, w: 1.0, h: 0.3,
      fontSize: 8, fontFace: 'Arial',
      color: '999999', align: 'right',
    });

    // Body content
    const content = buildSlideContent(slideData.elements);
    let yPos = 1.1;
    const maxX = 9.0;
    const pageWidth = 10.0;

    for (const item of content) {
      switch (item.type) {
        case 'text': {
          const opts = {
            x: 0.5, y: yPos, w: maxX, h: 0.4,
            fontSize: 14, fontFace: 'Arial',
            color: '333333',
          };
          if (item.bold) opts.bold = true;
          if (item.italic) opts.italic = true;
          slide.addText(item.text, opts);
          yPos += 0.35;
          break;
        }
        case 'bullet': {
          const indent = (item.level || 0) * 0.3;
          slide.addText(item.text, {
            x: 0.5 + indent, y: yPos, w: maxX - indent, h: 0.3,
            fontSize: 13, fontFace: 'Arial',
            color: '333333', bullet: true,
          });
          yPos += 0.28;
          break;
        }
        case 'numbered': {
          const indent = (item.level || 0) * 0.3;
          slide.addText(item.text, {
            x: 0.5 + indent, y: yPos, w: maxX - indent, h: 0.3,
            fontSize: 13, fontFace: 'Arial',
            color: '333333', bullet: { type: 'number' },
          });
          yPos += 0.28;
          break;
        }
        case 'code': {
          const codeLines = item.text.split('\n');
          const h = Math.min(codeLines.length * 0.18 + 0.2, 3.5);
          slide.addText(item.text, {
            x: 0.5, y: yPos, w: maxX, h: h,
            fontSize: 10, fontFace: 'Courier New',
            color: '1a1a1a', fill: { color: 'F5F5F5' },
            paraSpaceAfter: 2,
          });
          yPos += h + 0.1;
          break;
        }
        case 'table': {
          const headerRow = item.rows[0] || [];
          const dataRows = item.rows.slice(1);
          const colCount = headerRow.length || 1;
          const colW = Math.min(maxX / colCount, 3.0);

          const tableRows = [];
          // Header
          tableRows.push(headerRow.map(cell => ({
            text: cell, options: {
              fontSize: 11, fontFace: 'Arial', bold: true,
              color: 'FFFFFF', fill: { color: '4472C4' },
            }
          })));
          // Data rows
          for (const row of dataRows) {
            tableRows.push(row.map(cell => ({
              text: cell, options: {
                fontSize: 10, fontFace: 'Arial', color: '333333',
              }
            })));
          }

          const tableH = Math.min(tableRows.length * 0.3 + 0.2, 3.5);
          slide.addTable(tableRows, {
            x: 0.5, y: yPos, w: maxX,
            fontSize: 10, fontFace: 'Arial',
            border: { pt: 0.5, color: 'CCCCCC' },
            colW: colW,
          });
          yPos += tableH + 0.15;
          break;
        }
        case 'hr':
          slide.addShape(pptx.ShapeType.line, {
            x: 0.5, y: yPos, w: maxX, h: 0,
            line: { color: 'CCCCCC', width: 0.5 },
          });
          yPos += 0.15;
          break;
      }

      // Prevent overflow
      if (yPos > 5.0) break;
    }

    return slide;
  }

  /**
   * Main export function. Call from the export menu.
   * @param {string} markdownText - The document content (markdown)
   * @param {string} filename - Base filename (without extension)
   */
  async function exportAsPptx(markdownText, filename) {
    await ensurePptxGen();

    const pptx = new root.PptxGenJS();
    pptx.author = 'Mavrick';
    pptx.subject = filename;
    pptx.title = filename;

    const slides = parseMarkdownToSlides(markdownText);

    for (let i = 0; i < slides.length; i++) {
      const slideData = {
        title: slides[i].title,
        elements: parseBodyElements(slides[i].body),
      };
      addSlide(pptx, slideData, i + 1, slides.length);
    }

    const safeName = (filename || 'presentation').replace(/[^a-zA-Z0-9_\-. ]/g, '_');
    await pptx.writeFile({ fileName: safeName + '.pptx' });
  }

  // Export to global scope
  root.pptxExport = { exportAsPptx, ensurePptxGen, parseMarkdownToSlides };
})(window);
