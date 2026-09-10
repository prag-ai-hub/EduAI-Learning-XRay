/**
 * The teacher's landing module - five headline figures, the assessment
 * pipeline, and the one thing worth doing next.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `TeacherHome` (~440).
 *
 * Every number is derived: `conceptMastery` decides what counts as a priority
 * gap, the pipeline reads `state.assessments`, and "Follow-ups due" is measured
 * against today's date rather than stored. Nothing here is demo data.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE
 * ---------------------------------------------------------------------------
 * `.metric-grid.five` is `repeat(5,1fr)`, `repeat(3,1fr)` below 1050px and a
 * horizontal scroll strip below 760px. The first two are the wrapping flex row
 * `metricTrackFive` already encodes; the third has to be a real ScrollView,
 * because a non-wrapping flex row of five 154px cards would simply be clipped.
 *
 * The pipeline table is `@/shared/components/table`: `RowButton` assigns the
 * four `.tr` tracks by child position, which is what keeps the header aligned
 * with the rows now that there is no shared grid definition.
 */

import { useMemo } from 'react';
import { ScrollView, Text, useWindowDimensions, View } from 'react-native';

import { conceptMastery } from '@/features/workspace/lib/analytics';
import { nextAction, stageLabel } from '@/features/workspace/lib/demo-state';
import { AppButton, LinkButton } from '@/shared/components/buttons';
import { Card, CardHead, CardSpan2, Metric, PageHead } from '@/shared/components/primitives';
import { Cell, HeadRow, RowButton, Table } from '@/shared/components/table';
import { layoutFor, useAppStyles } from '@/shared/theme/styles';
import type { Assessment, Intervention, W } from '@/shared/types/workspace';

export function TeacherHome({
  profile,
  state,
  openAssessment,
  open,
}: W<'profile' | 'state' | 'openAssessment' | 'open'>) {
  const s = useAppStyles();
  const { width } = useWindowDimensions();
  const compact = layoutFor(width) === 'compact';

  const pending = state.assessments.reduce(
    (n: number, a: Assessment) => n + Math.max(0, a.totalReviews - a.reviewed),
    0,
  );
  const concepts = useMemo(() => conceptMastery(state), [state]);
  const priorityConcepts = concepts.filter((c) => c.mastery < 70);
  const today = new Date().toISOString().slice(0, 10);
  const followupsDue = state.interventions.filter(
    (i: Intervention) => i.status !== 'Completed' && i.followup && i.followup <= today,
  ).length;

  const metrics = (
    <>
      <View style={s.metricTrackFive}>
        <Metric
          label="Assessments"
          value={state.assessments.length}
          note="Persisted securely"
        />
      </View>
      <View style={s.metricTrackFive}>
        <Metric label="Answers to review" value={pending} note="Teacher judgement" />
      </View>
      <View style={s.metricTrackFive}>
        <Metric
          label="Priority gaps"
          value={String(priorityConcepts.length)}
          note={
            concepts.length
              ? `Across ${concepts.length} concept${concepts.length === 1 ? '' : 's'} with evidence`
              : 'No graded evidence yet'
          }
        />
      </View>
      <View style={s.metricTrackFive}>
        <Metric label="Interventions" value={state.interventions.length} note="Active cycles" />
      </View>
      <View style={s.metricTrackFive}>
        <Metric
          label="Follow-ups due"
          value={String(followupsDue)}
          note="Overdue or due today"
        />
      </View>
    </>
  );

  return (
    <>
      <PageHead
        eyebrow="Teacher workspace"
        title={`Good morning, ${String(profile?.name || 'Teacher').split(' ')[0]}.`}
        subtitle="Follow the clearest path from evidence to action.">
        <AppButton
          variant="primary"
          icon="＋"
          title="Create assessment"
          onPress={() => open('create-assessment')}
        />
        <AppButton icon="↑" title="Upload work" onPress={() => open('upload')} />
      </PageHead>

      {compact ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.metricGrid}>
          {metrics}
        </ScrollView>
      ) : (
        <View style={s.metricGrid}>{metrics}</View>
      )}

      <View style={s.dashboardGrid}>
        <CardSpan2>
          <CardHead title="Continue your work" eyebrow="Assessment pipeline">
            <LinkButton title="New assessment →" onPress={() => open('create-assessment')} />
          </CardHead>
          <Table>
            {/* Plain strings, not <Text>: HeadRow wraps a string child in the
                `.tr.th` type style and passes anything else through. */}
            <HeadRow>
              {'Assessment'}
              {'Progress'}
              {'Next step'}
              {'Status'}
            </HeadRow>
            {state.assessments.map((a: Assessment, index: number) => (
              <RowButton
                key={a.id}
                last={index === state.assessments.length - 1}
                accessibilityLabel={`${a.title}, ${stageLabel[a.stage]}`}
                onPress={() => openAssessment(a.id, 'Work')}>
                <Cell
                  strong
                  title={a.title}
                  caption={`Class ${a.grade}${a.section} · ${a.subject}`}
                />
                <Cell title={`${a.reviewed}/${a.totalReviews || 0}`} />
                <Cell title={nextAction(a.stage)} />
                <Cell strong title={stageLabel[a.stage]} />
              </RowButton>
            ))}
          </Table>
        </CardSpan2>

        <Card style={s.dashboardTrack}>
          <CardHead
            eyebrow="Recommended next"
            title={pending ? 'Review uncertain answers' : 'Create a new Learning X-Ray'}
          />
          <Text style={s.cardBody}>AI suggestions remain drafts until you approve them.</Text>
          <AppButton
            variant="primary"
            full
            title={`${pending ? 'Review next answer' : 'Open sample X-Ray'} →`}
            onPress={() => openAssessment('a1', 'Review')}
          />
        </Card>
      </View>
    </>
  );
}
