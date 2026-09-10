/**
 * The grading run for one answer sheet - everything `PerFileGradeDialogBody`
 * did apart from its JSX.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `PerFileGradeDialogBody`
 * (~1195-1420). The dialog that renders it is a separate file: this hook holds
 * the candidate resolution, the two-phase OCR-then-grade run, the evaluator
 * submission and the bulk-queue advance, so none of that has to be read past
 * three hundred lines of markup.
 *
 * THE TWO PHASES, which are the whole shape of this hook:
 *
 *  1. `grade()` with no OCR yet posts every chosen document to /api/ocr, stores
 *     the extracted text per role and stops. Nothing is analysed.
 *  2. The teacher corrects that text and confirms it. Only then does a second
 *     `grade()` post to /api/grade.
 *
 * ---------------------------------------------------------------------------
 * THE VALIDATION GATE
 * ---------------------------------------------------------------------------
 * The dialog's own copy promises "Learning-gap analysis will not start until
 * you validate the OCR text", and the panel shows a "Teacher validation
 * required" pill - but the web enforced it only by convention: pressing the
 * button a second time started the analysis whether or not anybody had read a
 * word. `ocrValidated` makes the promise real. It is set by the teacher on the
 * OCR panel, `grade()` refuses without it, and any edit to the extracted text
 * clears it again, because text that has changed since the confirmation has not
 * been confirmed.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTES
 * ---------------------------------------------------------------------------
 * * File bytes come from `@/shared/files` rather than an IndexedDB blob, and
 *   base64 is read off the stored file - `FileReader` has no counterpart on a
 *   device.
 * * `bulkAnalysisQueue` and `advanceBulkAnalysisQueue` are async now (native
 *   storage is a file per key), so the auto-start effect awaits the queue
 *   instead of reading it inline, and the advance is awaited before the next
 *   dialog is opened.
 * * `window.setInterval` / `window.setTimeout` are the plain globals here;
 *   there is no `window` on native.
 */

import { useEffect, useRef, useState } from 'react';

import { authFetch } from '@/features/auth/api/authApi';
import { advanceBulkAnalysisQueue, bulkAnalysisQueue } from '@/features/assessments/lib/bulk-queue';
import { classSubjectOptions, logApiTiming } from '@/features/workspace/lib/analytics';
import { guessStudentName } from '@/features/workspace/lib/demo-state';
import { analysisDialogFor, inferDocumentRole } from '@/features/workspace/lib/documents';
import { generateAllStudentResources } from '@/features/workspace/lib/resources';
import { normalizeOcrText } from '@/features/documents/lib/html';
import { readFile, type StoredFile } from '@/shared/files';
import type {
  ClassSubjectOption,
  EvaluatorQuestion,
  Gap,
  GradeResult,
  OcrDocument,
  OcrDocumentRole,
  OcrDocuments,
  UploadFile,
  W,
} from '@/shared/types/workspace';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** The marks-per-question steps /api/grade is allowed to propose. */
const ALLOWED_INCREMENTS = [0.25, 0.5, 1];

/** A graded run the teacher has still to confirm question by question. */
export type PendingAnalysis = { result: GradeResult; questions: EvaluatorQuestion[] };

export type GradeRunInput = W<
  'assessment' | 'state' | 'setState' | 'update' | 'open' | 'notify' | 'openAssessment' | 'close'
> & {
  file: UploadFile;
  /**
   * The sheet the teacher already marked: its awards are preserved and only
   * the learning gaps are diagnosed, so no grading review follows.
   */
  diagnosisOnly?: boolean;
};

export type GradeRun = {
  /** Every other file on the assessment - the pool the three pickers draw from. */
  candidates: UploadFile[];
  questionPapers: UploadFile[];
  markingSchemes: UploadFile[];
  modelAnswers: UploadFile[];
  /** Anything not already offered as a question paper, as the "legacy" group. */
  otherQuestionPaperChoices: UploadFile[];
  mappingOptions: ClassSubjectOption[];
  availableSubjects: string[];

  qpId: string;
  /** Changing the question paper invalidates the OCR pass that used the old one. */
  changeQuestionPaper: (id: string) => void;
  markingSchemeId: string;
  changeMarkingScheme: (id: string) => void;
  modelAnswerId: string;
  changeModelAnswer: (id: string) => void;

  studentName: string;
  setStudentName: (name: string) => void;
  analysisClassKey: string;
  /** Picks the class and moves the subject with it, as the `<select>` did. */
  chooseClass: (classKey: string) => void;
  analysisSubject: string;
  setAnalysisSubject: (subject: string) => void;
  /** "Class 6C", or '' when the class and subject do not resolve to a mapping. */
  analysisGrade: string;

  alreadyGraded: boolean;
  reanalysisReason: string;
  setReanalysisReason: (reason: string) => void;

  progress: number;
  running: boolean;
  gradeError: string;

  ocrDocuments: OcrDocuments | null;
  updateOcr: (role: OcrDocumentRole, text: string) => void;
  /** The teacher's confirmation. Cleared by any edit to the extracted text. */
  ocrValidated: boolean;
  setOcrValidated: (validated: boolean) => void;

  pendingAnalysis: PendingAnalysis | null;
  updateQuestion: (id: string, patch: Partial<EvaluatorQuestion>) => void;
  evaluationErrors: string[];

  /** The one action button: extracts text, or analyses, or submits. */
  grade: () => Promise<void>;
  submitEvaluation: () => Promise<void>;
};

/** The djb2-ish hash the web app used inline, over the validated OCR text. */
function textHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  return hash;
}

export function useGradeRun({
  assessment,
  file,
  state,
  setState,
  update,
  open,
  notify,
  diagnosisOnly = false,
  openAssessment,
  close,
}: GradeRunInput): GradeRun {
  const candidates: UploadFile[] = (assessment.files || []).filter((f) => f.id !== file.id);
  const questionPapers = candidates.filter(
    (f) => f.documentRole === 'Question paper' || (!f.documentRole && /question|paper|qp/i.test(f.name)),
  );
  const markingSchemes = candidates.filter(
    (f) =>
      f.documentRole === 'Marking scheme' ||
      (!f.documentRole && /marking.?scheme|mark.?scheme/i.test(f.name)),
  );
  const modelAnswers = candidates.filter(
    (f) =>
      f.documentRole === 'Model answer' ||
      (!f.documentRole && /answer.?key|model.?answer|solutions?/i.test(f.name)),
  );
  const otherQuestionPaperChoices = candidates.filter(
    (f) => !questionPapers.some((q) => q.id === f.id),
  );

  const mappingOptions = classSubjectOptions(state);
  const initialClassKey =
    assessment.grade && assessment.section
      ? `${assessment.grade}|${assessment.section.toUpperCase()}`
      : mappingOptions[0]?.classKey || '';

  const [qpId, setQpId] = useState(questionPapers[0]?.id || '');
  const [markingSchemeId, setMarkingSchemeId] = useState(markingSchemes[0]?.id || '');
  const [modelAnswerId, setModelAnswerId] = useState(modelAnswers[0]?.id || '');
  const [studentName, setStudentName] = useState(() => guessStudentName(file, state.students));
  const [analysisClassKey, setAnalysisClassKey] = useState(initialClassKey);

  const availableSubjects = Array.from(
    new Set(
      mappingOptions.filter((option) => option.classKey === analysisClassKey).map((o) => o.subject),
    ),
  );
  const [analysisSubject, setAnalysisSubject] = useState(() =>
    availableSubjects.includes(assessment.subject) ? assessment.subject : availableSubjects[0] || '',
  );
  const selectedMapping = mappingOptions.find(
    (option) => option.classKey === analysisClassKey && option.subject === analysisSubject,
  );
  const analysisGrade = selectedMapping
    ? `Class ${selectedMapping.grade}${selectedMapping.section}`
    : '';

  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const [ocrDocuments, setOcrDocuments] = useState<OcrDocuments | null>(null);
  const [ocrValidated, setOcrValidated] = useState(false);
  const [reanalysisReason, setReanalysisReason] = useState('');
  const [gradeError, setGradeError] = useState('');
  const [pendingAnalysis, setPendingAnalysis] = useState<PendingAnalysis | null>(null);
  const [evaluationErrors, setEvaluationErrors] = useState<string[]>([]);

  const stored = assessment.gradeResults?.[file.id];
  const alreadyGraded = Boolean(stored && !stored.gradingSkipped);

  /** A different reference document means the extracted text no longer matches it. */
  const resetReferenceOcr = () => {
    setOcrDocuments(null);
    setOcrValidated(false);
    setProgress(0);
    setGradeError('');
  };
  const changeQuestionPaper = (id: string) => {
    setQpId(id);
    resetReferenceOcr();
  };
  const changeMarkingScheme = (id: string) => {
    setMarkingSchemeId(id);
    resetReferenceOcr();
  };
  const changeModelAnswer = (id: string) => {
    setModelAnswerId(id);
    resetReferenceOcr();
  };

  const chooseClass = (nextClass: string) => {
    const nextSubject = mappingOptions.find((option) => option.classKey === nextClass)?.subject || '';
    setAnalysisClassKey(nextClass);
    setAnalysisSubject(nextSubject);
  };

  const updateOcr = (role: OcrDocumentRole, text: string) => {
    setOcrDocuments((current) => ({ ...current, [role]: { ...current?.[role], text } }));
    // Text edited after the confirmation is text nobody has confirmed.
    setOcrValidated(false);
  };

  const updateQuestion = (id: string, patch: Partial<EvaluatorQuestion>) =>
    setPendingAnalysis((current) =>
      current
        ? {
            ...current,
            questions: current.questions.map((question) =>
              question.id === id
                ? {
                    ...question,
                    ...patch,
                    aiDisposition:
                      Object.prototype.hasOwnProperty.call(patch, 'awardedMarks') ||
                      Object.prototype.hasOwnProperty.call(patch, 'attemptState')
                        ? 'edited'
                        : question.aiDisposition,
                  }
                : question,
            ),
          }
        : current,
    );

  /**
   * Open the next queued sheet, or fall back to the module the run ends on.
   * Awaited rather than read inline because the queue lives in async storage.
   */
  const advance = async (fallback: 'X-Ray' | 'Review') => {
    const nextFileId = await advanceBulkAnalysisQueue(assessment.id, file.id);
    const nextFile = (assessment.files || []).find((item) => item.id === nextFileId);
    close();
    setTimeout(
      () =>
        nextFile
          ? open(`${analysisDialogFor(nextFile)}:${nextFile.id}`)
          : openAssessment(assessment.id, fallback),
      250,
    );
  };

  const submitEvaluation = async () => {
    if (!pendingAnalysis) return;
    setRunning(true);
    setEvaluationErrors([]);
    setGradeError('');
    try {
      const questions = pendingAnalysis.questions.map((question) => ({
        ...question,
        awardedMarks: Number(question.awardedMarks),
        maxMarks: Number(question.maxMarks),
      }));
      const response = await authFetch('/api/evaluations/submit', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          assessmentId: assessment.id,
          fileId: file.id,
          studentName: pendingAnalysis.result.studentName,
          assessmentVersion: assessment.version || 1,
          questionPaperFileId: qpId || undefined,
          questions,
          pages: [{ pageNumber: 1, disposition: 'contains_reviewed_answer' }],
          expectedMaxMarks: pendingAnalysis.result.maxMarks,
          evaluatorConfirmation: true,
          idempotencyKey: `evaluation:${assessment.id}:${file.id}:${Math.abs(
            textHash(pendingAnalysis.result.evidenceFingerprint || ''),
          )}`,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setEvaluationErrors(Array.isArray(payload.errors) ? payload.errors : []);
        throw new Error(payload.error || 'Evaluation submission failed');
      }
      const result: GradeResult = {
        ...pendingAnalysis.result,
        score: Number(payload.evaluation.total_awarded),
        questionDecisions: questions,
        evaluationVersionId: payload.evaluation.id,
        evaluationVersion: Number(payload.evaluation.version_number),
        evaluationStatus: payload.evaluation.status,
      };
      update(assessment.id, {
        grade: selectedMapping?.grade || assessment.grade,
        section: selectedMapping?.section || assessment.section,
        subject: analysisSubject,
        maxMarks: result.maxMarks,
        gradeResults: { ...(assessment.gradeResults || {}), [file.id]: result },
        gradedFileIds: Array.from(new Set([...(assessment.gradedFileIds || []), file.id])),
        lastGradedFileId: file.id,
        stage: ['draft', 'uploaded', 'setup'].includes(assessment.stage)
          ? 'review'
          : assessment.stage,
      });
      notify(
        `${result.studentName}'s immutable evaluation v${result.evaluationVersion} was submitted. Reports are generating in the background.`,
      );
      void generateAllStudentResources(
        { ...assessment, subject: analysisSubject, grade: selectedMapping?.grade || assessment.grade },
        result,
        setState,
      )
        .then(() => notify(`All reports are ready for ${result.studentName} in Resources.`))
        .catch((error) =>
          notify(
            error instanceof Error ? error.message : 'Background report generation failed',
            'error',
          ),
        );
      const nextFileId = await advanceBulkAnalysisQueue(assessment.id, file.id);
      const nextFile = (assessment.files || []).find((item) => item.id === nextFileId);
      setTimeout(
        () =>
          open(
            nextFile ? `${analysisDialogFor(nextFile)}:${nextFile.id}` : `student-gaps:${file.id}`,
          ),
        250,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Evaluation submission failed';
      setGradeError(message);
      notify(message, 'error');
    } finally {
      setRunning(false);
    }
  };

  const grade = async () => {
    if (pendingAnalysis) {
      await submitEvaluation();
      return;
    }
    if (!studentName.trim()) {
      notify("Enter the student's name before grading.", 'warning');
      return;
    }
    if (!qpId) {
      notify('A question paper is compulsory before learning-gap analysis can start.', 'warning');
      return;
    }
    if (!analysisSubject.trim() || !analysisGrade.trim()) {
      notify('Subject and Class are required before generating learning gaps.', 'warning');
      return;
    }
    if (alreadyGraded && !reanalysisReason.trim()) {
      notify('Enter a Reason for Reanalysis before starting.', 'warning');
      return;
    }
    // The gate. Extraction is allowed with nothing confirmed; analysis is not.
    if (ocrDocuments && !ocrValidated) {
      notify(
        'Confirm you have checked the extracted text before learning-gap analysis starts.',
        'warning',
      );
      return;
    }

    const validatedOcr = [
      ocrDocuments?.answerSheet?.text || '',
      ocrDocuments?.questionPaper?.text || '',
      ocrDocuments?.markingScheme?.text || '',
      ocrDocuments?.modelAnswer?.text || '',
    ].join('|');
    const ocrHash = textHash(validatedOcr);
    const evidenceFingerprint = [
      file.id,
      qpId,
      markingSchemeId,
      modelAnswerId,
      assessment.answerKey || '',
      assessment.rubric || '',
      analysisSubject,
      analysisGrade,
      ocrHash,
      alreadyGraded ? reanalysisReason.trim() : '',
    ].join('|');

    const previous = assessment.gradeResults?.[file.id];
    if (
      ocrDocuments &&
      previous?.evidenceFingerprint === evidenceFingerprint &&
      !(previous.gradingSkipped && !diagnosisOnly)
    ) {
      notify(
        `This evidence has not changed. The fixed score and learning gaps for ${previous.studentName} were reused.`,
      );
      open(`student-gaps:${file.id}`);
      return;
    }

    setGradeError('');
    setRunning(true);
    let p = 0;
    const timer = setInterval(() => {
      p = Math.min(90, p + 15);
      setProgress(p);
    }, 180);
    try {
      const answerSheet = await readFile(file.id);
      if (!answerSheet)
        throw new Error(
          "This file's data could not be found in local storage. Try re-uploading it.",
        );
      const fileBase64 = await answerSheet.base64();

      const qp = candidates.find((f) => f.id === qpId);
      const qpStored = qpId ? await readFile(qpId) : null;
      const markingSchemeFile = candidates.find((f) => f.id === markingSchemeId);
      const markingSchemeStored = markingSchemeId ? await readFile(markingSchemeId) : null;
      const modelAnswerFile = candidates.find((f) => f.id === modelAnswerId);
      const modelAnswerStored = modelAnswerId ? await readFile(modelAnswerId) : null;

      if (qpId && !qp)
        throw new Error(
          'The selected question paper is no longer in Uploaded evidence. Select it again.',
        );
      if (qpId && !qpStored)
        throw new Error(
          'The selected question paper could not be loaded. Preview it in Uploaded evidence or re-upload it.',
        );
      if (markingSchemeId && !markingSchemeStored)
        throw new Error('The assessment marking scheme could not be loaded.');
      if (modelAnswerId && !modelAnswerStored)
        throw new Error('The assessment model answer could not be loaded.');

      if (!ocrDocuments) {
        const documents = [
          {
            id: 'answerSheet',
            name: file.name,
            base64: fileBase64,
            mimeType: file.type || 'application/pdf',
          },
          ...(await referenceDocument('questionPaper', qpStored, qp, 'Question paper')),
          ...(await referenceDocument('markingScheme', markingSchemeStored, markingSchemeFile, 'Marking scheme')),
          ...(await referenceDocument('modelAnswer', modelAnswerStored, modelAnswerFile, 'Model answer')),
        ];
        const ocrResponse = await authFetch('/api/ocr', {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ documents }),
        });
        const ocrPayload = await ocrResponse.json();
        logApiTiming(setState, ocrPayload?.timing);
        if (!ocrResponse.ok) throw new Error(ocrPayload?.error || 'OCR request failed');
        const cleanDocuments = Object.fromEntries(
          Object.entries((ocrPayload.documents || {}) as Record<string, OcrDocument>).map(
            ([id, document]) => [id, { ...document, text: normalizeOcrText(document?.text || '') }],
          ),
        );
        clearInterval(timer);
        setProgress(100);
        setOcrDocuments(cleanDocuments);
        setOcrValidated(false);
        notify('Mistral OCR is complete. Review and correct the extracted text before validation.');
        return;
      }

      const res = await authFetch('/api/grade', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          subject: analysisSubject,
          className: analysisGrade,
          studentName: studentName.trim(),
          fileName: file.name,
          documentRole: file.documentRole || inferDocumentRole(file.name),
          maxMarks: assessment.maxMarks,
          answerKey: assessment.answerKey,
          rubric: assessment.rubric,
          ocrText: ocrDocuments.answerSheet?.text,
          questionPaperText: ocrDocuments.questionPaper?.text,
          questionPaperName: qp?.name,
          markingSchemeText: ocrDocuments.markingScheme?.text,
          markingSchemeName: markingSchemeFile?.name,
          modelAnswerText: ocrDocuments.modelAnswer?.text,
          modelAnswerName: modelAnswerFile?.name,
          reanalysisReason: alreadyGraded ? reanalysisReason.trim() : undefined,
          operationKey: `analysis:${assessment.id}:${file.id}:${Math.abs(ocrHash)}`,
        }),
      });
      const payload = await res.json();
      logApiTiming(setState, payload?.timing);
      if (!res.ok) throw new Error(payload?.error || 'Grading request failed');
      clearInterval(timer);
      setProgress(100);

      const gaps: Gap[] = ((payload.gaps || []) as Gap[])
        .map((g) => ({
          concept: String(g.concept),
          mastery: Math.max(0, Math.min(100, Math.round(Number(g.mastery)))),
          finding: String(g.finding || ''),
          misconception: String(g.misconception || ''),
          evidence: String(g.evidence || ''),
          prerequisiteConcept: String(g.prerequisiteConcept || ''),
          foundationGap: String(g.foundationGap || ''),
          recommendedLevel: String(g.recommendedLevel || ''),
          remediationSequence: Array.isArray(g.remediationSequence)
            ? g.remediationSequence.map(String)
            : [],
          rework: String(g.rework || ''),
          severity: ['priority', 'developing', 'secure'].includes(g.severity ?? '')
            ? g.severity
            : undefined,
        }))
        .sort((a, b) => a.mastery - b.mastery);
      const detectedMaxMarks = Math.max(
        1,
        Math.round(Number(payload.maxMarks) || assessment.maxMarks),
      );
      const questions: EvaluatorQuestion[] = ((payload.questions || []) as EvaluatorQuestion[]).map(
        (question) => ({
          ...question,
          allowedIncrement: ALLOWED_INCREMENTS.includes(Number(question.allowedIncrement))
            ? Number(question.allowedIncrement)
            : 0.5,
          reviewed: false,
          aiDisposition: 'accepted',
        }),
      );
      const score = questions.reduce((sum, question) => sum + Number(question.awardedMarks || 0), 0);
      const result: GradeResult = {
        fileId: file.id,
        studentName: studentName.trim(),
        questionPaperFileId: qpId || undefined,
        questionPaperName: qp?.name,
        score,
        maxMarks: detectedMaxMarks,
        gaps,
        date: new Date().toISOString(),
        feedback: typeof payload.feedback === 'string' ? payload.feedback : undefined,
        ocrText: ocrDocuments.answerSheet?.text,
        evidenceFingerprint,
        reanalysisReason: alreadyGraded ? reanalysisReason.trim() : undefined,
        questionDecisions: questions,
        gradingSkipped: diagnosisOnly || undefined,
      };

      if (diagnosisOnly) {
        update(assessment.id, {
          grade: selectedMapping?.grade || assessment.grade,
          section: selectedMapping?.section || assessment.section,
          subject: analysisSubject,
          maxMarks: detectedMaxMarks,
          gradeResults: { ...(assessment.gradeResults || {}), [file.id]: result },
          lastGradedFileId: file.id,
          stage: 'xray',
        });
        notify(
          `${result.studentName}'s teacher-awarded marks were analysed. Reports are generating in the background.`,
        );
        void generateAllStudentResources(
          {
            ...assessment,
            subject: analysisSubject,
            grade: selectedMapping?.grade || assessment.grade,
          },
          result,
          setState,
        )
          .then(() => notify(`All reports are ready for ${result.studentName} in Resources.`))
          .catch((error) =>
            notify(
              error instanceof Error ? error.message : 'Background report generation failed',
              'error',
            ),
          );
        await advance('X-Ray');
      } else {
        update(assessment.id, {
          grade: selectedMapping?.grade || assessment.grade,
          section: selectedMapping?.section || assessment.section,
          subject: analysisSubject,
          maxMarks: result.maxMarks,
          gradeResults: { ...(assessment.gradeResults || {}), [file.id]: result },
          gradedFileIds: Array.from(new Set([...(assessment.gradedFileIds || []), file.id])),
          lastGradedFileId: file.id,
          stage: 'review',
          reviewed: 0,
          totalReviews: questions.length,
        });
        notify(`${result.studentName}'s AI grading is ready in the Review tab.`);
        await advance('Review');
      }
    } catch (err) {
      clearInterval(timer);
      const message = err instanceof Error ? err.message : 'Grading failed';
      setGradeError(message);
      notify(`Grading failed: ${message}`, 'error');
    } finally {
      setRunning(false);
    }
  };

  // A bulk run opens each sheet in turn and expects the extraction to have
  // started by the time the teacher looks at it. One shot per mounted dialog,
  // guarded by the ref; the guards themselves are read through a second ref so
  // this effect depends only on the file it is for.
  const autoOcrStarted = useRef(false);
  const autoStart = useRef<() => void>(() => {});
  useEffect(() => {
    autoStart.current = () => {
      if (autoOcrStarted.current || ocrDocuments || running || alreadyGraded) return;
      autoOcrStarted.current = true;
      void grade();
    };
  });

  useEffect(() => {
    let alive = true;
    void bulkAnalysisQueue(assessment.id).then((queue) => {
      if (alive && queue.includes(file.id)) autoStart.current();
    });
    return () => {
      alive = false;
    };
  }, [assessment.id, file.id]);

  return {
    candidates,
    questionPapers,
    markingSchemes,
    modelAnswers,
    otherQuestionPaperChoices,
    mappingOptions,
    availableSubjects,
    qpId,
    changeQuestionPaper,
    markingSchemeId,
    changeMarkingScheme,
    modelAnswerId,
    changeModelAnswer,
    studentName,
    setStudentName,
    analysisClassKey,
    chooseClass,
    analysisSubject,
    setAnalysisSubject,
    analysisGrade,
    alreadyGraded,
    reanalysisReason,
    setReanalysisReason,
    progress,
    running,
    gradeError,
    ocrDocuments,
    updateOcr,
    ocrValidated,
    setOcrValidated,
    pendingAnalysis,
    updateQuestion,
    evaluationErrors,
    grade,
    submitEvaluation,
  };
}

/**
 * One reference document for the OCR payload, or nothing when it was not
 * supplied. Spread into the list so an absent marking scheme contributes no
 * entry, exactly as the web's conditional array did.
 */
async function referenceDocument(
  id: OcrDocumentRole,
  stored: StoredFile | null,
  file: UploadFile | undefined,
  fallbackName: string,
): Promise<{ id: string; name: string; base64: string; mimeType: string }[]> {
  if (!stored) return [];
  return [
    {
      id,
      name: file?.name || fallbackName,
      base64: await stored.base64(),
      mimeType: file?.type || 'application/pdf',
    },
  ];
}
