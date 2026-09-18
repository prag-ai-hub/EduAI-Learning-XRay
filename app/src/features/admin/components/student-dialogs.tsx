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
 * `StudentDialog` is no longer one of the snapshot-only dialogs. It creates a
 * real child through `POST /api/v1/schools/students/` and writes the snapshot
 * afterwards as a cache of what the server returned - see
 * `@/features/roster/lib/workspace-mirror` for why that cache is still written.
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

import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import {
  ApiError,
  createStudent,
  listClasses,
  type SchoolClass,
} from '@/features/roster/api/rosterApi';
import { addStudent } from '@/features/roster/lib/workspace-mirror';
import { allGradeResults, studentMastery } from '@/features/workspace/lib/analytics';
import { AppButton } from '@/shared/components/buttons';
import { Field, Form, FormError, FormGrid, Select, SubmitButton } from '@/shared/components/form';
import { DialogHead } from '@/shared/components/primitives';
import { useAppStyles } from '@/shared/theme/styles';
import type { GradeResult, Student, W } from '@/shared/types/workspace';

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

/**
 * Add one student to the school roster.
 *
 * The class picker used to be three hardcoded strings - "Class 6A", "Class 6B",
 * "Class 7A" - and the student was written into the workspace snapshot alone.
 * It now lists the school's real classes and sends the chosen one's id, so the
 * child lands on a class an assessment can be attached to.
 *
 * A school with no classes yet is the ordinary first-run case, not an error:
 * `students.class_id` is nullable precisely because a school imports its roster
 * before it finishes setting up its classes. So the picker goes quiet rather
 * than blocking the form, and the dialog says what will happen instead.
 */
export function StudentDialog({ setState, done }: W<'setState' | 'done'>) {
  const s = useAppStyles();
  /** null while the class list is still being read. */
  const [classes, setClasses] = useState<SchoolClass[] | null>(null);
  const [classError, setClassError] = useState('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const rows = await listClasses();
        if (alive) setClasses(rows);
      } catch (cause) {
        if (!alive) return;
        // An empty list, so the dialog still works: a student can be added with
        // no class, and refusing to open over a failed lookup would be worse.
        setClasses([]);
        setClassError(
          cause instanceof ApiError ? cause.message : 'The class list could not be loaded.',
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const options = (classes ?? []).map((entry) => ({ label: entry.label, value: entry.id }));

  return (
    <Form
      onSubmit={async (values) => {
        // Thrown errors land in <FormError/> with the server's own wording -
        // a duplicate roll number, or the 403 an unapproved school gets.
        const created = await createStudent({
          name: values.trimmed('name'),
          roll_number: values.trimmed('roll'),
          school_class: values.trimmed('className') || null,
        });
        setState(addStudent(created));
        done();
      }}>
      <DialogHead eyebrow="School roster" title="Add student" />
      <Field name="name" label="Student name" required minLength={2} />
      <FormGrid>
        <Field name="roll" label="School student ID / roll" required />
        {/* One Select throughout, so the grid does not reflow as the list
            arrives. It stays optional - "No class yet" is a real answer here. */}
        <Select
          name="className"
          label="Class"
          options={options}
          disabled={!options.length}
          placeholder={
            classes === null ? 'Loading classes…' : options.length ? 'No class yet' : 'No classes yet'
          }
        />
      </FormGrid>
      {classes !== null && !options.length ? (
        <Text style={s.modalCopy}>
          {classError ||
            'This school has no classes yet. The student will be added to the roster without one - create a class in Schools & Classes, then assign them.'}
        </Text>
      ) : null}
      <FormError />
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
