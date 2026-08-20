export const ATTEMPT_STATES = ["not_attempted", "attempted", "excluded"] as const;

export type AttemptState = (typeof ATTEMPT_STATES)[number];

export type CriterionDecision = {
  id: string;
  label: string;
  awardedMarks: number;
  maxMarks: number;
  evidence?: string;
  rationale?: string;
};

export type QuestionDecision = {
  id: string;
  label: string;
  attemptState: AttemptState;
  awardedMarks: number;
  maxMarks: number;
  allowedIncrement?: number;
  evidence: string;
  rationale: string;
  confidence?: number;
  aiDisposition: "accepted" | "edited" | "rejected";
  reviewed: boolean;
  criteria?: CriterionDecision[];
};

export type PageDisposition = {
  pageNumber: number;
  disposition: "contains_reviewed_answer" | "blank_confirmed";
};

export type EvaluationSubmission = {
  assessmentId: string;
  fileId: string;
  studentName: string;
  assessmentVersion: number;
  questionPaperFileId?: string;
  questions: QuestionDecision[];
  pages: PageDisposition[];
  expectedMaxMarks: number;
  evaluatorConfirmation: boolean;
  idempotencyKey: string;
};

export type EvaluationValidation = {
  valid: boolean;
  errors: string[];
  totalAwarded: number;
  totalMaximum: number;
  canonical: string;
};

function finiteMark(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function isIncrement(value: number, increment: number) {
  const units = value / increment;
  return Math.abs(units - Math.round(units)) < 1e-8;
}

function normalizedMarkIncrement(value: unknown) {
  const increment = Number(value);
  return [0.25, 0.5, 1].includes(increment) ? increment : 0.5;
}

export function canonicalizeEvaluation(submission: EvaluationSubmission) {
  return JSON.stringify({
    assessmentId: submission.assessmentId,
    assessmentVersion: submission.assessmentVersion,
    fileId: submission.fileId,
    studentName: submission.studentName.trim(),
    questionPaperFileId: submission.questionPaperFileId || null,
    pages: submission.pages.slice().sort((a, b) => a.pageNumber - b.pageNumber),
    questions: submission.questions
      .map(question => ({
        ...question,
        evidence: question.evidence.trim(),
        rationale: question.rationale.trim(),
        criteria: (question.criteria || []).slice().sort((a, b) => a.id.localeCompare(b.id)),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}

export function validateEvaluationSubmission(submission: EvaluationSubmission): EvaluationValidation {
  const errors: string[] = [];
  if (!submission.assessmentId?.trim()) errors.push("Assessment is required.");
  if (!submission.fileId?.trim()) errors.push("Answer sheet is required.");
  if (!submission.studentName?.trim()) errors.push("Student name is required.");
  if (!Number.isInteger(submission.assessmentVersion) || submission.assessmentVersion < 1) errors.push("Assessment version is invalid.");
  if (!submission.evaluatorConfirmation) errors.push("Evaluator confirmation is required.");
  if (!/^[a-zA-Z0-9:_-]{8,180}$/.test(submission.idempotencyKey || "")) errors.push("Idempotency key is invalid.");
  if (!Array.isArray(submission.questions) || submission.questions.length === 0) errors.push("At least one question decision is required.");
  if (!Array.isArray(submission.pages) || submission.pages.length === 0) errors.push("Every script needs a page disposition.");

  const ids = new Set<string>();
  let totalAwarded = 0;
  let totalMaximum = 0;
  for (const question of submission.questions || []) {
    const prefix = question.label || question.id || "Question";
    if (!question.id?.trim() || ids.has(question.id)) errors.push(`${prefix}: question ID is missing or duplicated.`);
    ids.add(question.id);
    if (!question.reviewed) errors.push(`${prefix}: evaluator review is required.`);
    if (!ATTEMPT_STATES.includes(question.attemptState)) errors.push(`${prefix}: attempt state is invalid.`);
    if (!finiteMark(question.maxMarks) || question.maxMarks <= 0) errors.push(`${prefix}: maximum marks must be greater than zero.`);
    if (!finiteMark(question.awardedMarks) || question.awardedMarks < 0 || question.awardedMarks > question.maxMarks) errors.push(`${prefix}: awarded marks are outside the allowed range.`);
    // Model output occasionally confuses a question's awarded mark (for example 3.5)
    // with its increment. Only supported school marking increments may constrain an
    // evaluator submission; malformed model metadata safely falls back to half marks.
    const increment = normalizedMarkIncrement(question.allowedIncrement);
    if (finiteMark(question.awardedMarks) && !isIncrement(question.awardedMarks, increment)) errors.push(`${prefix}: marks must use increments of ${increment}.`);
    if ((question.attemptState === "not_attempted" || question.attemptState === "excluded") && question.awardedMarks !== 0) errors.push(`${prefix}: ${question.attemptState.replace("_", " ")} must award zero marks.`);
    if (question.attemptState === "attempted" && !question.evidence?.trim()) errors.push(`${prefix}: answer evidence is required.`);
    if (question.aiDisposition !== "accepted" && !question.rationale?.trim()) errors.push(`${prefix}: a rationale is required when the AI proposal is edited or rejected.`);
    if (question.criteria?.length) {
      const criterionAward = question.criteria.reduce((sum, item) => sum + Number(item.awardedMarks || 0), 0);
      if (Math.abs(criterionAward - question.awardedMarks) > 1e-8) errors.push(`${prefix}: criterion marks must equal the question award.`);
    }
    totalAwarded += Number(question.awardedMarks || 0);
    totalMaximum += Number(question.maxMarks || 0);
  }
  const pageNumbers = new Set<number>();
  for (const page of submission.pages || []) {
    if (!Number.isInteger(page.pageNumber) || page.pageNumber < 1 || pageNumbers.has(page.pageNumber)) errors.push("Page dispositions must use unique positive page numbers.");
    pageNumbers.add(page.pageNumber);
    if (!["contains_reviewed_answer", "blank_confirmed"].includes(page.disposition)) errors.push(`Page ${page.pageNumber}: disposition is invalid.`);
  }
  if (!finiteMark(submission.expectedMaxMarks) || Math.abs(totalMaximum - submission.expectedMaxMarks) > 1e-8) errors.push("Question maximum marks do not match the assessment total.");
  return { valid: errors.length === 0, errors, totalAwarded, totalMaximum, canonical: canonicalizeEvaluation(submission) };
}

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
