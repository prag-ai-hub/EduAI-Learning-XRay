/**
 * The two dialogs that address one student: adding them to the roster, and
 * reading back everything that has been graded for them.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `StudentDialog` (~1601)
 * and `StudentEvidence` (~1667).
 *
 * The filename is `student-dialogs` rather than `students` because the
 * teacher's roster screen is also called `StudentsView`, lives in the teacher
 * slice, and the two collided on one path in an earlier attempt at this port.
 *
 * `StudentEvidence` invents nothing. Every figure on it is derived from graded
 * results through `@/features/workspace/lib/analytics`, and with nothing graded
 * it says so rather than showing a zero - a 0% mastery reads as a judgement of
 * the child, while "no evidence yet" is the truth.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE
 * ---------------------------------------------------------------------------
 * `StudentEvidence` was not a `<form>` on the web - its button calls `done()`
 * directly - so it stays a plain panel here, and its observation `<select>`
 * stays unnamed and unsubmitted exactly as it was.
 */

import { Text, View } from 'react-native';

import { allGradeResults, studentMastery } from '@/features/workspace/lib/analytics';
import { AppButton } from '@/shared/components/buttons';
import { Field, Form, FormGrid, Select, SubmitButton } from '@/shared/components/form';
import { DialogHead } from '@/shared/components/primitives';
import { useAppStyles } from '@/shared/theme/styles';
import type { DemoState, GradeResult, Student, W } from '@/shared/types/workspace';

const CLASSES = ['Class 6A', 'Class 6B', 'Class 7A'];

/** The reasons a teacher may attach to a result that the marks do not explain. */
const OBSERVATIONS = [
  'No additional observation',
  'Absence',
  'Incomplete attempt',
  'Time-management difficulty',
  'Language difficulty',
  'Careless mistake',
  'Accommodation required',
];

/** Add one student to the school roster. */
export function StudentDialog({ setState, done }: W<'setState' | 'done'>) {
  return (
    <Form
      onSubmit={(values) => {
        const student = {
          id: `s${Date.now()}`,
          name: values.get('name'),
          roll: values.get('roll'),
          className: values.get('className'),
          status: 'Active',
        };
        setState((current: DemoState) => ({
          ...current,
          students: [student, ...current.students],
          events: [`Student added · ${student.roll}`, ...current.events],
        }));
        done();
      }}>
      <DialogHead eyebrow="School roster" title="Add student" />
      <Field name="name" label="Student name" required minLength={2} />
      <FormGrid>
        <Field name="roll" label="School student ID / roll" required />
        <Select name="className" label="Class" options={CLASSES} />
      </FormGrid>
      <SubmitButton title="Save student" />
    </Form>
  );
}

/**
 * `.xray-summary .metric` - the metric card on surface2 with a shorter floor.
 * `Metric` in `@/shared/components/primitives` takes no style prop, and tinting
 * a wrapper around it would put the colour behind the card's opaque background,
 * so this variant names the two keys the stylesheet already holds.
 */
function SummaryMetric({ label, value, note }: { label: string; value: string; note: string }) {
  const s = useAppStyles();
  return (
    <View style={s.xraySummaryTrack}>
      <View style={[s.metric, s.xraySummaryMetric]}>
        <Text style={s.metricLabel}>{label}</Text>
        <Text style={s.metricValue}>{value}</Text>
        <Text style={s.metricCaption}>{note}</Text>
      </View>
    </View>
  );
}

/** One student's whole graded record, weakest concept first. */
export function StudentEvidence({
  state,
  student,
  done,
}: W<'state' | 'done'> & { student?: Student }) {
  const s = useAppStyles();
  const results: GradeResult[] = allGradeResults(state).filter(
    (result) => result.studentName === student?.name,
  );
  const summary = studentMastery(state)[student?.name || ''];

  const conceptAgg: Record<string, { sum: number; count: number }> = {};
  results.forEach((result) =>
    result.gaps.forEach((gap) => {
      const bucket = conceptAgg[gap.concept] || { sum: 0, count: 0 };
      bucket.sum += gap.mastery;
      bucket.count += 1;
      conceptAgg[gap.concept] = bucket;
    }),
  );
  const concepts = Object.entries(conceptAgg)
    .map(([concept, bucket]) => ({
      concept,
      mastery: Math.round(bucket.sum / bucket.count),
      evidence: bucket.count,
    }))
    .sort((a, b) => a.mastery - b.mastery);
  const priority = concepts[0];

  return (
    <>
      <DialogHead
        eyebrow={`${student?.roll || 'Student'} · evidence profile`}
        title={student?.name || 'Student evidence'}
      />
      {!results.length ? (
        <Text style={s.modalCopy}>
          No graded evidence yet for {student?.name}. Grade one of their answer sheets to populate
          this profile.
        </Text>
      ) : (
        <>
          <View style={s.xraySummary}>
            <SummaryMetric
              label="Mastery"
              value={`${summary?.mastery ?? 0}%`}
              note={`${concepts.length} concept${concepts.length === 1 ? '' : 's'}`}
            />
            <SummaryMetric
              label="Evidence"
              value={String(summary?.evidence ?? 0)}
              note="Graded answer sheets"
            />
            <SummaryMetric
              label="Confidence"
              value={results.length > 2 ? 'High' : results.length > 1 ? 'Medium' : 'Low'}
              note={`${results.length} assessment${results.length === 1 ? '' : 's'}`}
            />
            <SummaryMetric
              label="Last graded"
              value={summary?.lastDate || '—'}
              note="Most recent evidence"
            />
          </View>
          <View style={s.evidence}>
            <Text style={s.evidenceTitle}>
              {priority?.concept || 'No priority gap identified'}
              {priority ? ' · Priority gap' : ''}
            </Text>
            <Text style={s.evidenceBody}>
              {priority
                ? `${priority.evidence} evidence point${priority.evidence === 1 ? '' : 's'} · average mastery ${priority.mastery}%`
                : 'Grade more answer sheets to surface a priority concept.'}
            </Text>
          </View>
        </>
      )}
      <Select label="Teacher observation" options={OBSERVATIONS} />
      <AppButton title="Save observation" variant="primary" full onPress={done} />
    </>
  );
}
