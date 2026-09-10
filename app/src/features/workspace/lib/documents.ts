/**
 * What a file IS, and what may therefore be run on it.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx: the worksheet text
 * builders (1731-1749), `pageNumberForQuestion` (1822-1841),
 * `safeDownloadName` (1889) and the document-role inference block (1924-1933).
 *
 * These decide which dialog an uploaded document opens, what the generated
 * question paper and marking scheme say, and which page of a scanned answer
 * sheet a question's evidence came from. All of it is string work over the
 * workspace types; nothing here reads a file's bytes.
 */

import type {
  DocumentRole,
  EvaluatorQuestion,
  UploadFile,
  Worksheet,
  WorksheetContent,
} from '@/shared/types/workspace';

// ---------------------------------------------------------------------------
// Document roles
// ---------------------------------------------------------------------------

/**
 * The role a file name suggests, used when the teacher has not set one.
 *
 * Order matters: a "marking scheme" also contains the word "scheme" and a
 * "model answer" also contains "answer", so the most specific patterns are
 * tested first and the fall-through is an ungraded answer sheet - the case
 * that is by far the most common in a bulk upload.
 *
 * The `\\bqp\\b` alternative is verbatim from the web app, where the extra
 * backslash makes it match a literal "\bqp\b" rather than the word "qp". It is
 * kept because fixing it would newly classify files named "...QP.pdf" as
 * question papers, changing which dialog they open; that is a product decision,
 * not a port decision.
 */
export function inferDocumentRole(name: string): DocumentRole {
  if (/marking.?scheme|mark.?scheme/i.test(name)) return 'Marking scheme';
  if (/model.?answer|answer.?key|solution/i.test(name)) return 'Model answer';
  if (/question|paper|worksheet|assessment|\\bqp\\b/i.test(name)) return 'Question paper';
  if (/graded|marked|checked/i.test(name)) return 'Teacher-graded answer sheet';
  return 'Ungraded answer sheet';
}

/**
 * `total` is the number of files on the assessment: with only one upload there
 * is nothing to be the question paper *for*, so the name heuristic is skipped.
 */
export function isQuestionPaperFile(file: UploadFile, total: number): boolean {
  return (
    file.documentRole === 'Question paper' ||
    (!file.documentRole && total > 1 && /question|paper|qp/i.test(file.name))
  );
}

export function isAnswerSheetFile(file: UploadFile, total: number): boolean {
  return (
    file.documentRole === 'Ungraded answer sheet' ||
    file.documentRole === 'Teacher-graded answer sheet' ||
    (!file.documentRole &&
      !isQuestionPaperFile(file, total) &&
      !/answer.?key|model.?answer|marking.?scheme|solutions?/i.test(file.name))
  );
}

/**
 * Which analysis dialog a file opens. A sheet the teacher has already marked is
 * diagnosed, not re-graded - the marks are the teacher's and stay theirs.
 */
export function analysisDialogFor(file: UploadFile): 'diagnose-file' | 'grade-file' {
  return (file.documentRole || inferDocumentRole(file.name)) === 'Teacher-graded answer sheet'
    ? 'diagnose-file'
    : 'grade-file';
}

// ---------------------------------------------------------------------------
// Generated worksheets, as printable text
// ---------------------------------------------------------------------------

/**
 * One mark per multiple-choice question, two per written response - a stated
 * default so the model has a total to reconcile against, which /api/grade
 * requires the question marks to sum to exactly.
 */
export function worksheetMaxMarks(content?: WorksheetContent): number {
  return Math.max(
    1,
    (content?.mcqQuestions?.length || 0) + (content?.subjectiveQuestions?.length || 0) * 2,
  );
}

/** The worksheet as a question paper the grader can read. */
export function worksheetQuestionPaperText(worksheet: Worksheet): string {
  const content: WorksheetContent | undefined = worksheet?.content;
  const mcq = (content?.mcqQuestions || []).map(
    (q, i) =>
      `Q${i + 1}. (1 mark) ${q.question}\n${q.options
        .map((o, j) => `   ${String.fromCharCode(65 + j)}) ${o}`)
        .join('\n')}`,
  );
  const offset = content?.mcqQuestions?.length || 0;
  const written = (content?.subjectiveQuestions || []).map(
    (q, i) => `Q${offset + i + 1}. (2 marks) ${q.question}`,
  );
  return [
    `${worksheet?.title || 'Practice worksheet'}`,
    `Subject: ${worksheet?.subject || 'General'}    Class: ${worksheet?.grade || 'Not stated'}`,
    `Total marks: ${worksheetMaxMarks(content)}`,
    '',
    ...mcq,
    ...written,
  ].join('\n');
}

/** The matching marking scheme, numbered to line up with the question paper. */
export function worksheetMarkingSchemeText(content?: WorksheetContent): string {
  const mcq = (content?.mcqQuestions || []).map(
    (q, i) =>
      `Q${i + 1}. (1 mark) Correct option: ${String.fromCharCode(65 + q.correctIndex)} - ${
        q.options[q.correctIndex]
      }`,
  );
  const offset = content?.mcqQuestions?.length || 0;
  const written = (content?.subjectiveQuestions || []).map(
    (q, i) =>
      `Q${offset + i + 1}. (2 marks) Model answer: ${q.modelAnswer}\n   Award 1 mark for a correct method or key idea, 1 mark for a complete and accurate answer.`,
  );
  return ['MARKING SCHEME', '', ...mcq, ...written].join('\n');
}

// ---------------------------------------------------------------------------
// Files on the way out
// ---------------------------------------------------------------------------

/**
 * A file name safe on every filesystem the app writes to.
 *
 * `normalize("NFKD")` splits accents off their letters so the character class
 * below drops the marks and keeps the letter. Hermes ships it, but the guard is
 * there because a JS engine may omit `String.prototype.normalize` entirely and
 * a crash here would lose the export rather than degrade it.
 */
export function safeDownloadName(value: string): string {
  const decomposed = typeof value.normalize === 'function' ? value.normalize('NFKD') : value;
  return (
    decomposed
      .replace(/[^a-z0-9]+/gi, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 100) || 'Assessment'
  );
}

// ---------------------------------------------------------------------------
// Locating evidence in a scanned sheet
// ---------------------------------------------------------------------------

/**
 * Which page of the scanned answer sheet a question's evidence came from.
 *
 * The evaluator returns a page number, but it is a guess made from the text it
 * was given, not from the scan. When the OCR text carries "--- Page N ---"
 * markers this scores the question's evidence against each page's tokens and
 * prefers the best match; a whole-phrase hit is weighted heavily enough
 * (`length + 4`) to beat scattered token overlap on another page.
 *
 * It falls back to the model's own number whenever there is too little to go on
 * - fewer than two usable tokens, no page markers, or a best score below the
 * threshold - because a confidently wrong page crop is worse than an unverified
 * one.
 */
export function pageNumberForQuestion(
  question: EvaluatorQuestion,
  index: number,
  ocrText: string,
): number {
  const proposed = Math.max(1, Math.floor(Number(question.pageNumber) || index + 1));
  const source = (question.evidence || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const parts = ocrText.split(/---\s*Page\s+(\d+)\s*---/i);
  if (parts.length < 3 || source.length < 8) return proposed;
  const evidenceTokens = Array.from(
    new Set(source.split(/\s+/).filter((token) => token.length > 2)),
  );
  if (evidenceTokens.length < 2) return proposed;
  let bestPage = proposed,
    bestScore = 0;
  for (let partIndex = 1; partIndex < parts.length; partIndex += 2) {
    const pageNumber = Math.max(1, Number(parts[partIndex]) || 1);
    const pageText = (parts[partIndex + 1] || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    const pageTokens = new Set(pageText.split(/\s+/));
    const overlap = evidenceTokens.reduce(
      (score, token) => score + (pageTokens.has(token) ? 1 : 0),
      0,
    );
    const exact = pageText.includes(source) ? evidenceTokens.length + 4 : 0;
    const score = overlap + exact;
    if (score > bestScore) {
      bestScore = score;
      bestPage = pageNumber;
    }
  }
  // Use a matched OCR page only when its answer evidence is sufficiently clear.
  return bestScore >= Math.min(3, evidenceTokens.length) ? bestPage : proposed;
}
