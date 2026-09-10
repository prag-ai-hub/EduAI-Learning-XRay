/**
 * Every "download this" the workspace offers.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx:1750 (downloadText), 1856
 * (downloadCorrectedAnswerSheet), 1876, 1882, 1887, 1890 and 1911-1920.
 *
 * This module is deliberately the last of the documents slice to land: it only
 * composes. `bodies.ts` builds the HTML, `pdf.ts` rasterises and saves it, and
 * `pdf-source.ts` crops a page out of the original answer sheet. Nothing here
 * knows how a PDF is made - which is why the whole file inherits `pdf.ts`'s
 * platform behaviour for free: on native every entry point below raises
 * `PdfUnavailableError` from the first renderer call, with the one honest
 * message, rather than each function inventing its own failure.
 *
 * The one thing this file does own is the ZIP, because `fflate` is pure JS and
 * runs anywhere; only putting the archive in front of the user is web-only.
 */

import { zipSync } from 'fflate';

import {
  answerKeyDocumentBody,
  classLearningGapDocumentBody,
  studentLearningGapDocumentBody,
  studyGuideDocumentBody,
  worksheetDocumentBody,
} from '@/features/documents/lib/bodies';
import { htmlEscape } from '@/features/documents/lib/html';
import {
  PdfUnavailableError,
  brandLogoDataUri,
  createBrandedPdfBlob,
  createPdfDocument,
  downloadDocument,
  pdfText,
  savePdfBytes,
  verifiedPdfBytes,
} from '@/features/documents/lib/pdf';
import { sourcePageScreenshot } from '@/features/documents/lib/pdf-source';
import { inferDocumentRole, pageNumberForQuestion, safeDownloadName } from '@/features/workspace/lib/documents';
import { hydrateResult } from '@/features/workspace/lib/read-model';
import { readFile } from '@/shared/files';
import type {
  Assessment,
  GradeResult,
  StudyGuide,
  StudyGuideDocumentMeta,
  UploadFile,
  Worksheet,
  WorksheetContent,
  WorksheetDocumentMeta,
} from '@/shared/types/workspace';

/* ------------------------------------------------------------------------- *
 * Ad-hoc text and CSV
 * ------------------------------------------------------------------------- */

/**
 * A blob of text or CSV, exported as a branded PDF.
 *
 * The heuristic is the web app's, unchanged: more than one line means comma
 * separated rows and becomes a `.data-table`; a single line becomes one
 * paragraph. The extension is stripped from `name` twice over - once for the
 * file name and once, with separators spaced out, for the cover title.
 *
 * Returns the promise rather than swallowing it (`void downloadDocument(…)` on
 * the web), so a caller can await the export and show its own failure. Calling
 * it without awaiting keeps the original behaviour exactly.
 */
export function downloadText(name: string, content: string): Promise<void> {
  const rows = content
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(','));
  const table =
    rows.length > 1
      ? `<table class="data-table"><thead><tr>${rows[0]
          .map((cell) => `<th>${htmlEscape(cell)}</th>`)
          .join('')}</tr></thead><tbody>${rows
          .slice(1)
          .map(
            (row) => `<tr>${row.map((cell) => `<td>${htmlEscape(cell)}</td>`).join('')}</tr>`,
          )
          .join('')}</tbody></table>`
      : `<p>${htmlEscape(content)}</p>`;
  const base = name.replace(/\.[^.]+$/, '');
  return downloadDocument(
    base,
    base.replace(/[-_]+/g, ' '),
    'EduAI Hub · Teacher resource',
    `<h2>Results</h2>${table}`,
  );
}

/* ------------------------------------------------------------------------- *
 * The four teacher resources
 * ------------------------------------------------------------------------- */

/**
 * The student-facing worksheet. `includeFlow` is false for both worksheet
 * exports: the evidence/insight/action banner is a teacher's context, and it
 * has no business on a page a child writes on.
 */
export function downloadWorksheet(
  r: WorksheetDocumentMeta,
  content?: WorksheetContent,
): Promise<void> {
  const body = content || r.content;
  return downloadDocument(
    r.title || 'Worksheet',
    r.title || 'Worksheet',
    `${r.subject || 'Subject'} · ${r.grade || 'Class not set'} · ${(r.concepts || [r.concept])
      .filter(Boolean)
      .join(' · ')}`,
    worksheetDocumentBody(body),
    false,
  );
}

/** The teacher's copy of the same worksheet. */
export function downloadAnswerKey(
  r: WorksheetDocumentMeta,
  content?: WorksheetContent,
): Promise<void> {
  const body = content || r.content;
  return downloadDocument(
    `${r.title || 'Worksheet'}-Answer-Key`,
    `${r.title || 'Worksheet'} · Answer Key`,
    `${r.subject || 'Subject'} · ${r.grade || 'Class not set'}`,
    answerKeyDocumentBody(body),
    false,
  );
}

/** The personalised study guide, with the evidence it was built from. */
export function downloadStudyGuide(
  r: StudyGuideDocumentMeta,
  guide: StudyGuide | undefined,
): Promise<void> {
  return downloadDocument(
    r.title || 'Study-Guide',
    r.title || 'Study Guide',
    `${r.subject || 'Subject'} · ${r.grade || 'Class not set'} · ${r.studentName || 'Student'}`,
    studyGuideDocumentBody(guide, r.evidenceFiles || []),
  );
}

/** One student's learning-gap report. */
export function downloadStudentLearningGapReport(
  assessment: Assessment,
  result: GradeResult,
  file?: UploadFile,
): Promise<void> {
  return downloadDocument(
    `${result.studentName}-Learning-Gap-Report`,
    'Learning Gap Report',
    `Class ${assessment.grade}${assessment.section} · ${assessment.subject} · ${assessment.title}`,
    studentLearningGapDocumentBody(assessment, result, file),
  );
}

/** The whole class, one row per student, weakest concept first. */
export function downloadClassLearningGapReport(
  assessment: Assessment,
  results: GradeResult[],
): Promise<void> {
  return downloadDocument(
    `${assessment.title}-Class-Learning-Gap-Report`,
    'Class Learning Gap Report',
    `Class ${assessment.grade}${assessment.section} · ${assessment.subject} · ${
      assessment.title
    } · ${results.length} student${results.length === 1 ? '' : 's'}`,
    classLearningGapDocumentBody(results),
  );
}

/* ------------------------------------------------------------------------- *
 * The four-report archive
 * ------------------------------------------------------------------------- */

/**
 * All four documents for one student, zipped.
 *
 * The guard at the top is the important part and is unchanged: a half-finished
 * set is refused outright rather than shipping an archive with two of its four
 * files missing, because the teacher would not notice until the parent did.
 *
 * `hydrateResult` runs first because the workspace blob may hold a trimmed
 * result once it has been published; the report needs the full gap detail back.
 */
export async function downloadAssessmentZip(
  assessment: Assessment,
  result: GradeResult,
  guide?: Worksheet,
  worksheet?: Worksheet,
): Promise<void> {
  const base = safeDownloadName(`${result.studentName}_${assessment.title}`);
  const folder = `${base}/`;
  const files: Record<string, Uint8Array> = {};
  if (!guide?.guide || !worksheet?.content)
    throw new Error('All four reports must finish generating before download. Please try again.');

  const detailedResult = await hydrateResult(assessment.id, result);

  const reportBlob = await createBrandedPdfBlob(
    'Learning Gap Report',
    `Class ${assessment.grade}${assessment.section} · ${assessment.subject} · ${assessment.title}`,
    studentLearningGapDocumentBody(assessment, detailedResult),
  );
  files[folder + 'Learning_Gap_Report.pdf'] = await verifiedPdfBytes(reportBlob);

  const guideBlob = await createBrandedPdfBlob(
    guide.title || 'Study Guide',
    `${guide.subject || assessment.subject} · ${guide.grade || assessment.grade} · ${
      guide.studentName || result.studentName
    }`,
    studyGuideDocumentBody(
      guide.guide,
      guide.evidenceFiles ||
        assessment.files.map(
          (file) => `${file.documentRole || inferDocumentRole(file.name)} · ${file.name}`,
        ),
    ),
  );
  files[folder + 'Study_Guide.pdf'] = await verifiedPdfBytes(guideBlob);

  const worksheetMeta = `${worksheet.subject || assessment.subject} · ${
    worksheet.grade || assessment.grade
  } · ${(worksheet.concepts || [worksheet.concept]).filter(Boolean).join(' · ')}`;
  const worksheetBlob = await createBrandedPdfBlob(
    worksheet.title || 'Worksheet',
    worksheetMeta,
    worksheetDocumentBody(worksheet.content),
    false,
  );
  files[folder + 'Worksheet.pdf'] = await verifiedPdfBytes(worksheetBlob);

  const answerBlob = await createBrandedPdfBlob(
    `${worksheet.title || 'Worksheet'} · Answer Key`,
    `${worksheet.subject || assessment.subject} · ${worksheet.grade || assessment.grade}`,
    answerKeyDocumentBody(worksheet.content),
    false,
  );
  files[folder + 'Answer_Key.pdf'] = await verifiedPdfBytes(answerBlob);

  saveZipBytes(zipSync(files, { level: 6 }), base);
}

/**
 * The web save path for the archive.
 *
 * `pdf.ts` owns the equivalent for PDFs (`savePdfBytes`); a ZIP needs its own
 * because the MIME type and the extension differ and nothing else about the
 * anchor-click dance does. The one-second delay before revoking the object URL
 * is the web app's, and 1500ms here for the same reason it was there - Safari
 * loses a download whose URL is revoked too early, and an archive takes longer
 * to hand over than a single PDF.
 */
function saveZipBytes(bytes: Uint8Array, name: string): void {
  if (typeof document === 'undefined')
    throw new PdfUnavailableError(
      'Downloading the four-report archive is only available on the web build of this app.',
    );
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/* ------------------------------------------------------------------------- *
 * The corrected answer sheet
 * ------------------------------------------------------------------------- */

/**
 * The student's own answer sheet, one question per page, with the page crop the
 * evidence came from and the marks and feedback beside it.
 *
 * This is the one export that cannot go through `createBrandedPdfBlob`: the
 * page images are crops of the uploaded scan, so the document is assembled
 * directly on a jsPDF handle rather than rasterised from HTML.
 *
 * Both hard failures are the web app's and are kept because each names a fix
 * the teacher can actually carry out: re-upload the sheet, or grade it first.
 */
export async function downloadCorrectedAnswerSheet(
  assessment: Assessment,
  result: GradeResult,
  file: UploadFile,
): Promise<void> {
  const stored = await readFile(file.id);
  if (!stored)
    throw new Error(
      'The original answer sheet is unavailable. Re-upload it before creating a corrected copy.',
    );

  const questions = result.questionDecisions || [];
  if (!questions.length)
    throw new Error('No question-level review is available for this answer sheet.');

  const logo = await brandLogoDataUri();
  const pdf = await createPdfDocument();

  for (let index = 0; index < questions.length; index++) {
    if (index) pdf.addPage();
    const question = questions[index];
    const pageNumber = pageNumberForQuestion(question, index, result.ocrText || '');
    const screenshot = await sourcePageScreenshot(stored, file, pageNumber);
    // `null` means this platform has no way to raster a page. `createPdfDocument`
    // would already have thrown there, so this is unreachable today; it is
    // handled rather than asserted so the native arm cannot ship a blank page.
    if (!screenshot)
      throw new PdfUnavailableError(
        'The answer-sheet page could not be rendered on this platform.',
      );

    pdf.addImage(logo, 'PNG', 14, 12, 42, 11, undefined, 'FAST');
    pdf.setTextColor(23, 38, 68);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(18);
    pdf.text('Corrected Answer Sheet', 14, 31);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(90, 102, 122);
    pdf.text(
      `${result.studentName} · Class ${assessment.grade}${assessment.section} · ${assessment.subject}`,
      14,
      37,
    );
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(23, 38, 68);
    pdf.text(`Total score: ${result.score} / ${result.maxMarks}`, 196, 37, { align: 'right' });

    pdf.setDrawColor(246, 160, 23);
    pdf.setLineWidth(0.8);
    pdf.line(14, 41, 196, 41);

    pdf.setTextColor(23, 38, 68);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.text(`Question ${index + 1}: ${question.label}`, 14, 49);
    pdf.setFontSize(10);
    pdf.text(`Final marks: ${question.awardedMarks} / ${question.maxMarks}`, 14, 56);
    pdf.text(`Source answer-sheet page ${pageNumber}`, 196, 56, { align: 'right' });

    const imageProps = pdf.getImageProperties(screenshot);
    const imageWidth = 182;
    const imageHeight = Math.min(112, imageWidth * (imageProps.height / imageProps.width));
    pdf.addImage(screenshot, 'JPEG', 14, 61, imageWidth, imageHeight, undefined, 'FAST');

    let y = 61 + imageHeight + 10;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.text('AI feedback', 14, y);
    y += 6;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    y = pdfText(
      pdf,
      question.rationale || result.feedback || 'No AI feedback was stored for this question.',
      14,
      y,
      182,
    );

    if (question.teacherComment?.trim()) {
      y += 5;
      pdf.setFont('helvetica', 'bold');
      pdf.text('Teacher comment', 14, y);
      y += 6;
      pdf.setFont('helvetica', 'normal');
      pdfText(pdf, question.teacherComment, 14, y, 182);
    }

    pdf.setDrawColor(217, 222, 232);
    pdf.setLineWidth(0.25);
    pdf.line(14, 282, 196, 282);
    pdf.setFontSize(8);
    pdf.setTextColor(102, 112, 133);
    pdf.text('EduAI Hub · Learning X-Ray', 14, 288);
    pdf.text(`Question ${index + 1} of ${questions.length}`, 196, 288, { align: 'right' });
  }

  const bytes = await verifiedPdfBytes(pdf.output('blob'));
  savePdfBytes(bytes, safeDownloadName(`${result.studentName}_${assessment.title}_Corrected_Answer_Sheet`));
}
