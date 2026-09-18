/**
 * The X-Ray module's scope picker - class and section, then subject, then
 * assessment - over the heat map for whichever assessment that lands on.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `XRay` (~535).
 *
 * The hierarchy is enforced by the choosers, not by the pickers: changing the
 * class resets the subject to that class's first and the assessment to the
 * first one matching both, and changing the subject resets the assessment. A
 * stored subject the current class does not teach falls back to its first
 * subject rather than showing an empty list.
 *
 * The initial scope follows the selected assessment when it is fully mapped
 * (class, section and subject), else the first assessment that is. Like the
 * web, it is read once on mount: selecting a different assessment elsewhere
 * does not move a scope the teacher has already set here.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE
 * ---------------------------------------------------------------------------
 * The three `<Field><select>` pairs are `Select` from `form.tsx`, controlled
 * and unnamed outside any `<Form>`, so each opens its option sheet rather than
 * a native dropdown. `Select` styles its own label, so the
 * `.analysis-scope-grid label` rule (7px gap, 800 weight, no margin) reaches
 * only the wrapper's gap; the label text keeps the form label's type.
 */

import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { AssessmentHeatmap } from '@/features/teacher/components/heatmap';
import { classSubjectOptions } from '@/features/workspace/lib/analytics';
import { AppButton, ButtonRow } from '@/shared/components/buttons';
import { Select } from '@/shared/components/form';
import { CardHead, PageHead } from '@/shared/components/primitives';
import { useAppStyles } from '@/shared/theme/styles';
import type { Assessment, W } from '@/shared/types/workspace';

/** `"<grade>|<SECTION>"` - the key `classSubjectOptions` groups classes by. */
function classKeyOf(a: Assessment): string {
  return `${a.grade}|${a.section.toUpperCase()}`;
}

export function XRay({ state, selected, open, notify }: W<'state' | 'selected' | 'open' | 'notify'>) {
  const s = useAppStyles();

  const options = useMemo(() => classSubjectOptions(state), [state]);
  // `selected` is undefined when the teacher has no assessments, whatever its
  // type says - the shell falls back to `state.assessments[0]`.
  const mappedAssessment =
    selected?.grade && selected?.section && selected?.subject
      ? selected
      : state.assessments.find((a: Assessment) => a.grade && a.section && a.subject);
  const initialClassKey = mappedAssessment
    ? classKeyOf(mappedAssessment)
    : options[0]?.classKey || '';

  const [classKey, setClassKey] = useState(initialClassKey);
  const [subject, setSubject] = useState(
    () =>
      mappedAssessment?.subject ||
      options.find((o) => o.classKey === initialClassKey)?.subject ||
      '',
  );
  const [assessmentId, setAssessmentId] = useState(mappedAssessment?.id || '');

  const classOptions = Array.from(new Map(options.map((o) => [o.classKey, o])).values());
  const subjects = Array.from(
    new Set(options.filter((o) => o.classKey === classKey).map((o) => o.subject)),
  );
  const effectiveSubject = subjects.includes(subject) ? subject : subjects[0] || '';
  const assessments = state.assessments.filter(
    (a: Assessment) => classKeyOf(a) === classKey && a.subject === effectiveSubject,
  );
  const analysis = assessments.find((a) => a.id === assessmentId) || assessments[0];

  const chooseClass = (nextClass: string) => {
    const nextSubject = options.find((o) => o.classKey === nextClass)?.subject || '';
    const nextAssessment = state.assessments.find(
      (a: Assessment) => classKeyOf(a) === nextClass && a.subject === nextSubject,
    );
    setClassKey(nextClass);
    setSubject(nextSubject);
    setAssessmentId(nextAssessment?.id || '');
  };

  const chooseSubject = (nextSubject: string) => {
    const nextAssessment = state.assessments.find(
      (a: Assessment) => classKeyOf(a) === classKey && a.subject === nextSubject,
    );
    setSubject(nextSubject);
    setAssessmentId(nextAssessment?.id || '');
  };

  return (
    <>
      <PageHead
        eyebrow="Class analysis"
        title="Class, subject & assessment heatmap"
        subtitle="Review evidence in the hierarchy: class and section, subject, assessment, then students.">
        <AppButton
          variant="primary"
          icon="＋"
          title="Create class & subject"
          onPress={() => open('class')}
        />
        <AppButton icon="＋" title="Create assessment" onPress={() => open('create-assessment')} />
      </PageHead>

      <View
        role="region"
        accessibilityLabel="Visual learning-gap report"
        style={[s.card, s.analysisScope]}>
        <CardHead
          eyebrow="Analysis scope"
          title="Class & section → Subject → Assessment → Students"
        />
        <View style={s.analysisScopeGrid}>
          <View style={s.analysisScopeTrack}>
            <Select
              label="Class & section"
              style={s.analysisScopeLabel}
              options={classOptions.map((o) => ({
                label: `Class ${o.grade}${o.section}`,
                value: o.classKey,
              }))}
              value={classKey}
              onValueChange={chooseClass}
            />
          </View>
          <View style={s.analysisScopeTrack}>
            <Select
              label="Subject"
              style={s.analysisScopeLabel}
              options={subjects}
              value={effectiveSubject}
              onValueChange={chooseSubject}
              disabled={!subjects.length}
            />
          </View>
          <View style={s.analysisScopeTrack}>
            <Select
              label="Assessment"
              style={s.analysisScopeLabel}
              options={assessments.map((a) => ({ label: `${a.title} · ${a.date}`, value: a.id }))}
              value={analysis?.id || ''}
              onValueChange={setAssessmentId}
              disabled={!assessments.length}
            />
          </View>
        </View>
        <Text style={s.analysisScopeNote}>
          Every analysis is linked to a saved assessment with a compulsory question paper and its
          Class master record.
        </Text>
      </View>

      {!analysis ? (
        <View style={s.card}>
          <Text style={s.eyebrow}>No assessment evidence yet</Text>
          <Text accessibilityRole="header" style={s.cardTitle}>
            Create the assessment first
          </Text>
          <Text style={s.cardBody}>
            Add its Class, subject, question paper, marking scheme, and model answer before
            uploading student responses.
          </Text>
          {/* A row so the button keeps its own width, as an inline <button> did. */}
          <ButtonRow>
            <AppButton
              variant="primary"
              title="Create assessment"
              onPress={() => open('create-assessment')}
            />
          </ButtonRow>
        </View>
      ) : (
        <AssessmentHeatmap selected={analysis} open={open} notify={notify} />
      )}
    </>
  );
}
