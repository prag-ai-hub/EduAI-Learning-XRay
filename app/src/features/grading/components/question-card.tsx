/**
 * `.review-question-card` - one question, in the five stages the teacher works
 * through.
 *
 * Ported from the `<article className="review-question-card">` block of
 * frontend/app/ui/FunctionalEduAIApp.tsx `Review` (~530-545). The five stages
 * are the review: the question, the handwriting, the extracted text, what the
 * model awarded, and what the teacher decides. They are numbered on screen
 * because skipping straight to stage five is exactly the habit the order exists
 * to break - a mark is only defensible against the evidence above it.
 *
 * The card is presentational. Drafts, autosave and totals belong to
 * `useReviewDrafts`; this file renders one question and reports one change.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTES
 * ---------------------------------------------------------------------------
 * * The web put the mark in `<input type="number" step={allowedIncrement}>`.
 *   There is no number input here, so it is a stepper, and `clampToIncrement`
 *   from the evaluator workspace is the shared rule - a rubric that awards in
 *   halves cannot be given 1.3 from either screen.
 * * Stage two embedded a PDF page with `<object data={url}#page=N>`. React
 *   Native has no document embed: an image answer sheet renders inline, and
 *   anything else offers "Expand original page", which the screen resolves
 *   through the platform viewer.
 * * "Copy" used `navigator.clipboard`, which does not exist on a device and no
 *   clipboard module is installed. The action takes `onCopyOcr` when the screen
 *   can provide one, falls back to the browser clipboard on web, and is hidden
 *   where neither is available rather than shown as a button that does nothing.
 */

import { Image, Platform, Pressable, Text, View, type ViewStyle } from 'react-native';

import { clampToIncrement } from '@/features/grading/components/evaluator-workspace';
import type { ReviewDraft } from '@/features/grading/hooks/use-review-drafts';
import { AppButton, LinkButton } from '@/shared/components/buttons';
import { Checkbox, Field } from '@/shared/components/form';
import { Eyebrow } from '@/shared/components/primitives';
import { StatusPill, type StatusTone } from '@/shared/components/status';
import { Space, useAppStyles } from '@/shared/theme/styles';
import type { EvaluatorQuestion } from '@/shared/types/workspace';

/**
 * Centres the filename inside the answer-sheet placeholder.
 *
 * The web rendered the real page here - `<object data={sourceUrl}#page=N>` -
 * and React Native has no embedded document viewer, so this is a labelled card
 * with "Expand original page" beside it, which opens the file in whatever the
 * platform uses. `answerDocument` already carries the box; only the alignment
 * of the text inside it is new, which is why this is structural and local
 * rather than a theme key.
 */
const documentPlaceholder = { alignItems: 'center' as const, justifyContent: 'center' as const };


/** How the model's proposal fared, once the teacher has been through it. */
const DISPOSITION: Record<EvaluatorQuestion['aiDisposition'], { label: string; tone: StatusTone }> =
  {
    accepted: { label: 'AI accepted', tone: 'success' },
    edited: { label: 'Teacher edited', tone: 'warning' },
    rejected: { label: 'AI rejected', tone: 'red' },
  };

export type QuestionCardProps = {
  question: EvaluatorQuestion;
  /** Its position on the page, so the toggle reads "Q1" not "Q7". */
  index: number;
  draft: ReviewDraft;
  onChange: (patch: Partial<ReviewDraft>) => void;
  collapsed: boolean;
  onToggle: () => void;
  /** "Saved" / "Saving…" / "✓ Auto-saved" from `useReviewDrafts`. */
  saveStatus: string;

  /** A renderable URI for the answer sheet, or '' when it is unavailable. */
  sourceUri?: string;
  answerFileName?: string;
  /** True when the uploaded sheet is an image and can be shown inline. */
  answerIsImage?: boolean;
  /** The page this question was found on, named in the expand action. */
  pageNumber?: number;
  /** Opens the original in the platform viewer. Omit to hide the action. */
  onOpenOriginal?: () => void;

  /** The whole sheet's OCR text, shown when the question stored no excerpt. */
  ocrFallback?: string;
  /** The result's feedback, shown when the question stored no rationale. */
  feedbackFallback?: string;
  /** Copies the OCR excerpt. Omit on web to use the browser clipboard. */
  onCopyOcr?: (text: string) => void;
};

export function QuestionCard({
  question,
  index,
  draft,
  onChange,
  collapsed,
  onToggle,
  saveStatus,
  sourceUri,
  answerFileName,
  answerIsImage,
  pageNumber,
  onOpenOriginal,
  ocrFallback,
  feedbackFallback,
  onCopyOcr,
}: QuestionCardProps) {
  const s = useAppStyles();
  const aiMark = question.aiAwardedMarks ?? question.awardedMarks;
  const ocrText = question.evidence || ocrFallback || 'No stored OCR excerpt for this question.';
  const disposition = DISPOSITION[question.aiDisposition] ?? DISPOSITION.accepted;

  const clipboard = (
    globalThis as { navigator?: { clipboard?: { writeText: (text: string) => Promise<void> } } }
  ).navigator?.clipboard;
  const canCopy = Boolean(onCopyOcr) || (Platform.OS === 'web' && Boolean(clipboard));
  const copy = () => {
    const text = question.evidence || ocrFallback || '';
    if (onCopyOcr) {
      onCopyOcr(text);
      return;
    }
    void clipboard?.writeText(text);
  };

  const status = draft.reviewed
    ? '✓ Reviewed'
    : question.attemptState === 'not_attempted'
      ? 'Not Answered'
      : 'Pending';

  return (
    <View style={[s.reviewQuestionCard, draft.reviewed && s.reviewQuestionCardReviewed]}>
      {/* `.review-question-card::before` - the timeline dot in the left gutter. */}
      <View style={s.reviewQuestionCardDot} />

      {/* `<button className="review-question-toggle">` - the whole header is
          the tap target, and it carries three values rather than one label, so
          it is a Pressable rather than an AppButton. */}
      <Pressable
        role="button"
        accessibilityLabel={`${question.label}. ${status}`}
        accessibilityState={{ expanded: !collapsed }}
        onPress={onToggle}
        style={({ pressed, hovered }) => [
          s.reviewQuestionToggle,
          (hovered || pressed) && s.rowButtonHover,
        ]}>
        <Text style={s.reviewQuestionToggleTitle}>{`Q${index + 1} · ${status}`}</Text>
        <Text style={s.reviewQuestionToggleMeta}>
          {draft.reviewed ? `${draft.mark}/${question.maxMarks}` : `—/${question.maxMarks}`}
        </Text>
        <Text style={s.reviewQuestionToggleMeta}>{collapsed ? '▾' : '▴'}</Text>
      </Pressable>

      {collapsed ? null : (
        <View style={s.fiveStageReview}>
          {/* 1 */}
          <View style={s.fiveStageSection}>
            <View style={sectionBody}>
              <Eyebrow>1. Question</Eyebrow>
              <View style={s.reviewSectionHead}>
                <Text accessibilityRole="header" style={s.reviewSectionHeadTitle}>
                  {question.label}
                </Text>
                <View style={s.reviewSectionHeadPill}>
                  <Text
                    style={s.reviewSectionHeadPillText}>{`${question.maxMarks} Marks`}</Text>
                </View>
              </View>
              <StatusPill tone={disposition.tone}>{disposition.label}</StatusPill>
            </View>
          </View>

          {/* 2 */}
          <View style={s.fiveStageSection}>
            <View style={sectionBody}>
              <Eyebrow>2. Student Handwritten Answer</Eyebrow>
            </View>
            {sourceUri && answerIsImage ? (
              <View style={s.answerImageWrap}>
                <Image
                  source={{ uri: sourceUri }}
                  style={s.answerImage}
                  resizeMode="contain"
                  accessibilityLabel={`Original handwritten answer for ${question.label}`}
                />
                {onOpenOriginal ? (
                  <AppButton title="Expand original" onPress={onOpenOriginal} />
                ) : null}
              </View>
            ) : sourceUri ? (
              <View style={s.answerDocumentWrap}>
                <View style={[s.answerDocument, documentPlaceholder]}>
                  <Text style={s.reviewEmptyText}>
                    {answerFileName || 'Answer sheet'}
                    {pageNumber ? ` · page ${pageNumber}` : ''}
                  </Text>
                </View>
                {onOpenOriginal ? (
                  <AppButton
                    title={pageNumber ? 'Expand original page' : 'Expand original'}
                    onPress={onOpenOriginal}
                  />
                ) : null}
              </View>
            ) : (
              <View style={[s.reviewEmpty, sectionBody]}>
                <Text style={s.reviewEmptyText}>
                  Original file is unavailable on this device. Re-open or re-upload the secured
                  answer sheet.
                </Text>
              </View>
            )}
          </View>

          {/* 3 */}
          <View style={s.fiveStageSection}>
            <View style={sectionBody}>
              <View style={s.reviewSectionHead}>
                <Eyebrow>3. OCR (Extracted Text)</Eyebrow>
                {canCopy ? (
                  <LinkButton
                    title="Copy"
                    accessibilityLabel={`Copy the extracted text for ${question.label}`}
                    onPress={copy}
                  />
                ) : null}
              </View>
              <Text style={s.ocrReviewText}>{ocrText}</Text>
            </View>
          </View>

          {/* 4 */}
          <View style={[s.fiveStageSection, s.aiMarkingPanel]}>
            <View style={s.aiMarkingBody}>
              <Eyebrow>4. Marking Done by AI</Eyebrow>
              <View style={s.reviewSectionHead}>
                <Text accessibilityRole="header" style={s.reviewSectionHeadTitle}>
                  AI Awarded Marks
                </Text>
                <Text style={s.aiMarkingScore}>{`${aiMark} / ${question.maxMarks}`}</Text>
              </View>
              <Text style={s.labelText}>AI Evaluation / Feedback</Text>
              <Text style={s.aiMarkingText}>
                {question.rationale || feedbackFallback || 'No AI feedback stored.'}
              </Text>
              {question.confidence > 0 ? (
                <Text style={s.teacherMarkNote}>
                  {`AI confidence: ${Math.round(question.confidence * 100)}%`}
                </Text>
              ) : null}
            </View>
          </View>

          {/* 5 */}
          <View style={[s.fiveStageSection, s.teacherEditPanel]}>
            <View style={s.teacherEditBody}>
              <Eyebrow>5. Edit Marks &amp; Comments — Teacher</Eyebrow>
              <View style={s.teacherMarkRow}>
                <View style={s.teacherEditLabel}>
                  <Text style={s.teacherEditLabelText}>Teacher Edited Marks</Text>
                  <View style={stepperRow}>
                    <AppButton
                      title="−"
                      accessibilityLabel={`Decrease the mark for ${question.label}`}
                      disabled={draft.mark <= 0}
                      onPress={() =>
                        onChange({
                          mark: clampToIncrement(
                            draft.mark - (question.allowedIncrement || 0.5),
                            question.maxMarks,
                            question.allowedIncrement,
                          ),
                        })
                      }
                    />
                    <View style={[s.teacherEditInput, stepperValue]}>
                      <Text style={s.trText}>{`${draft.mark} / ${question.maxMarks}`}</Text>
                    </View>
                    <AppButton
                      title="＋"
                      accessibilityLabel={`Increase the mark for ${question.label}`}
                      disabled={draft.mark >= question.maxMarks}
                      onPress={() =>
                        onChange({
                          mark: clampToIncrement(
                            draft.mark + (question.allowedIncrement || 0.5),
                            question.maxMarks,
                            question.allowedIncrement,
                          ),
                        })
                      }
                    />
                  </View>
                </View>
                <Text style={s.teacherMarkNote}>
                  {aiMark === draft.mark
                    ? `Same as AI: ${aiMark}/${question.maxMarks}`
                    : `AI ${aiMark}/${question.maxMarks} → Teacher ${draft.mark}/${question.maxMarks}`}
                </Text>
              </View>

              <Field
                label="Teacher Comments (Optional)"
                type="textarea"
                value={draft.comment}
                onChangeValue={(comment) => onChange({ comment })}
                placeholder="Add feedback for this answer…"
                inputProps={{ style: [s.teacherEditInput, s.teacherEditTextarea, s.textarea] }}
              />

              <View style={s.teacherSaveRow}>
                <Text style={s.teacherSaveRowText}>{saveStatus}</Text>
                <Checkbox
                  label="Mark as reviewed"
                  checked={draft.reviewed}
                  onCheckedChange={(reviewed) => onChange({ reviewed })}
                />
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

/* ------------------------------------------------------------------------- *
 * Shapes the CSS expressed through the cascade, which RN has none of.
 * ------------------------------------------------------------------------- */

/** `.five-stage-review > section` padded its own contents. */
const sectionBody: ViewStyle = { padding: Space.s11, gap: Space.s4 };

const stepperRow: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: Space.s8 };

const stepperValue: ViewStyle = {
  flexGrow: 1,
  flexShrink: 1,
  minWidth: Space.s72,
  alignItems: 'center',
  justifyContent: 'center',
};
