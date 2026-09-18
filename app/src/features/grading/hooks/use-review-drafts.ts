/**
 * The teacher's working copy of one student's grading review.
 *
 * Ported from the state half of frontend/app/ui/FunctionalEduAIApp.tsx `Review`
 * (~476-530). The screen that renders it is a separate file; everything that
 * decides what a mark IS lives here.
 *
 * Three things this owns and the screen must not duplicate:
 *
 *  1. **Drafts are not the result.** A mark the teacher types is held in
 *     `drafts` and written back through a 650 ms debounce, so a slider dragged
 *     across five values is one save, not five. `aiAwardedMarks` is stamped on
 *     the way out - the first save is what preserves what the model proposed.
 *  2. **An excluded question scores nothing.** Every total here filters
 *     `attemptState !== 'excluded'` before summing, which is the rule the
 *     server reconciles against.
 *  3. **A published result has been trimmed.** Its question decisions and OCR
 *     text live in the read model, not in the workspace blob, so they are
 *     fetched into component state - deliberately not back into `state`, which
 *     would re-inflate the snapshot that was trimmed to fit.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE - jumpTo
 * ---------------------------------------------------------------------------
 * The web's question navigator called
 * `document.getElementById(...).scrollIntoView()`. There is no document and no
 * element id here, so `jumpTo` expands the question and publishes it as
 * `focusedId`; the screen owns the ScrollView and scrolls to the offset it
 * measured for that question. The hook stays free of layout, which is also what
 * lets the same drafts drive a phone and a desktop web layout.
 */

import { useEffect, useState } from 'react';

import { downloadCorrectedAnswerSheet } from '@/features/documents/lib/downloads';
import { hydrateResult } from '@/features/workspace/lib/read-model';
import { generateAllStudentResources } from '@/features/workspace/lib/resources';
import { useResetOnChange } from '@/shared/hooks/use-reset-on-change';
import type { EvaluatorQuestion, GradeResult, UploadFile, W } from '@/shared/types/workspace';

/** One question's unsaved state: the mark, the comment, and whether it is done. */
export type ReviewDraft = { mark: number; comment: string; reviewed: boolean };

export type ReviewDrafts = Record<string, ReviewDraft>;

export type ReviewDraftsInput = W<'assessment' | 'update' | 'notify' | 'setState'> & {
  /** Every graded sheet on the assessment - what "bulk approve" covers. */
  results: GradeResult[];
  /** The student being reviewed. Undefined before anything has been graded. */
  current?: GradeResult;
  /** The uploaded sheet the review is against, for the corrected copy. */
  answerFile?: UploadFile;
};

export type ReviewDraftsState = {
  /** `current`, with its published detail fetched back when there was any. */
  active?: GradeResult;
  questions: EvaluatorQuestion[];
  /** True while the read model is being fetched; the screen shows a wait panel. */
  hydrating: boolean;

  drafts: ReviewDrafts;
  /** The draft for one question, falling back to what the grader proposed. */
  draftFor: (question: EvaluatorQuestion) => ReviewDraft;
  changeDraft: (id: string, patch: Partial<ReviewDraft>) => void;
  collapsed: Record<string, boolean>;
  toggleCollapsed: (id: string) => void;
  /** "Saved" / "Saving…" / "✓ Auto-saved", as the teacher panel prints it. */
  saveStatus: string;

  reviewedCount: number;
  pendingCount: number;
  aiTotal: number;
  teacherTotal: number;
  /** The answer-sheet pages the questions fall on, ascending. */
  pageNumbers: number[];

  /** Expanded and published for the screen to scroll to. See the platform note. */
  jumpTo: (id: string) => void;
  focusedId: string;

  submitReview: () => void;
  bulkApprove: () => void;
  createCorrectedCopy: () => Promise<void>;
  creatingCorrectedCopy: boolean;
};

const EMPTY_DRAFT: ReviewDraft = { mark: 0, comment: '', reviewed: false };

/** The teacher's award for a question, or the grader's when untouched. */
function markOf(question: EvaluatorQuestion, draft?: ReviewDraft): number {
  return draft?.mark ?? question.awardedMarks;
}

/** Marks total, excluding questions a choice rule took out of the paper. */
function scoreOf(questions: EvaluatorQuestion[]): number {
  return questions
    .filter((question) => question.attemptState !== 'excluded')
    .reduce((sum, question) => sum + Number(question.awardedMarks || 0), 0);
}

export function useReviewDrafts({
  assessment,
  results,
  current,
  answerFile,
  update,
  notify,
  setState,
}: ReviewDraftsInput): ReviewDraftsState {
  const [hydrated, setHydrated] = useState<GradeResult | null>(null);
  useResetOnChange(`${current?.fileId}|${current?.published}`, () => setHydrated(null));

  useEffect(() => {
    let alive = true;
    if (!current || current.questionDecisions?.length || !current.published) return;
    void hydrateResult(assessment.id, current).then((next) => {
      if (alive) setHydrated(next);
    });
    return () => {
      alive = false;
    };
    // Keyed on the result's identity, not its object reference: `current` is
    // rebuilt every render, so depending on it would refetch continuously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessment.id, current?.fileId, current?.published]);

  const active = hydrated ?? current;
  const questions = active?.questionDecisions || [];
  const hydrating = Boolean(
    current?.published && !current?.questionDecisions?.length && !hydrated,
  );

  const [drafts, setDrafts] = useState<ReviewDrafts>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [saveStatus, setSaveStatus] = useState('Saved');
  const [focusedId, setFocusedId] = useState('');
  const [creatingCorrectedCopy, setCreatingCorrectedCopy] = useState(false);

  useResetOnChange(current?.fileId, () => {
    setDrafts(
      Object.fromEntries(
        questions.map((question) => [
          question.id,
          {
            mark: Number(question.awardedMarks),
            comment: question.teacherComment || '',
            reviewed: Boolean(question.reviewed),
          },
        ]),
      ),
    );
    setCollapsed({});
    setSaveStatus('Saved');
    setFocusedId('');
  });

  const draftFor = (question: EvaluatorQuestion): ReviewDraft =>
    drafts[question.id] ?? {
      mark: Number(question.awardedMarks),
      comment: question.teacherComment || '',
      reviewed: Boolean(question.reviewed),
    };

  const reviewedCount = questions.filter((question) => draftFor(question).reviewed).length;
  const pendingCount = questions.length - reviewedCount;
  const aiTotal = questions.reduce(
    (sum, question) => sum + Number(question.aiAwardedMarks ?? question.awardedMarks),
    0,
  );
  const teacherTotal = questions.reduce(
    (sum, question) => sum + Number(markOf(question, drafts[question.id])),
    0,
  );
  const pageNumbers = Array.from(
    new Set(questions.map((question) => Math.max(1, Number(question.pageNumber) || 1))),
  ).sort((left, right) => left - right);

  const saveDrafts = (next: ReviewDrafts) => {
    if (!current) return;
    const questionDecisions = questions.map((question) => {
      const draft = next[question.id];
      return {
        ...question,
        // Stamped on the first save: without it an override would silently
        // replace what the model proposed and the audit trail would lose it.
        aiAwardedMarks: question.aiAwardedMarks ?? question.awardedMarks,
        awardedMarks: markOf(question, draft),
        teacherComment: draft?.comment || '',
        reviewed: Boolean(draft?.reviewed),
      };
    });
    update(assessment.id, {
      gradeResults: {
        ...(assessment.gradeResults || {}),
        [current.fileId]: { ...current, score: scoreOf(questionDecisions), questionDecisions },
      },
      reviewed: questionDecisions.filter((question) => question.reviewed).length,
      totalReviews: questionDecisions.length,
      stage: 'review',
    });
    setSaveStatus('✓ Auto-saved');
  };

  useEffect(() => {
    if (!current || !Object.keys(drafts).length) return;
    // Paired with the debounce timer below. The dependency list is `drafts`
    // alone on purpose: `saveDrafts` is recreated on every render, so including
    // it would restart the 650 ms timer forever and never actually save.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaveStatus('Saving…');
    const timer = setTimeout(() => saveDrafts(drafts), 650);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts]);

  const changeDraft = (id: string, patch: Partial<ReviewDraft>) =>
    setDrafts((value) => {
      // The base is the QUESTION's current state, not an empty draft. Drafts
      // are created lazily - a hydrated published result has awarded marks and
      // no draft entries at all - so starting from `{ mark: 0 }` meant the
      // first thing a teacher touched on a question decided its mark. Ticking
      // "reviewed" on an answer they agreed with, or typing a comment, silently
      // set that question to zero and auto-save wrote it 650ms later.
      //
      // `draftFor` already resolves this correctly for reading; the two must
      // not disagree about what an untouched question is worth.
      const question = questions.find((item) => item.id === id);
      const base = value[id] ?? (question ? draftFor(question) : EMPTY_DRAFT);
      return { ...value, [id]: { ...base, ...patch } };
    });

  const toggleCollapsed = (id: string) =>
    setCollapsed((value) => ({ ...value, [id]: !value[id] }));

  /** The result as approval would leave it: every question reviewed, marks final. */
  const approvedResult = (result: GradeResult, nextDrafts: ReviewDrafts): GradeResult => {
    const decisions = (result.questionDecisions || []).map((question) => {
      const draft = nextDrafts[question.id];
      return {
        ...question,
        aiAwardedMarks: question.aiAwardedMarks ?? question.awardedMarks,
        awardedMarks: markOf(question, draft),
        teacherComment: draft?.comment || question.teacherComment || '',
        reviewed: true,
      };
    });
    return { ...result, score: scoreOf(decisions), questionDecisions: decisions };
  };

  /** Generates the student's resources. Resolves true only if they were made.
   *
   * The boolean matters: the caller announces success, and a `.catch` that
   * reports the failure still RESOLVES the promise, so a `.then` behind it runs
   * anyway. That is what happened - a teacher whose resource generation failed
   * was told so, and then told immediately afterwards that their updated
   * resources were ready. */
  const fanOut = (result: GradeResult, failure: string): Promise<boolean> =>
    generateAllStudentResources(assessment, result, setState)
      .then(() => true)
      .catch((error) => {
        notify(error instanceof Error ? error.message : failure, 'error');
        return false;
      });

  const submitReview = () => {
    if (!current || pendingCount) return;
    const finalResult = approvedResult(current, drafts);
    saveDrafts(drafts);
    update(assessment.id, {
      stage: 'approved',
      reviewed: questions.length,
      totalReviews: questions.length,
      gradeResults: { ...(assessment.gradeResults || {}), [current.fileId]: finalResult },
    });
    notify('Review submitted. Resources are generating in the background.');
    void fanOut(finalResult, 'Resource generation failed').then((made) => {
      if (made) notify(`Updated resources are ready for ${finalResult.studentName}.`);
    });
  };

  const bulkApprove = () => {
    const approved = results.map((result) =>
      approvedResult(
        result,
        Object.fromEntries(
          (result.questionDecisions || []).map((question) => [
            question.id,
            {
              mark: question.awardedMarks,
              comment: question.teacherComment || '',
              reviewed: true,
            },
          ]),
        ),
      ),
    );
    const gradeResults = { ...(assessment.gradeResults || {}) };
    approved.forEach((result) => {
      gradeResults[result.fileId] = result;
    });
    const count = approved.reduce(
      (sum, result) => sum + (result.questionDecisions?.length || 0),
      0,
    );
    update(assessment.id, {
      stage: 'approved',
      reviewed: count,
      totalReviews: count,
      gradeResults,
    });
    notify(
      `Bulk approval started for ${approved.length} students. Resources will appear as they finish.`,
    );
    approved.forEach((result) => void fanOut(result, 'Background resource generation failed'));
  };

  const jumpTo = (id: string) => {
    setCollapsed((value) => ({ ...value, [id]: false }));
    setFocusedId(id);
  };

  const createCorrectedCopy = async () => {
    if (!current) return;
    if (!answerFile) {
      notify(
        'The original answer sheet is unavailable. Re-upload it before creating a corrected copy.',
        'error',
      );
      return;
    }
    setCreatingCorrectedCopy(true);
    try {
      await downloadCorrectedAnswerSheet(assessment, current, answerFile);
      notify(`Corrected answer sheet created for ${current.studentName}.`);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : 'The corrected answer sheet could not be created.',
        'error',
      );
    } finally {
      setCreatingCorrectedCopy(false);
    }
  };

  return {
    active,
    questions,
    hydrating,
    drafts,
    draftFor,
    changeDraft,
    collapsed,
    toggleCollapsed,
    saveStatus,
    reviewedCount,
    pendingCount,
    aiTotal,
    teacherTotal,
    pageNumbers,
    jumpTo,
    focusedId,
    submitReview,
    bulkApprove,
    createCorrectedCopy,
    creatingCorrectedCopy,
  };
}
