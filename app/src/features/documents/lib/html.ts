/**
 * The document HTML layer.
 *
 * Every exported report, worksheet, answer key and study guide is built as an
 * HTML string first and only then rasterised into a PDF. These are the shared
 * pieces of that string: escaping, the two small table "visuals", the
 * Markdown-ish text converter, the branded wrapper and the print stylesheet.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx:1755-1783 and :1900.
 *
 * ---------------------------------------------------------------------------
 * Why this stays HTML on React Native
 * ---------------------------------------------------------------------------
 *
 * There is no DOM here and nothing below touches one. These functions only
 * build strings; the string is handed to a renderer that does own a document -
 * html2canvas on web, expo-print's WebView on native - by the documents wave.
 * That is the reason the layout is done with `<table>` rather than flexbox or
 * grid: it is the one construct both rasterisers lay out identically, and the
 * PDF is meant to look the same wherever it was produced.
 *
 * Everything user-supplied goes through `htmlEscape`. The strings interpolated
 * without it are literals from this file, plus mastery percentages already
 * clamped to a number.
 */

/** Escape the five characters that could otherwise close a tag or an attribute. */
export function htmlEscape(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c,
  );
}

/**
 * Tidy raw OCR output before a teacher is asked to validate it.
 *
 * Vision models wrap their answer in a fenced code block, pad table cells and
 * emit runs of blank lines; none of that is in the answer sheet. Line breaks
 * are preserved because question boundaries depend on them - only horizontal
 * whitespace is collapsed.
 */
export function normalizeOcrText(value: string): string {
  return String(value || '')
    .replace(/```(?:text|markdown)?/gi, '')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/\s*([|¦•·])\s*/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

/**
 * The evidence -> insight -> action banner that heads every branded document.
 * It is a standing reminder that the AI output is a draft: the middle step says
 * "draft", the last says "approve before use".
 */
export function documentFlowVisual(): string {
  return `<table class="visual-flow" role="presentation"><tr><td><b>1 · EVIDENCE</b><small>Teacher review required</small></td><td class="arrow">→</td><td><b>2 · INSIGHT</b><small>Draft learning diagnosis</small></td><td class="arrow">→</td><td><b>3 · ACTION</b><small>Approve before use</small></td></tr></table>`;
}

/**
 * One labelled mastery bar. The colour is inlined rather than classed because
 * it varies per row, and the value is clamped to 0-100 so a bad percentage
 * cannot draw a bar past the edge of the page.
 */
export function masteryVisual(label: string, value: number): string {
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  const colour = safe >= 80 ? '#2d7a45' : safe <= 35 ? '#b63d34' : '#d58a10';
  return `<table class="mastery-visual" role="presentation"><tr><td class="visual-label">${htmlEscape(label)}</td><td class="bar-track"><span style="display:block;width:${safe}%;height:12px;background:${colour}">&nbsp;</span></td><td class="visual-value">${safe}%</td></tr></table>`;
}

/**
 * Plain text - OCR output, a generated question paper, a marking scheme - as
 * document HTML.
 *
 * It recognises only what the model actually emits: ATX headings up to three
 * deep, numbered questions ("4.", "Q4)", "Question 4."), and `**bold**`. A
 * blank line closes an open list and leaves a small vertical gap. Anything else
 * becomes a paragraph.
 */
export function textToDocumentHtml(value: string): string {
  const lines = String(value || '')
    .replace(/\r/g, '')
    .split('\n');
  let listOpen = false;
  const html = lines
    .map((raw) => {
      const line = raw.trim();
      if (!line) {
        const close = listOpen ? '</ol>' : '';
        listOpen = false;
        return `${close}<div class="spacer"></div>`;
      }
      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) {
        const close = listOpen ? '</ol>' : '';
        listOpen = false;
        // "#" is the document title, which the branded header already carries,
        // so headings start at <h2> and stop at <h3>.
        const level = Math.min(3, heading[1].length + 1);
        return `${close}<h${level}>${htmlEscape(heading[2])}</h${level}>`;
      }
      const numbered = line.match(/^(?:Q(?:uestion)?\s*)?(\d+)[.)]\s*(.+)$/i);
      if (numbered) {
        const open = listOpen ? '' : '<ol>';
        listOpen = true;
        return `${open}<li><b>${htmlEscape(numbered[1])}.</b> ${htmlEscape(numbered[2])}</li>`;
      }
      const close = listOpen ? '</ol>' : '';
      listOpen = false;
      return `${close}<p>${htmlEscape(line).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</p>`;
    })
    .join('');
  return html + (listOpen ? '</ol>' : '');
}

/**
 * Wrap a body in the cover, the flow banner and the footer.
 *
 * `logo` is a data URI, not a path: the renderer works from a detached
 * document, so a relative `/brand/logo.png` would not resolve.
 */
export function brandedDocumentHtml(
  title: string,
  meta: string,
  body: string,
  logo: string,
  includeFlow = true,
): string {
  return `<article class="pdf-document"><header class="cover"><img class="header-logo" src="${logo}" alt="EduAI Hub"><div class="brand">EduAI Hub · Learning X-Ray</div><h1>${htmlEscape(title)}</h1><div class="meta">${htmlEscape(meta)}</div></header>${includeFlow ? documentFlowVisual() : ''}${body}<footer class="closing-footer"><img src="${logo}" alt="EduAI Hub">Prepared with EduAI Learning X-Ray · Teacher review recommended before classroom use</footer></article>`;
}

/**
 * The stylesheet the document is rasterised under.
 *
 * It is a print stylesheet and nothing else - it never reaches the app's own
 * UI, so it does not go through `@/shared/theme`: the theme is responsive, dark
 * mode aware and in device-independent pixels, and this has to be a fixed
 * 760px page on white paper whatever the viewer's settings. `page-break-inside`
 * on `.topic` and `.executive` is what keeps a gap card from being sliced
 * across two pages.
 */
export const PDF_DOCUMENT_STYLES = `*{box-sizing:border-box}.pdf-document{width:760px;background:#fff;color:#172644;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.52;padding:0 8px 24px}.cover{border-bottom:5px solid #f6a017;padding:0 0 18px;margin-bottom:18px}.header-logo{display:block;width:210px;height:auto;margin:0 0 13px}.brand{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#e98200}.cover h1{font-size:30px;line-height:1.12;margin:8px 0;color:#172644}.meta{color:#667085;font-size:13px}h2{font-size:21px;color:#22365e;border-bottom:2px solid #d9dee8;padding-bottom:7px;margin:25px 0 11px}h3{font-size:16px;color:#283b65;margin:19px 0 7px}p{margin:7px 0 11px}.spacer{height:5px}.topic{page-break-inside:avoid;border:1px solid #cfd8e7;border-radius:9px;padding:16px;margin:16px 0;background:#fff}.label{display:inline-block;background:#eef3fb;color:#283b65;border-radius:12px;padding:4px 9px;font-size:10px;font-weight:700;margin-right:6px}ol{padding-left:25px}li{margin:0 0 12px}.options{margin:8px 0 0;color:#475467}.answer{background:#fff8ec;border-left:5px solid #f6a017;border-radius:4px;padding:11px 13px;margin:9px 0}.visual-flow{width:100%;border-collapse:separate;border-spacing:6px;margin:0 0 24px}.visual-flow td:not(.arrow){width:29%;background:#eef3fb;border:1px solid #cfd8e7;border-radius:7px;text-align:center;padding:10px;color:#283b65}.visual-flow small{display:block;color:#667085;margin-top:3px}.visual-flow .arrow{width:6%;text-align:center;color:#f08d00;font-size:19px}.mastery-visual{width:100%;border-collapse:collapse;margin:9px 0}.visual-label{width:34%;font-weight:700;padding-right:8px}.bar-track{width:55%;background:#e6eaf0}.visual-value{width:11%;text-align:right;font-weight:700}.data-table,table{width:100%;border-collapse:collapse}.data-table th,.data-table td,table th,table td{border:1px solid #d9dee8;padding:8px;text-align:left}.data-table th,table thead th{background:#283b65;color:#fff}.executive{page-break-inside:avoid;background:#eef3fb;border-left:6px solid #283b65;border-radius:10px;padding:16px 18px;margin:18px 0 26px}.executive>h2{border:0;margin:0 0 14px;padding:0}.executive-panels{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:14px;align-items:start}.executive-panels>div{background:#fff;border:1px solid #ccd6e5;border-radius:8px;overflow:hidden}.executive-panels h3{background:#283b65;color:#fff;font-size:11px;letter-spacing:.04em;text-transform:uppercase;margin:0;padding:9px 11px}.executive-panels table{font-size:11px;line-height:1.35}.executive-panels tbody th{width:43%;background:#f7f9fc;color:#475467}.closing-footer{margin-top:30px;padding-top:10px;border-top:1px solid #d9dee8;color:#667085;font-size:10px}.closing-footer img{width:68px;height:auto;vertical-align:middle;margin-right:10px}`;

/**
 * The panel that opens both learning-gap reports: every gap as a mastery bar,
 * weakest first, so the first thing a reader sees is the priority.
 *
 * The colours are repeated inline on the section because this block is also
 * the one most likely to be pasted into an email client that drops the
 * stylesheet.
 */
export function learningGapExecutiveSummary(gaps: { concept: string; mastery: number }[]): string {
  return `<section class="executive" style="background:#eef3fb;border-left:6px solid #283b65;padding:16px 20px;margin:18px 0 26px"><h2>Executive summary</h2><p>The following learning gaps were identified from the analysed evidence:</p>${gaps
    .slice()
    .sort((a, b) => a.mastery - b.mastery)
    .map((g) => masteryVisual(g.concept, g.mastery))
    .join('')}</section>`;
}
