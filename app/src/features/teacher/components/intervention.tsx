/**
 * The two intervention dialogs: planning one, and recording what it changed.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `InterventionForm` (~1047)
 * and `FollowupDialog` (~1524).
 *
 * The pair is the improvement cycle: `InterventionForm` moves the assessment to
 * the `intervention` stage, and `FollowupDialog` is the only thing that writes
 * comparable evidence back. Neither invents a number - the plan is prefilled
 * with the weakest graded concept, and with nothing graded the concept field is
 * simply empty and says so in its placeholder.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE
 * ---------------------------------------------------------------------------
 * Both were `<form onSubmit>` with uncontrolled inputs read back through
 * `new FormData(event.currentTarget)`. `@/shared/components/form` is that
 * contract rebuilt: `values.get("concept")` replaces `String(f.get("concept"))`
 * and the fields stay uncontrolled. The monolith's `<Field label>{children}` is
 * a different component from this app's `Field` - a `<select>` inside one maps
 * to `Select`, a `<textarea>` to `Field type="textarea"`.
 *
 * The three unnamed selects (Group, Evidence type, Comparability) stay unnamed,
 * exactly as they were: an unnamed DOM control never reached FormData either.
 */

import { useState } from 'react';
import { Text } from 'react-native';

import {
  Field,
  Form,
  FormGrid,
  Select,
  SubmitButton,
} from '@/shared/components/form';
import { DialogHead } from '@/shared/components/primitives';
import { useAppStyles } from '@/shared/theme/styles';
import type { DemoState, GradeResult, Intervention, W } from '@/shared/types/workspace';

const FORMATS = [
  '5-minute correction',
  'Guided practice',
  'Full-period reteaching',
  'Homework',
  'Remedial support',
  'Exit ticket',
];

const DURATIONS = ['15 minutes', '5 minutes', '40 minutes'];

const GROUPS = ['Strengthen', 'Practise', 'Extend'];

const EVIDENCE_TYPES = [
  'Exit ticket',
  'Parallel quiz',
  'Homework',
  'Oral response',
  'Observation rubric',
];

const COMPARABILITY = ['Strongly comparable', 'Moderately comparable', 'Informal evidence'];

const OUTCOMES = [
  'Meaningful improvement',
  'Mastered after intervention',
  'Some improvement',
  'No clear improvement',
  'Further support recommended',
];

export function InterventionForm({
  setState,
  assessment,
  done,
}: W<'setState' | 'assessment' | 'done'>) {
  // Date.now() is impure, so it cannot run during render. A lazy initialiser
  // fixes the default at mount, which is what an uncontrolled defaultValue
  // wants anyway - it is read once and ignored afterwards.
  const [defaultFollowupDate] = useState(() =>
    new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
  );

  const results: GradeResult[] = Object.values(assessment.gradeResults || {});
  const conceptAgg: Record<string, { sum: number; count: number }> = {};
  results.forEach((r) =>
    r.gaps.forEach((g) => {
      const bucket = conceptAgg[g.concept] || { sum: 0, count: 0 };
      bucket.sum += g.mastery;
      bucket.count += 1;
      conceptAgg[g.concept] = bucket;
    }),
  );
  const defaultConcept =
    Object.entries(conceptAgg)
      .map(([concept, b]) => ({ concept, mastery: b.sum / b.count }))
      .sort((a, b) => a.mastery - b.mastery)[0]?.concept || '';

  return (
    <Form
      onSubmit={(values) => {
        const intervention: Intervention = {
          id: `i${Date.now()}`,
          assessmentId: assessment.id,
          concept: values.get('concept'),
          format: values.get('format'),
          duration: values.get('duration'),
          status: 'Planned',
          followup: values.get('followup'),
        };
        setState((current: DemoState) => ({
          ...current,
          interventions: [intervention, ...current.interventions],
          assessments: current.assessments.map((a) =>
            a.id === assessment.id ? { ...a, stage: 'intervention' as const } : a,
          ),
          events: [`Intervention created · ${intervention.concept}`, ...current.events],
        }));
        done();
      }}>
      <DialogHead eyebrow="Plan intervention" title="Plan intervention" />
      <Field
        name="concept"
        label="Concept"
        required
        defaultValue={defaultConcept}
        placeholder="Grade an answer sheet first to prefill the priority gap"
      />
      <FormGrid>
        <Select name="format" label="Format" options={FORMATS} />
        <Select name="duration" label="Duration" options={DURATIONS} />
        <Select label="Group" options={GROUPS} />
        <Field
          name="followup"
          label="Follow-up date"
          type="date"
          required
          defaultValue={defaultFollowupDate}
        />
      </FormGrid>
      <Field
        label="Objective & activity"
        type="textarea"
        required
        placeholder="Describe the teaching activity for this concept"
      />
      <SubmitButton title="Approve and create plan" />
    </Form>
  );
}

export function FollowupDialog({
  setState,
  intervention,
  done,
}: W<'setState' | 'done'> & { intervention?: Intervention }) {
  const s = useAppStyles();

  if (!intervention)
    return (
      <>
        <DialogHead eyebrow="Comparable evidence" title="Record follow-up" />
        <Text style={s.modalCopy}>
          This intervention could not be found. Close this dialog and try again from
          Interventions.
        </Text>
      </>
    );

  return (
    <Form
      onSubmit={(values) => {
        const evidence = {
          studentsCompleted: values.number('studentsCompleted'),
          avgMastery: values.number('avgMastery'),
          outcome: values.get('outcome'),
          note: values.get('note'),
        };
        setState((current: DemoState) => ({
          ...current,
          interventions: current.interventions.map((i: Intervention) =>
            i.id === intervention.id
              ? { ...i, followupRecorded: true, followupEvidence: evidence }
              : i,
          ),
          events: [
            `Follow-up recorded · ${intervention.concept} · ${evidence.outcome}`,
            ...current.events,
          ],
        }));
        done();
      }}>
      <DialogHead
        eyebrow={`Comparable evidence · ${intervention.concept}`}
        title="Record follow-up"
      />
      <Select label="Evidence type" options={EVIDENCE_TYPES} />
      <Select label="Comparability" options={COMPARABILITY} />
      <FormGrid>
        <Field
          name="studentsCompleted"
          label="Students completed"
          type="number"
          min={0}
          defaultValue="6"
        />
        <Field
          name="avgMastery"
          label="Average mastery"
          type="number"
          min={0}
          max={100}
          defaultValue="68"
        />
      </FormGrid>
      <Select name="outcome" label="Outcome" options={OUTCOMES} />
      <Field
        name="note"
        label="Teacher observation"
        type="textarea"
        required
        defaultValue="Most students now identify the common denominator independently."
      />
      <SubmitButton title="Save follow-up evidence" />
    </Form>
  );
}
