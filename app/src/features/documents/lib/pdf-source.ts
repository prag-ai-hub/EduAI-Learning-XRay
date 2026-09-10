/**
 * Cropping the page of a scanned answer sheet that a question was answered on.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx:1762 and 1820-1854.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE - this module is web-only, on purpose
 * ---------------------------------------------------------------------------
 *
 * The PDF branch runs pdf.js, which renders into a DOM `<canvas>` and is read
 * back with `canvas.toDataURL()`. React Native has neither, and pdf.js is not a
 * dependency of this app - the web app loaded it from a CDN at runtime, and so
 * does this.
 *
 * So `sourcePageScreenshot` returns **null** on native rather than throwing.
 * Null means "no page image is available here", and the corrected-answer-sheet
 * export in `downloads.ts` degrades to a text-only corrected copy. An image
 * answer sheet needs no renderer at all and works on both platforms.
 *
 * The module is loaded through an indirect `import()` built with `new Function`
 * rather than a literal `import(URL)`. Metro rewrites every `import()` it can
 * see into its own async-require, which would try to resolve a CDN URL as a
 * bundled module and fail; the indirection hands the specifier to the browser's
 * own loader instead. It is constructed lazily, inside the web branch, so
 * Hermes - which has no `Function` constructor - never reaches it.
 */

import { Platform } from 'react-native';

import type { StoredFile } from '@/shared/files';
import type { PdfJsModule, UploadFile } from '@/shared/types/workspace';

export type { PdfJsModule };

/** Pinned: pdf.js changes its worker contract between majors. */
export const PDFJS_MODULE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
export const PDFJS_WORKER_URL =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';

/**
 * `data:<type>;base64,<...>` for a Blob.
 *
 * FileReader is polyfilled by React Native and present in every browser, so
 * this one helper is portable; it is the only part of the file that is. Kept
 * exported because the pre-existing call sites read a Blob straight off a
 * fetch response rather than out of the file store.
 */
export function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * The ES-module loader the bundler must not rewrite. Web only; see the header.
 *
 * Exported because `./pdf` needs the same escape hatch for jspdf and
 * html2canvas, and one eval-shaped indirection in the codebase is enough.
 */
export function browserImport(specifier: string): Promise<unknown> {
  const load = new Function('specifier', 'return import(specifier)') as (
    s: string,
  ) => Promise<unknown>;
  return load(specifier);
}

/**
 * A JPEG data URI of one page of the answer sheet, or null when this platform
 * cannot produce one.
 *
 * `source` is the stored file - the portable currency of `@/shared/files` - and
 * `file` is its workspace record, which is where the MIME type and the name
 * that decide the branch live.
 *
 * Throws only for a document that could never be cropped: the web app raised
 * the same message for a .docx answer sheet, because the teacher's fix is to
 * re-upload a PDF or a photo, not to retry.
 */
export async function sourcePageScreenshot(
  source: StoredFile,
  file: UploadFile,
  pageNumber: number,
): Promise<string | null> {
  if (file.type.startsWith('image/')) return source.dataUri();
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name))
    throw new Error('A corrected answer sheet requires a PDF or image answer-sheet upload.');

  // pdf.js needs a document and a canvas. Native has neither; the caller
  // degrades rather than failing the whole export.
  if (Platform.OS !== 'web') return null;

  const pdfjs = (await browserImport(PDFJS_MODULE_URL)) as PdfJsModule;
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
  const pdf = await pdfjs.getDocument({ data: await source.bytes() }).promise;
  const page = await pdf.getPage(Math.max(1, Math.min(pageNumber, pdf.numPages)));
  const viewport = page.getViewport({ scale: 1.25 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The answer-sheet preview could not be prepared.');
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas.toDataURL('image/jpeg', 0.86);
}
