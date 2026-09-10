/**
 * The four dialogs of the grading run itself: approve the detected structure,
 * watch the pipeline, start a versioned regrade, and clear the review queue.
 *
 * Ported from `SetupDialog` (frontend/app/ui/FunctionalEduAIApp.tsx:998),
 * `ProcessDialog` (:1031), `RegradeDialog` (:1040) and `BulkReview` (:1044).
 * They share a file because they share a stage - between "the evidence is in"
 * and "the teacher has signed it off" - and none is large enough to own one.
 *
 * ---------------------------------------------------------------------------
 * The unnamed selects are unnamed on purpose
 * ---------------------------------------------------------------------------
 * Strictness, partial credit, regrade scope and regrade reason were `<select>`
 * elements with no `name` in the source, so nothing read them back. They stay
 * unnamed here: `Select` without a `name` still renders and still enforces
 * `required`, but contributes nothing to `values`, which is exactly what the
 * web app did. Giving them names now would invent a persistence contract the
 * grading pipeline does not have.
 */

import { useState } from 'react';
import { Text, View } from 'react-native';

import { isAnswerSheetFile } from '@/features/workspace/lib/documents';
import { AppButton } from '@/shared/components/buttons';
import { Field, Form, FormGrid, Select, SubmitButton } from '@/shared/components/form';
import { DialogHead } from '@/shared/components/primitives';
import { useAppStyles } from '@/shared/theme/styles';
import type { UploadFile, W } from '@/shared/types/workspace';

const DEFAULT_ANSWER_KEY =
  'Q1: Equivalent fractions; Q2: Common denominator; Q3: Add numerators after conversion.';
const DEFAULT_RUBRIC =
  'Method 40% · Conversion 30% · Calculation 20% · Final answer and unit 10%';

/**
 * Review the detected question count, the answer key and the partial-credit
 * rules before anything is graded against them.
 *
 * `questions` is the one controlled field, because the copy above the form
 * quotes it back ("The simulation detected N questions"). It is held as text
 * rather than as a number so that clearing the box shows an empty box instead
 * of a 0 the teacher then has to delete.
 */
export function SetupDialog({ assessment, update, done }: W<'assessment' | 'update' | 'done'>) {
  const s = useAppStyles();
  const [questions, setQuestions] = useState(String(assessment.questions || 5));

  return (
    <Form
      onSubmit={(values) => {
        update(assessment.id, {
          questions: Math.max(1, values.number('questions', 1)),
          answerKey: values.get('answerKey'),
          rubric: values.get('rubric'),
          stage: 'setup',
        });
        done();
      }}>
      <DialogHead eyebrow="Question detection" title="Review questions & rubric" />
      <Text style={s.modalCopy}>
        The simulation detected {questions || '0'} questions. Review the answer key and
        partial-credit rules before grading.
      </Text>
      <Field
        name="questions"
        label="Detected questions"
        type="number"
        min={1}
        max={50}
        required
        value={questions}
        onChangeValue={setQuestions}
      />
      <Field
        name="answerKey"
        label="Answer key / expected evidence"
        type="textarea"
        required
        defaultValue={assessment.answerKey || DEFAULT_ANSWER_KEY}
      />
      <FormGrid>
        <Select label="Strictness" options={['Balanced', 'Supportive', 'Strict']} />
        <Select label="Partial credit" options={['Allow method marks', 'Final answer only']} />
      </FormGrid>
      <Field
        name="rubric"
        label="Rubric criteria"
        type="textarea"
        defaultValue={assessment.rubric || DEFAULT_RUBRIC}
      />
      <SubmitButton title="Approve structure & rubric" />
    </Form>
  );
}

/**
 * The grading pipeline: every answer sheet, graded or not, with a way into the
 * ones that are not.
 *
 * The continue button stays shut until all of them are graded. That is not
 * pedantry - teacher review is scoped to the whole assessment, so entering it
 * with half the class ungraded produces a review queue that is quietly missing
 * students.
 */
export function ProcessDialog({
  assessment,
  update,
  open,
  done,
}: W<'assessment' | 'update' | 'open' | 'done'>) {
  const s = useAppStyles();
  const allFiles: UploadFile[] = assessment.files || [];
  const files = allFiles.filter((file) => isAnswerSheetFile(file, allFiles.length));
  const gradedCount = files.filter((file) => Boolean(assessment.gradeResults?.[file.id])).length;
  const allGraded = files.length > 0 && gradedCount === files.length;

  return (
    <>
      <DialogHead eyebrow="Grading status" title="OCR & grading pipeline" />
      <Text style={s.modalCopy}>
        Each answer sheet is graded individually with OCR and diagnostic learning analysis. Grade
        every file below, then continue to teacher review.
      </Text>
      <View style={s.uploadList}>
        {files.map((file) => {
          const graded = Boolean(assessment.gradeResults?.[file.id]);
          return (
            <View key={file.id} style={s.uploadRow}>
              <View style={s.fileIcon}>
                <Text style={s.fileIconText}>
                  {file.name.split('.').pop()?.toUpperCase() || 'FILE'}
                </Text>
              </View>
              <View style={s.uploadRowBody}>
                <Text style={s.uploadRowTitle} numberOfLines={2}>
                  {file.name}
                </Text>
                <Text style={s.uploadRowCaption}>{graded ? 'Graded' : 'Not graded yet'}</Text>
              </View>
              {!graded ? (
                <AppButton
                  title="Grade now"
                  accessibilityLabel={`Grade ${file.name} now`}
                  onPress={() => open(`grade-file:${file.id}`)}
                />
              ) : null}
            </View>
          );
        })}
      </View>
      {!files.length ? (
        <View role="alert" style={s.formError}>
          <Text style={s.formErrorText}>No answer-sheet files uploaded yet.</Text>
        </View>
      ) : null}
      <AppButton
        variant="primary"
        full
        disabled={!allGraded}
        title={
          allGraded
            ? 'Continue to teacher review'
            : `${gradedCount}/${files.length} graded — grade all files to continue`
        }
        onPress={() => {
          update(assessment.id, {
            stage: 'review',
            reviewed: assessment.reviewed,
            totalReviews: Math.max(assessment.totalReviews, files.length * 4),
          });
          done();
        }}
      />
    </>
  );
}

/**
 * Start a new grading version.
 *
 * The teacher note is the only required free-text field in the dialog, and it
 * is required because the version it opens is what the audit history shows: a
 * regrade with no stated reason is indistinguishable from a mistake.
 */
export function RegradeDialog({ assessment, update, done }: W<'assessment' | 'update' | 'done'>) {
  const s = useAppStyles();
  const affected = Object.keys(assessment.gradeResults || {}).length;

  return (
    <Form
      onSubmit={() => {
        update(assessment.id, { stage: 'review', reviewed: 0, version: assessment.version + 1 });
        done();
      }}>
      <DialogHead eyebrow="Versioned grading" title="Start regrade" />
      <Select
        label="Scope"
        required
        options={[
          'Selected question',
          'Selected students',
          'Full assessment',
          'Rubric criterion',
        ]}
      />
      <Select
        label="Reason"
        required
        options={[
          'Alternative correct answer discovered',
          'Rubric changed',
          'Partial-credit rule changed',
          'Question ambiguity',
          'Moderation',
        ]}
      />
      <Field
        name="note"
        label="Teacher note"
        type="textarea"
        required
        placeholder="Explain the change for the audit history"
      />
      <View style={s.impactBox}>
        <Text style={s.impactBoxTitle}>Impact preview</Text>
        <Text style={s.impactBoxCaption}>
          {affected} student{affected === 1 ? '' : 's'} with existing graded evidence. Score changes
          will be calculated after the regrade runs.
        </Text>
      </View>
      <SubmitButton title={`Confirm regrade version ${assessment.version + 1}`} />
    </Form>
  );
}

/** Approve everything still sitting in the review queue in one action. */
export function BulkReview({ assessment, update, done }: W<'assessment' | 'update' | 'done'>) {
  const s = useAppStyles();
  const remaining = Math.max(0, assessment.totalReviews - assessment.reviewed);

  return (
    <>
      <DialogHead eyebrow="High-confidence objective answers" title="Bulk review" />
      <Text style={s.modalCopy}>
        {remaining} answer{remaining === 1 ? '' : 's'} remain in the review queue for this
        assessment.
      </Text>
      <View style={s.listItem}>
        <Text style={s.listItemText}>
          Approve {remaining} remaining answer{remaining === 1 ? '' : 's'}
        </Text>
      </View>
      <AppButton
        variant="primary"
        full
        disabled={!remaining}
        title="Approve remaining answers"
        onPress={() => {
          update(assessment.id, { reviewed: assessment.totalReviews });
          done();
        }}
      />
    </>
  );
}
