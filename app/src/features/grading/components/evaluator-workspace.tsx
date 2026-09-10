/**
 * `.evaluator-workspace` - every question the grader proposed, and the
 * teacher's decision on each one.
 *
 * Ported from the `{pendingAnalysis && <section className="evaluator-workspace">…}`
 * block of frontend/app/ui/FunctionalEduAIApp.tsx `PerFileGradeDialogBody`
 * (~1380). The panel exists because a submitted evaluation is immutable: once
 * it goes to /api/evaluations/submit a correction costs a whole new version, so
 * the attempt state, the award, the evidence and the rationale are all
 * confirmed here first.
 *
 * `awardedMarks` is the teacher's figure and `aiAwardedMarks` is what the model
 * proposed. Both are kept, and the caption says so whenever they differ - an
 * override has to be visible, because the evaluation is an audited record.
 *
 * ---------------------------------------------------------------------------
 * allowedIncrement IS A CONSTRAINT, NOT A HINT
 * ---------------------------------------------------------------------------
 * The web wrote `<input type="number" step={question.allowedIncrement}>`, and a
 * browser enforces `step` on the spinner but not on a typed value. React Native
 * has no number input at all, so the control is a stepper and the increment is
 * the only way marks move: a rubric that awards in halves cannot be given 1.3.
 * `clampToIncrement` is that rule, and the review card applies the same one.
 */

import { Text, View, type ViewStyle } from 'react-native';

import { AppButton } from '@/shared/components/buttons';
import { Field, FormGrid, Select } from '@/shared/components/form';
import { Eyebrow } from '@/shared/components/primitives';
import { Cell, HeadRow, Row, Table } from '@/shared/components/table';
import { Space, useAppStyles } from '@/shared/theme/styles';
import type { EvaluatorQuestion } from '@/shared/types/workspace';

const ATTEMPT_STATES = [
  { label: 'Attempted', value: 'attempted' },
  { label: 'Not attempted', value: 'not_attempted' },
  { label: 'Excluded by choice rule', value: 'excluded' },
] as const;

/**
 * A mark the rubric actually permits: a multiple of `increment`, never below
 * zero and never above the question's maximum.
 *
 * Exported because the teacher review card steps the same marks under the same
 * rule, and two copies of a rounding rule are two chances to round differently.
 */
export function clampToIncrement(value: number, max: number, increment: number): number {
  const step = increment > 0 ? increment : 0.5;
  const bounded = Math.max(0, Math.min(max, Number(value) || 0));
  const stepped = Math.round(bounded / step) * step;
  // Binary fractions: 0.1 + 0.2 steps drift, and a mark of 2.7500000000000004
  // fails the server's own reconciliation. Two decimals covers every increment.
  return Math.min(max, Math.round(stepped * 100) / 100);
}

/** The −/＋ pair. `label` names it for a screen reader, which sees no context. */
function MarkStepper({
  value,
  max,
  increment,
  label,
  disabled,
  onChange,
}: {
  value: number;
  max: number;
  increment: number;
  label: string;
  disabled?: boolean;
  onChange: (next: number) => void;
}) {
  const s = useAppStyles();
  const step = increment > 0 ? increment : 0.5;
  return (
    <View style={stepperRow}>
      <AppButton
        title="−"
        accessibilityLabel={`Decrease ${label}`}
        disabled={disabled || value <= 0}
        onPress={() => onChange(clampToIncrement(value - step, max, step))}
      />
      <View style={[s.input, stepperValue]}>
        <Text style={s.trText}>{`${value} / ${max}`}</Text>
      </View>
      <AppButton
        title="＋"
        accessibilityLabel={`Increase ${label}`}
        disabled={disabled || value >= max}
        onPress={() => onChange(clampToIncrement(value + step, max, step))}
      />
    </View>
  );
}

export type EvaluatorWorkspaceProps = {
  questions: EvaluatorQuestion[];
  /** The total the server will reconcile the awards against. */
  maxMarks: number;
  /** What /api/evaluations/submit rejected the last attempt for. */
  errors: string[];
  onChange: (id: string, patch: Partial<EvaluatorQuestion>) => void;
};

export function EvaluatorWorkspace({
  questions,
  maxMarks,
  errors,
  onChange,
}: EvaluatorWorkspaceProps) {
  const s = useAppStyles();
  const reviewed = questions.filter((question) => question.reviewed).length;
  const total = questions.reduce((sum, question) => sum + Number(question.awardedMarks || 0), 0);

  return (
    <View style={s.evaluatorWorkspace}>
      <View style={s.evaluatorWorkspaceHeader}>
        <View style={{ flexShrink: 1 }}>
          <Eyebrow>Evaluator workspace</Eyebrow>
          <Text accessibilityRole="header" style={s.ocrValidationTitle}>
            Review every question before submission
          </Text>
        </View>
        <View style={[s.status, s.statusWarning]}>
          <Text style={[s.statusText, s.statusWarningText]}>
            {`${reviewed}/${questions.length} reviewed`}
          </Text>
        </View>
      </View>

      <Text style={s.modalCopy}>
        AI marks are proposals. Confirm the attempt state, award, evidence, and rationale. Submitted
        evaluations are locked; later corrections create a new version.
      </Text>

      <View style={s.evaluatorQuestionList}>
        {questions.map((question) => {
          const attempted = question.attemptState === 'attempted';
          const aiMark = question.aiAwardedMarks ?? question.awardedMarks;
          const overridden = Number(aiMark) !== Number(question.awardedMarks);
          return (
            <View
              key={question.id}
              style={[s.evaluatorQuestionCard, question.reviewed && s.evaluatorQuestionCardReviewed]}>
              <View style={s.evaluatorQuestionHead}>
                <View style={{ flexShrink: 1 }}>
                  <Text style={s.labelText}>{question.label}</Text>
                  <Text style={s.evaluatorQuestionCaption}>
                    {`${Math.round(question.confidence * 100)}% AI confidence`}
                  </Text>
                </View>
                {/* The web's `<label className="check"><input type="checkbox"/> Reviewed</label>`. */}
                <AppButton
                  title={question.reviewed ? '✓ Reviewed' : 'Mark as reviewed'}
                  accessibilityLabel={`Mark ${question.label} as reviewed`}
                  onPress={() => onChange(question.id, { reviewed: !question.reviewed })}
                />
              </View>

              <FormGrid>
                <Select
                  label="Attempt state"
                  options={[...ATTEMPT_STATES]}
                  value={question.attemptState}
                  onValueChange={(next) =>
                    onChange(question.id, {
                      attemptState: next as EvaluatorQuestion['attemptState'],
                      // A question that was not attempted, or excluded by a
                      // choice rule, cannot carry marks.
                      awardedMarks: next === 'attempted' ? question.awardedMarks : 0,
                    })
                  }
                />
                <View style={s.label}>
                  <Text style={s.labelText}>{`Marks (maximum ${question.maxMarks})`}</Text>
                  <MarkStepper
                    value={Number(question.awardedMarks) || 0}
                    max={question.maxMarks}
                    increment={question.allowedIncrement}
                    label={`marks for ${question.label}`}
                    disabled={!attempted}
                    onChange={(next) => onChange(question.id, { awardedMarks: next })}
                  />
                  <Text style={s.evaluatorQuestionCaption}>
                    {overridden
                      ? `AI proposed ${aiMark}/${question.maxMarks} · teacher ${question.awardedMarks}/${question.maxMarks}`
                      : `Same as AI: ${aiMark}/${question.maxMarks}`}
                  </Text>
                </View>
              </FormGrid>

              <Field
                label="Evidence from the answer"
                type="textarea"
                value={question.evidence}
                onChangeValue={(text) => onChange(question.id, { evidence: text })}
              />
              <Field
                label="Evaluator rationale"
                type="textarea"
                value={question.rationale}
                onChangeValue={(text) => onChange(question.id, { rationale: text })}
              />

              {question.criteria?.length ? (
                <View style={{ marginTop: Space.s12 }}>
                  <Eyebrow>Marking criteria</Eyebrow>
                  <Table accessibilityLabel={`Criteria for ${question.label}`}>
                    <HeadRow>
                      {'Criterion'}
                      {'Award'}
                    </HeadRow>
                    {question.criteria.map((criterion, index) => (
                      <Row key={criterion.id} last={index === (question.criteria?.length ?? 0) - 1}>
                        <Cell
                          title={criterion.label}
                          caption={criterion.rationale || criterion.evidence || undefined}
                          strong
                        />
                        <MarkStepper
                          value={Number(criterion.awardedMarks) || 0}
                          max={criterion.maxMarks}
                          increment={question.allowedIncrement}
                          label={`marks for ${criterion.label}`}
                          disabled={!attempted}
                          onChange={(next) =>
                            onChange(question.id, {
                              criteria: (question.criteria || []).map((item) =>
                                item.id === criterion.id ? { ...item, awardedMarks: next } : item,
                              ),
                            })
                          }
                        />
                      </Row>
                    ))}
                  </Table>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>

      <View style={s.evaluationTotal}>
        <Text style={s.labelText}>Server-checked total on submission</Text>
        <Text style={s.evaluationTotalValue}>{`${total} / ${maxMarks}`}</Text>
      </View>

      {errors.length > 0 ? (
        <View role="alert" style={s.validationSummary}>
          <Text style={[s.labelText, s.validationSummaryText]}>
            Resolve these items before submission:
          </Text>
          {errors.map((error) => (
            <Text key={error} style={s.validationSummaryText}>
              {`· ${error}`}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------------- *
 * The two shapes the CSS never described - a number input is not a stepper.
 * ------------------------------------------------------------------------- */

const stepperRow: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: Space.s8 };

const stepperValue: ViewStyle = {
  flexGrow: 1,
  flexShrink: 1,
  minWidth: Space.s72,
  alignItems: 'center',
  justifyContent: 'center',
};
