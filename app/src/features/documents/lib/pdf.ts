/**
 * Turning a document body into a branded PDF, and putting it in front of the
 * user.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx:1759-1819, 1855 and 1888.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE - read this before touching anything below
 * ---------------------------------------------------------------------------
 *
 * The renderer is jsPDF + html2canvas, both declared in app/package.json at the
 * versions frontend/ used. Neither may be imported at MODULE SCOPE, because
 * html2canvas dereferences `document` as it loads and that breaks the Metro
 * native bundle before a line of this file runs - so both are behind a dynamic
 * `import()` inside a web-only branch. Metro still puts them in the native
 * bundle, which costs bytes; it never evaluates them, which is what matters.
 *
 * Not from a CDN. An earlier revision fetched both from jsdelivr through an
 * indirect `new Function("return import(s)")`, which put a core feature behind
 * a third party at runtime, outside the lockfile and outside `npm audit`, and
 * silently pinned jspdf 2.5.2 where the source used 4.x. `./pdf-source` does
 * load pdf.js that way, and that IS faithful - the web app loaded pdf.js from
 * cdnjs too - but jspdf and html2canvas were ordinary dependencies there.
 *
 * On native every entry point here throws `PdfUnavailableError`. That is the
 * honest answer: the native equivalent is expo-print's `printToFileAsync` plus
 * expo-sharing, and neither package is installed either. When they are, this is
 * the one file that changes - `createBrandedPdfBlob` gets a native arm and
 * `downloadDocument` shares instead of clicking a link. Nothing above this
 * module knows which platform it is on.
 *
 * This is a single module with `Platform.OS` branches rather than a
 * `.web.ts`/`.native.ts` pair, following the precedent set by
 * `@/shared/storage` and `@/shared/files`: `tsc` has no `moduleSuffixes` here,
 * so a platform pair typechecks only one of its halves.
 *
 * The currency is `FileSource` - `{ bytes }` or a real Blob - never a bare
 * React Native Blob, which cannot be constructed from bytes. `@/shared/files`
 * takes a `FileSource` and so does everything downstream.
 */

import { Image, Platform } from 'react-native';

import {
  PDF_DOCUMENT_STYLES,
  brandedDocumentHtml,
} from '@/features/documents/lib/html';
import { blobToBase64 } from '@/shared/api/net';
import { bytesFromBase64, type FileSource } from '@/shared/files';

/**
 * Raised wherever a PDF cannot be produced on this platform.
 *
 * Named so a caller can tell "this device cannot make PDFs" from "this document
 * is broken" and word its message accordingly, rather than showing a stack.
 */
export class PdfUnavailableError extends Error {
  constructor(message = 'PDF export is only available on the web build of this app.') {
    super(message);
    this.name = 'PdfUnavailableError';
  }
}

// ---------------------------------------------------------------------------
// The jsPDF surface
// ---------------------------------------------------------------------------

/**
 * Only what this app calls on a jsPDF document.
 *
 * jspdf is not a dependency, so there are no types to import; this is the
 * structural contract the CDN build satisfies. It is exported because the
 * corrected-answer-sheet export in `downloads.ts` drives a document page by
 * page and needs to name the type it is holding.
 */
export interface JsPdfDocument {
  addPage(): void;
  setPage(page: number): void;
  setFont(family: string, style: string): void;
  setFontSize(size: number): void;
  setTextColor(r: number, g: number, b: number): void;
  setDrawColor(r: number, g: number, b: number): void;
  setLineWidth(width: number): void;
  line(x1: number, y1: number, x2: number, y2: number): void;
  text(
    text: string | string[],
    x: number,
    y: number,
    options?: { align?: 'left' | 'center' | 'right' },
  ): void;
  splitTextToSize(text: string, width: number): string[];
  addImage(
    data: string,
    format: string,
    x: number,
    y: number,
    width: number,
    height: number,
    alias?: undefined,
    compression?: string,
  ): void;
  getImageProperties(data: string): { width: number; height: number };
  output(type: 'blob'): Blob;
}




function requireWeb(): void {
  if (Platform.OS !== 'web') throw new PdfUnavailableError();
}

/**
 * A blank A4 document.
 *
 * Exported so `downloads.ts` can build the corrected answer sheet, which is
 * assembled page by page from page crops rather than from an HTML body and so
 * cannot go through `createBrandedPdfBlob`.
 */
export async function createPdfDocument(): Promise<JsPdfDocument> {
  requireWeb();
  const { jsPDF } = await import('jspdf');
  return new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
}

// ---------------------------------------------------------------------------
// The brand mark, as bytes
// ---------------------------------------------------------------------------

/**
 * The bundled logo. `require` rather than a path: on native there is no
 * `/brand/logo.png` to fetch, and the bundler has to see the asset to ship it.
 * `@/shared/components/brand` requires the same file for the on-screen mark;
 * they are deliberately independent so a background export never pulls a React
 * component into its bundle.
 */
const BRAND_LOGO = require('@/assets/brand/logo.png');

/**
 * The logo as a `data:` URI, for embedding in the document HTML.
 *
 * A data URI is required, not preferred: html2canvas rasterises a detached
 * document, and expo-print's WebView has no origin, so a bundled asset path
 * would resolve to nothing in both. The fallback is the resolved asset URI -
 * the same shape of fallback the web app had, where a failed fetch left
 * `/brand/logo.png` in the `src` and the browser fetched it again itself.
 */
export async function brandLogoDataUri(): Promise<string> {
  // Guarded for the same reason as brand.tsx's ratioOf: `Platform.OS` is
  // 'web' during a Node server render too, so the web branch is reachable
  // where this API is not. A missing logo is a plainer document, not a 500.
  const uri =
    typeof Image.resolveAssetSource === 'function'
      ? (Image.resolveAssetSource(BRAND_LOGO)?.uri ?? '')
      : '';
  if (!uri || uri.startsWith('data:')) return uri;
  try {
    const response = await fetch(uri);
    if (!response.ok) return uri;
    const blob = await response.blob();
    const type = blob.type || 'image/png';
    return `data:${type};base64,${await blobToBase64(blob)}`;
  } catch {
    return uri;
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * The document body, rasterised and sliced into A4 pages.
 *
 * The mechanism, unchanged from the web app: the HTML is mounted in a hidden
 * 780px-wide host far off-screen (not `display:none`, which html2canvas cannot
 * measure), rasterised once at 1.5x, and the single tall canvas is then cut
 * into page-height strips that are drawn onto fresh canvases and added as
 * JPEGs. Cutting the bitmap rather than re-rendering per page is what keeps a
 * ten-page report to one layout pass; the cost is that a page break can fall
 * mid-line, which `page-break-inside: avoid` in `PDF_DOCUMENT_STYLES` keeps
 * away from the cards that matter.
 *
 * Waiting on `document.fonts.ready` matters: without it the first export of a
 * session rasterises in the fallback face.
 */
export async function createBrandedPdfBlob(
  title: string,
  meta: string,
  body: string,
  includeFlow = true,
): Promise<FileSource> {
  requireWeb();

  const logo = await brandLogoDataUri();
  const html2canvas = (await import('html2canvas')).default;
  const { jsPDF } = await import('jspdf');

  const host = document.createElement('div');
  host.style.cssText =
    'position:fixed;left:-100000px;top:0;width:780px;background:#fff;z-index:2147483647;pointer-events:none';
  host.innerHTML = `<style>${PDF_DOCUMENT_STYLES}</style>${brandedDocumentHtml(
    title,
    meta,
    body,
    logo,
    includeFlow,
  )}`;
  document.body.appendChild(host);
  try {
    await document.fonts?.ready;
    const canvas = await html2canvas(host, {
      backgroundColor: '#ffffff',
      scale: 1.5,
      useCORS: true,
      logging: false,
      windowWidth: 780,
    });
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
    const contentWidthMm = 182,
      contentHeightMm = 266;
    const pageHeightPx = Math.max(1, Math.floor(canvas.width * (contentHeightMm / contentWidthMm)));
    const pages = Math.max(1, Math.ceil(canvas.height / pageHeightPx));
    for (let page = 1; page <= pages; page++) {
      if (page > 1) pdf.addPage();
      pdf.setPage(page);
      const sourceY = (page - 1) * pageHeightPx;
      const sourceHeight = Math.min(pageHeightPx, canvas.height - sourceY);
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = sourceHeight;
      const context = slice.getContext('2d');
      if (!context) throw new Error('PDF renderer could not create a page canvas.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, slice.width, slice.height);
      context.drawImage(
        canvas,
        0,
        sourceY,
        canvas.width,
        sourceHeight,
        0,
        0,
        canvas.width,
        sourceHeight,
      );
      pdf.addImage(
        slice.toDataURL('image/jpeg', 0.92),
        'JPEG',
        14,
        12,
        contentWidthMm,
        contentWidthMm * (sourceHeight / canvas.width),
        undefined,
        'FAST',
      );
      pdf.setDrawColor(217, 222, 232);
      pdf.line(14, 282, 196, 282);
      try {
        pdf.addImage(logo, 'PNG', 14, 285, 20, 5.8, undefined, 'FAST');
      } catch {
        // A logo that will not decode must not cost the teacher the report.
      }
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(102, 112, 133);
      pdf.text('EduAI Hub · Learning X-Ray', 38, 289);
      pdf.text(`Page ${page} of ${pages}`, 196, 289, { align: 'right' });
    }
    return pdf.output('blob');
  } finally {
    host.remove();
  }
}

/**
 * Wrapped text, returning the y the next block should start at.
 *
 * Pure jsPDF, so it works wherever a document does; `lineHeight` is the caller's
 * leading in mm and defaults to the 5mm the web app used everywhere.
 */
export function pdfText(
  pdf: JsPdfDocument,
  text: string,
  x: number,
  y: number,
  width: number,
  lineHeight = 5,
): number {
  const lines = pdf.splitTextToSize(text, width);
  pdf.text(lines, x, y);
  return y + lines.length * lineHeight;
}

/**
 * The bytes of a generated PDF, checked to actually be one.
 *
 * The guard exists because a jsPDF failure can yield an empty or HTML blob that
 * saves happily and opens as a broken file days later. Five bytes of header is
 * a cheap way to fail at the moment of export instead.
 *
 * Takes a `FileSource` rather than a Blob so the native arm - which will hand
 * back `{ bytes }` from expo-print - needs no second entry point. A React
 * Native Blob has no `arrayBuffer()`, hence the FileReader route.
 */
export async function verifiedPdfBytes(source: FileSource): Promise<Uint8Array> {
  const bytes = await sourceBytes(source);
  if (bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-')
    throw new Error('A generated resource was not a valid PDF.');
  return bytes;
}

async function sourceBytes(source: FileSource): Promise<Uint8Array> {
  if ('uri' in source)
    throw new PdfUnavailableError('A PDF held only as a file URI cannot be verified in place.');

  // `'bytes' in source` cannot do the narrowing on its own: the DOM Blob now
  // declares a `bytes()` METHOD, so the property exists on both arms of the
  // union. The instance check is what actually tells them apart.
  const inMemory: unknown = (source as { bytes?: unknown }).bytes;
  if (inMemory instanceof Uint8Array) return inMemory;

  const blob = source as Blob;
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return bytesFromBase64(await blobToBase64(blob));
}

/**
 * Render the document and hand it to the user.
 *
 * On web that is the anchor-click download the whole app already used, kept
 * verbatim including the one-second delay before revoking the object URL -
 * revoking immediately loses the download in Safari.
 *
 * `name` is the file name and is stripped to `[a-z0-9-]`; `title` and `meta`
 * are what the cover prints.
 */
export async function downloadDocument(
  name: string,
  title: string,
  meta: string,
  body: string,
  includeFlow = true,
): Promise<void> {
  requireWeb();
  const generated = await createBrandedPdfBlob(title, meta, body, includeFlow);
  const bytes = await verifiedPdfBytes(generated);
  savePdfBytes(bytes, name);
}

/**
 * The web save path, shared with `downloads.ts` - the corrected answer sheet
 * assembles its own document and still has to land in the same place.
 */
export function savePdfBytes(bytes: Uint8Array, name: string): void {
  requireWeb();
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/\.[^.]+$/, '').replace(/[^a-z0-9-]+/gi, '-')}.pdf`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
