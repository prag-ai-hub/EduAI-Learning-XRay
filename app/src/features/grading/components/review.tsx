/**
 * The teacher's grading review - one student's answer sheet, page by page, with
 * every question's AI proposal beside the teacher's decision.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `Review` (~476).
 *
 * This file is layout only. What a mark IS - drafts, the 650 ms autosave, the
 * totals, hydrating a published result, approval and the resource fan-out -
 * belongs to `useReviewDrafts`, and each question's five stages to
 * `QuestionCard`. Keep it that way: the web inlined all of it, and the bug where
 * editing a comment zeroed the mark lived in exactly that inlining.
 *
 * AI marks stay proposals until the teacher acts. Nothing here approves on its
 * own, and approval is what starts `generateAllStudentResources` - which also
 * posts the result to /api/publish - so only two buttons may reach it: "Submit
 * Review", disabled until every question is ticked as reviewed, and "Bulk
 * Approval", the explicit teacher action the web offers for accepting every
 * student's proposals wholesale. Autosave only ever writes stage `review`.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTES
 * ---------------------------------------------------------------------------
 * * Jump to question. The web's navigator called `scrollIntoView` on
 *   `#review-question-<id>`. On web the same call is made on the card's host
 *   node, which react-native-web hands back as the DOM element. On a device
 *   the vertical ScrollView belongs to the workspace shell, which publishes it
 *   through `usePageScroll` - without that the navigator would expand the
 *   question and leave it off screen.
 * * The answer sheet. `useFileUri` replaces the hand-rolled
 *   `URL.createObjectURL` / `revokeObjectURL` pair. "Expand original page"
 *   appends `#page=N` on web only: the fragment is a browser PDF-viewer
 *   convention, and handed to a device viewer it is part of a file path that
 *   does not exist.
 * * Copy OCR. `navigator.clipboard` plus the "OCR text copied" toast on web.
 *   `expo-clipboard` is not a dependency, so a device offers the share sheet -
 *   the same substitution `features/share` makes for its copy-link button.
 * * The `.review-page > header small` filename is `display:none` in the web
 *   cascade, so it is not rendered at all.
 */

import { useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  Share,
  type StyleProp,
  StyleSheet,
  Text,
  type TextStyle,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import { openBrowserAsync } from 'expo-web-browser';

import { QuestionCard } from '@/features/grading/components/question-card';
import { useReviewDrafts } from '@/features/grading/hooks/use-review-drafts';
import { AppButton, ButtonRow, LinkButton } from '@/shared/components/buttons';
import { Select } from '@/shared/components/form';
import { usePageScroll } from '@/shared/components/page-scroll';
import { Card, CardSpan2, Eyebrow, PageHead } from '@/shared/components/primitives';
import { useFileUri } from '@/shared/hooks/use-file-uri';
import { layoutFor, useAppStyles } from '@/shared/theme/styles';
import type { Assessment, EvaluatorQuestion, GradeResult, W } from '@/shared/types/workspace';

/**
 * The page a question is filed under.
 *
 * `useReviewDrafts` builds `pageNumbers` with `Math.max(1, …)`, and the web then
 * filtered each page with `Number(pageNumber) || 1` - so a question stamped with
 * a negative page produced no page of its own and matched none. One rule for
 * both keeps every question on screen.
 */
function pageOf(question: EvaluatorQuestion): number {
  return Math.max(1, Number(question.pageNumber) || 1);
}

/** The status the card toggle and the navigator both print. */
function statusOf(question: EvaluatorQuestion, reviewed: boolean): string {
  if (reviewed) return 'Reviewed';
  return question.attemptState === 'not_attempted' ? 'Not Answered' : 'Pending';
}

type ScrollableNode = { scrollIntoView?: (options: ScrollIntoViewOptions) => void };

export function Review({
  selected,
  update,
  notify,
  open,
  setState,
}: W<'selected' | 'update' | 'notify' | 'open' | 'setState'>) {
  const s = useAppStyles();
  const { width } = useWindowDimensions();
  const wide = layoutFor(width) === 'wide';

  const assessment: Assessment = selected;
  const results = (Object.values(assessment.gradeResults || {}) as GradeResult[]).sort(
    (left, right) => left.date.localeCompare(right.date),
  );

  const [studentIndex, setStudentIndex] = useState(0);
  // Clamped once and used everywhere. The web clamped only `current`, so after
  // a result disappeared the picker went blank and "Next" stayed enabled.
  const index = Math.min(studentIndex, Math.max(0, results.length - 1));
  const current: GradeResult | undefined = results[index];
  const answerFile = current
    ? (assessment.files || []).find((file) => file.id === current.fileId)
    : undefined;

  const review = useReviewDrafts({
    assessment,
    results,
    current,
    answerFile,
    update,
    notify,
    setState,
  });
  const sourceUri = useFileUri(answerFile?.id);
  const answerIsImage = Boolean(answerFile?.type?.startsWith('image/'));

  // Host nodes, written only from ref callbacks and read only from the jump
  // handler - never during render.
  const questionNodes = useRef<Record<string, View | null>>({});
  const { reveal } = usePageScroll();

  const jumpTo = (id: string) => {
    review.jumpTo(id);
    // The web's 30 ms: a collapsed question has to render expanded before its
    // position is worth scrolling to.
    setTimeout(() => {
      const node = questionNodes.current[id];
      if (Platform.OS === 'web') {
        (node as unknown as ScrollableNode | null)?.scrollIntoView?.({
          behavior: 'smooth',
          block: 'start',
        });
        return;
      }
      // On a device the scrolling region is the shell's, which publishes it.
      reveal(node);
    }, 30);
  };

  const openOriginal = (pageNumber: number) => {
    const target =
      Platform.OS === 'web' && !answerIsImage ? `${sourceUri}#page=${pageNumber}` : sourceUri;
    // A device browser sheet accepts http(s) only, so a `file://` sheet can be
    // refused. Say so rather than leave a button that silently does nothing.
    void openBrowserAsync(target).catch(() =>
      notify('The original answer sheet could not be opened on this device.', 'error'),
    );
  };

  const clipboard = Platform.OS === 'web' ? globalThis.navigator?.clipboard : undefined;
  const copyOcr =
    Platform.OS !== 'web'
      ? (text: string) => void Share.share({ message: text })
      : clipboard
        ? (text: string) => void clipboard.writeText(text).then(() => notify('OCR text copied'))
        : undefined;

  if (!results.length || !current)
    return (
      <>
        <PageHead
          eyebrow={assessment.title}
          title="Teacher grading review"
          subtitle="This selected assessment is open and ready for its reviewed answer sheets."
        />
        <CardSpan2>
          <Eyebrow>No reviewed answers yet</Eyebrow>
          <Text accessibilityRole="header" style={s.cardTitle}>
            This assessment is loaded in Review
          </Text>
          <Text style={s.cardBody}>
            Add or process student answer sheets from the assessment evidence area; this direct
            Review route does not open an OCR confirmation pop-up.
          </Text>
        </CardSpan2>
      </>
    );

  if (review.hydrating)
    return (
      <>
        <PageHead
          eyebrow={assessment.title}
          title="Teacher grading review"
          subtitle="Loading the reviewed answers for this student."
        />
        <CardSpan2>
          <Eyebrow>Loading</Eyebrow>
          <Text accessibilityRole="header" style={s.cardTitle}>
            Fetching this student&apos;s reviewed answers…
          </Text>
          <Text style={s.cardBody}>
            Question-level decisions are stored with the published report rather than in your
            local workspace. This takes a moment.
          </Text>
        </CardSpan2>
      </>
    );

  const { questions, pageNumbers, draftFor } = review;
  const progress = current.maxMarks ? Math.round((review.teacherTotal / current.maxMarks) * 100) : 0;

  const navigatorSections = pageNumbers.map((pageNumber, pageIndex) => (
    <View key={pageNumber} style={s.questionNavigatorSection}>
      <Text style={s.questionNavigatorSectionTitle}>{`Page ${pageIndex + 1}`}</Text>
      {questions
        .filter((question) => pageOf(question) === pageNumber)
        .map((question) => {
          // `draftFor`, not `drafts[id]`: a hydrated published result has no
          // draft entries, and the web's navigator called its reviewed answers
          // "Pending" while the card beside it said "Reviewed".
          const draft = draftFor(question);
          const status = statusOf(question, draft.reviewed);
          return (
            <Pressable
              key={question.id}
              role="button"
              accessibilityLabel={`${question.label}, ${status}`}
              onPress={() => jumpTo(question.id)}
              style={({ pressed, hovered }) => [
                s.questionNavigatorButton,
                (hovered || pressed) && s.questionNavigatorButtonHover,
              ]}>
              <View style={s.questionNavigatorButtonBody}>
                <Text style={s.questionNavigatorButtonTitle}>{question.label}</Text>
                <Text style={s.questionNavigatorButtonCaption}>{status}</Text>
              </View>
              <Text style={s.questionNavigatorButtonFlag}>
                {draft.reviewed ? `${draft.mark}/${question.maxMarks}` : `—/${question.maxMarks}`}
              </Text>
            </Pressable>
          );
        })}
    </View>
  ));

  return (
    <>
      <View style={s.reviewTopActions}>
        <LinkButton title="← Back to Submissions" onPress={() => open('bulk-review')} />

        <View style={s.reviewStudentBar} accessibilityLabel="Student review navigation">
          <LinkButton
            title="← Previous Student"
            disabled={index === 0}
            onPress={() => setStudentIndex(Math.max(0, index - 1))}
          />
          <View style={s.reviewStudentBarCell}>
            <Select
              title="Current student"
              options={results.map((result, position) => ({
                label: result.studentName,
                value: String(position),
              }))}
              value={String(index)}
              onValueChange={(value) => setStudentIndex(Number(value))}
              style={studentSelect(s.reviewStudentSelect)}
            />
            <Text style={s.reviewStudentBarCaption}>
              {`${assessment.grade}-${assessment.section} | ${assessment.subject} - ${assessment.title}`}
            </Text>
          </View>
          <LinkButton
            title="Next Student →"
            disabled={index === results.length - 1}
            onPress={() => setStudentIndex(Math.min(results.length - 1, index + 1))}
          />
        </View>

        <ButtonRow end>
          <LinkButton
            title={
              review.creatingCorrectedCopy
                ? 'Preparing student copy…'
                : 'Create Corrected Answer Sheet'
            }
            disabled={review.creatingCorrectedCopy}
            onPress={() => void review.createCorrectedCopy()}
          />
          <AppButton
            variant="primary"
            title="Submit Review & Generate Resource"
            disabled={review.pendingCount > 0}
            onPress={review.submitReview}
          />
          <AppButton title="Bulk Approval & Generate Resource" onPress={review.bulkApprove} />
        </ButtonRow>
      </View>

      <View style={s.reviewStudentDetails}>
        {(
          [
            ['Student Name', current.studentName],
            ['Class', `${assessment.grade} - ${assessment.section}`],
            ['Subject', assessment.subject],
            ['Assignment', assessment.title],
            ['Submitted On', new Date(current.date).toLocaleString()],
          ] as const
        ).map(([label, value]) => (
          <View key={label} style={s.reviewStudentDetailsCell}>
            <Text style={s.reviewStudentDetailsLabel}>{label}</Text>
            <Text style={s.reviewStudentDetailsValue}>{value}</Text>
          </View>
        ))}
      </View>

      <Card style={s.reviewSummaryCompact}>
        <Text style={[s.eyebrow, s.reviewSummaryCompactTitle]}>Overall Summary</Text>
        {/* `--review-progress` drove a conic gradient, which collapses to a
            solid ring here (see CAVEATS in styles.ts); the percentage it drew
            is kept for a screen reader instead. */}
        <View
          style={s.reviewScoreRing}
          accessibilityLabel={`Teacher total ${review.teacherTotal} of ${current.maxMarks}, ${progress}%`}>
          <Text style={s.reviewScoreRingValue}>{review.teacherTotal}</Text>
          <Text style={s.reviewScoreRingCaption}>{`/ ${current.maxMarks}`}</Text>
        </View>
        <View style={s.reviewSummaryCompactBody}>
          {(
            [
              ['AI Total Marks', `${review.aiTotal} / ${current.maxMarks}`],
              ['Teacher Reviewed', `${review.reviewedCount} / ${questions.length}`],
              ['Pending Review', `${review.pendingCount} / ${questions.length}`],
            ] as const
          ).map(([label, value]) => (
            <View key={label} style={s.reviewSummaryCompactRow}>
              <Text style={s.reviewSummaryCompactLabel}>{label}</Text>
              <Text style={s.reviewSummaryCompactValue}>{value}</Text>
            </View>
          ))}
        </View>
      </Card>

      <View style={s.continuousReviewLayout}>
        <View style={s.continuousReviewWorkspace}>
          {pageNumbers.map((pageNumber, pageIndex) => (
            <View key={pageNumber} style={s.reviewPage}>
              <View style={s.reviewPageHeader}>
                <View style={s.reviewPageHeaderBadge}>
                  <Text style={s.reviewPageHeaderBadgeText}>
                    {`PAGE ${pageIndex + 1} OF ${pageNumbers.length}`}
                  </Text>
                </View>
              </View>

              {questions
                .filter((question) => pageOf(question) === pageNumber)
                .map((question, questionIndex) => (
                  <View
                    key={question.id}
                    collapsable={false}
                    ref={(node) => {
                      questionNodes.current[question.id] = node;
                    }}>
                    <QuestionCard
                      question={question}
                      index={questionIndex}
                      draft={draftFor(question)}
                      onChange={(patch) => review.changeDraft(question.id, patch)}
                      collapsed={Boolean(review.collapsed[question.id])}
                      onToggle={() => review.toggleCollapsed(question.id)}
                      saveStatus={review.saveStatus}
                      sourceUri={sourceUri}
                      answerFileName={answerFile?.name}
                      answerIsImage={answerIsImage}
                      pageNumber={pageNumber}
                      onOpenOriginal={sourceUri ? () => openOriginal(pageNumber) : undefined}
                      ocrFallback={review.active?.ocrText}
                      feedbackFallback={current.feedback}
                      onCopyOcr={copyOcr}
                    />
                  </View>
                ))}

              <View style={s.reviewPageFooter}>
                <Text style={s.reviewPageFooterText}>{`END OF PAGE ${pageIndex + 1}`}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={s.questionNavigator}>
          <Text style={[s.eyebrow, s.questionNavigatorTitle]}>Questions</Text>
          {/* Above 1050 the rail is height-capped and scrolls on its own - the
              web's `max-height; overflow:auto`. Below it the sections wrap into
              the page and the page scrolls. */}
          {wide ? (
            <ScrollView
              nestedScrollEnabled
              style={s.questionNavigatorScroll}
              contentContainerStyle={s.questionNavigatorScrollContent}>
              {navigatorSections}
            </ScrollView>
          ) : (
            navigatorSections
          )}
        </View>
      </View>
    </>
  );
}

/**
 * `.review-student-bar select` sized from the theme key, applied to `Select`'s
 * outer view.
 *
 * `Select` takes a style for its wrapper and none for the trigger, so
 * `reviewStudentSelect` cannot be applied whole - its border and padding would
 * draw a second box around the input. Only its width rule transfers, and the
 * wrapper's `<label>` margin is cancelled because the web's select was bare.
 */
function studentSelect(theme: StyleProp<TextStyle>): ViewStyle {
  const { minWidth, width } = StyleSheet.flatten(theme);
  return { minWidth, width, marginVertical: 0 };
}
