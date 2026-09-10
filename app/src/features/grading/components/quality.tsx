/**
 * Three small dialogs that all answer the same question in different scopes:
 * what does the graded evidence actually support?
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `QualityDialog` (~1538),
 * `EvidenceDialog` (~1555) and `GroupDialog` (~1591). They are one file because
 * each is under a screenful and none of them owns any state - every figure is
 * derived from the workspace at render.
 *
 * What they refuse to invent is the point of all three. The quality check
 * scores cognitive balance only from questions that were really tagged, and
 * says so when there are none; the evidence dialog shows an empty state rather
 * than a plausible-looking gap; the group dialog lists nobody when nobody is
 * below the threshold.
 */

import { Text, View } from 'react-native';

import { allGradeResults } from '@/features/workspace/lib/analytics';
import { AppButton } from '@/shared/components/buttons';
import { Checkbox, Select } from '@/shared/components/form';
import { Bar, DialogHead } from '@/shared/components/primitives';
import { useAppStyles } from '@/shared/theme/styles';
import type { Assessment, CognitiveLevel, GradeResult, W, Worksheet } from '@/shared/types/workspace';

/* ------------------------------------------------------------------------- *
 * QualityDialog
 * ------------------------------------------------------------------------- */

export function QualityDialog({ assessment, state, done }: W<'assessment' | 'state' | 'done'>) {
  const s = useAppStyles();

  const evidenceSufficiency = assessment.totalReviews
    ? Math.round((assessment.reviewed / assessment.totalReviews) * 100)
    : 0;
  const results: GradeResult[] = Object.values(assessment.gradeResults || {});
  const conceptsGraded = new Set(results.flatMap((r) => r.gaps.map((g) => g.concept)));
  const conceptCount = conceptsGraded.size;

  const relevantWorksheets: Worksheet[] = (state?.resources || []).filter(
    (r) => r.content && (conceptsGraded.has(r.concept || '') || r.concept === undefined),
  );
  const allQuestions = relevantWorksheets.flatMap((r) => [
    ...(r.content?.mcqQuestions || []),
    ...(r.content?.subjectiveQuestions || []),
  ]);
  const levelCounts = { recall: 0, application: 0, analysis: 0 };
  allQuestions.forEach((q) => {
    if (q.cognitiveLevel in levelCounts) levelCounts[q.cognitiveLevel as CognitiveLevel]++;
  });
  const totalTagged = allQuestions.length;

  // 100 when the three levels are evenly represented, falling as one of them
  // takes over. Only a real, tagged question set can produce a score at all.
  let cognitiveBalancePct: number | null = null;
  if (totalTagged > 0) {
    const maxShare =
      Math.max(levelCounts.recall, levelCounts.application, levelCounts.analysis) / totalTagged;
    const evenShare = 1 / 3;
    cognitiveBalancePct = Math.round(
      Math.max(0, Math.min(100, 100 - ((maxShare - evenShare) / (1 - evenShare)) * 100)),
    );
  }

  return (
    <>
      <DialogHead
        eyebrow="Assessment Quality Check"
        title={evidenceSufficiency >= 70 ? 'Suitable with limitations' : 'Needs more evidence'}
      />
      <View style={s.qualityBars}>
        <View style={s.barTrackCell}>
          <Bar label="Evidence sufficiency" pct={evidenceSufficiency} />
        </View>
        <View style={s.barTrackCell}>
          <Bar label="Concepts with graded evidence" pct={Math.min(100, conceptCount * 20)} />
        </View>
        {totalTagged > 0 ? (
          <View style={s.barTrackCell}>
            <Bar
              label="Cognitive balance (recall/application/analysis spread)"
              pct={cognitiveBalancePct || 0}
            />
          </View>
        ) : null}
      </View>

      {totalTagged > 0 ? (
        <View style={s.insight}>
          <Text style={s.insightText}>
            {`Cognitive balance measured from ${totalTagged} real question${totalTagged === 1 ? '' : 's'} across ${relevantWorksheets.length} generated worksheet${relevantWorksheets.length === 1 ? '' : 's'} for this concept area: ${levelCounts.recall} recall · ${levelCounts.application} application · ${levelCounts.analysis} analysis. A perfectly even split scores 100; a set that's all one level scores lower.`}
          </Text>
        </View>
      ) : null}

      <View style={s.insight}>
        <Text style={s.insightText}>
          {results.length
            ? `${conceptCount} concept${conceptCount === 1 ? '' : 's'} have graded evidence so far.${
                totalTagged
                  ? ''
                  : ' No generated worksheets with tagged questions exist yet for this concept area — create one in Worksheet studio to see cognitive-balance scoring.'
              }`
            : 'No graded evidence yet for this assessment. Grade at least one answer sheet to see real quality signals.'}
        </Text>
      </View>

      <AppButton variant="primary" full title="Acknowledge recommendations" onPress={done} />
    </>
  );
}

/* ------------------------------------------------------------------------- *
 * EvidenceDialog
 * ------------------------------------------------------------------------- */

const CLASSIFICATIONS = [
  'Priority learning gap',
  'Developing understanding',
  'Performance issue',
  'Insufficient evidence',
];

/**
 * One student against one concept.
 *
 * `id` packs two URI-encoded values behind the dialog name, which is why the
 * registry splits only on the first ":" - a concept may contain one.
 */
export function EvidenceDialog({ state, id, done }: W<'state' | 'done'> & { id: string }) {
  const s = useAppStyles();
  const [encStudent, encConcept] = (id || '').split(':');
  const studentName = decodeURIComponent(encStudent || '');
  const concept = decodeURIComponent(encConcept || '');

  const results = allGradeResults(state).filter((r) => r.studentName === studentName);
  const withGap = results.find((r) => r.gaps.some((g) => g.concept === concept));
  const gap = withGap?.gaps.find((g) => g.concept === concept);

  return (
    <>
      <DialogHead
        eyebrow={`Student evidence · ${studentName || 'Unknown student'}`}
        title={concept || 'Concept evidence'}
      />
      {!withGap ? (
        <Text style={s.modalCopy}>
          {`No graded evidence found for ${studentName || 'this student'} on "${concept}". Grade their answer sheet to populate this view.`}
        </Text>
      ) : (
        <>
          <View style={s.evidence}>
            <Text style={s.evidenceTitle}>{`${concept} · ${gap?.mastery}% mastery`}</Text>
            <Text style={s.evidenceBody}>
              {withGap.feedback || 'No detailed feedback was returned for this answer sheet.'}
            </Text>
          </View>
          <View style={s.evidence}>
            <Text style={s.evidenceTitle}>Overall score</Text>
            <Text style={s.evidenceBody}>
              {`${withGap.score}/${withGap.maxMarks} marks${
                withGap.questionPaperName ? ` · graded against ${withGap.questionPaperName}` : ''
              }`}
            </Text>
          </View>
        </>
      )}
      <Select label="Teacher classification" options={CLASSIFICATIONS} />
      <AppButton variant="primary" full title="Save evidence decision" onPress={done} />
    </>
  );
}

/* ------------------------------------------------------------------------- *
 * GroupDialog
 * ------------------------------------------------------------------------- */

/** Below this, a student joins the temporary group for a concept. */
const GROUP_MASTERY_CEILING = 70;

export function GroupDialog({ state, id, done }: W<'state' | 'done'> & { id: string }) {
  const s = useAppStyles();
  const [assessmentId, encConcept] = (id || '').split(':');
  const concept = decodeURIComponent(encConcept || '');

  const assessment = state.assessments.find((a: Assessment) => a.id === assessmentId);
  const results: GradeResult[] = assessment ? Object.values(assessment.gradeResults || {}) : [];
  const affected = results
    .filter((r) =>
      r.gaps.some((g) => g.concept === concept && g.mastery < GROUP_MASTERY_CEILING),
    )
    .map((r) => r.studentName);

  return (
    <>
      <DialogHead
        eyebrow="Temporary group"
        title={`Strengthen · ${affected.length} student${affected.length === 1 ? '' : 's'}`}
      />
      {!affected.length ? (
        <Text style={s.modalCopy}>
          {`No students currently below ${GROUP_MASTERY_CEILING}% mastery on "${concept}" from graded evidence.`}
        </Text>
      ) : null}
      {affected.map((name) => (
        <Checkbox key={name} label={name} defaultChecked />
      ))}
      <AppButton variant="primary" full title="Save group membership" onPress={done} />
    </>
  );
}
