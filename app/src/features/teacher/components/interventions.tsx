/**
 * The Interventions module - one card per improvement cycle, plus the concept
 * mastery those cycles are measured against.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `Interventions` (~597).
 *
 * An intervention is temporary and concept-specific by design, so the card
 * shows the evidence count behind its concept rather than a target: with
 * nothing graded it says so instead of inventing a number.
 *
 * The two-step end state is deliberate and unchanged - "Mark complete" closes
 * the teaching, and only then does the card offer "Record follow-up", because
 * the follow-up evidence is what makes the cycle mean anything.
 */

import { useMemo } from 'react';
import { Text, View } from 'react-native';

import { conceptMastery } from '@/features/workspace/lib/analytics';
import { AppButton, ButtonRow } from '@/shared/components/buttons';
import { Bar, Card, CardHead, CardSpan2, PageHead } from '@/shared/components/primitives';
import { StatusPill } from '@/shared/components/status';
import { useAppStyles } from '@/shared/theme/styles';
import type { DemoState, Intervention, W } from '@/shared/types/workspace';

export function Interventions({
  state,
  setState,
  open,
  notify,
}: W<'state' | 'setState' | 'open' | 'notify'>) {
  const s = useAppStyles();

  const complete = (id: string) => {
    setState((current: DemoState) => ({
      ...current,
      interventions: current.interventions.map((i) =>
        i.id === id ? { ...i, status: 'Completed' } : i,
      ),
      events: ['Intervention completed', ...current.events],
    }));
    notify('Intervention marked complete. Record follow-up evidence next.');
  };

  const concepts = useMemo(() => conceptMastery(state), [state]);
  const completedCount = state.interventions.filter(
    (i: Intervention) => i.status === 'Completed',
  ).length;
  const followupRate = state.interventions.length
    ? Math.round((completedCount / state.interventions.length) * 100)
    : 0;

  return (
    <>
      <PageHead
        eyebrow="Improvement cycle"
        title="Interventions & follow-up"
        subtitle="Temporary, concept-specific support linked to measurable evidence.">
        <AppButton
          variant="primary"
          icon="＋"
          title="Create intervention"
          onPress={() => open('intervention-form')}
        />
        <AppButton title="Generate worksheet" onPress={() => open('worksheet')} />
      </PageHead>

      <View style={s.dashboardGrid}>
        {state.interventions.map((i: Intervention) => {
          const evidence = concepts.find((c) => c.concept === i.concept);
          return (
            <Card key={i.id} style={s.dashboardTrack}>
              <StatusPill tone={i.status === 'Completed' ? 'success' : 'warning'}>
                {i.status}
              </StatusPill>
              <Text style={s.eyebrow}>Temporary group · Strengthen</Text>
              <Text accessibilityRole="header" style={s.cardTitle}>
                {i.concept}
              </Text>
              <Text style={s.cardBody}>
                {i.format} · {i.duration} ·{' '}
                {evidence
                  ? `${evidence.evidence} evidence point${evidence.evidence === 1 ? '' : 's'}`
                  : 'No graded evidence yet'}
              </Text>
              <Text style={s.cardBody}>Follow-up: {i.followup}</Text>
              {i.followupRecorded && i.followupEvidence ? (
                <Text style={s.modalCopy}>
                  Recorded outcome: {i.followupEvidence.outcome} ·{' '}
                  {i.followupEvidence.studentsCompleted} students ·{' '}
                  {i.followupEvidence.avgMastery}% avg mastery
                </Text>
              ) : null}
              <ButtonRow>
                <AppButton
                  title="Review group"
                  onPress={() =>
                    open(`group:${i.assessmentId}:${encodeURIComponent(i.concept)}`)
                  }
                />
                {i.status !== 'Completed' ? (
                  <AppButton
                    variant="primary"
                    title="Mark complete"
                    onPress={() => complete(i.id)}
                  />
                ) : (
                  <AppButton
                    variant="primary"
                    title={i.followupRecorded ? 'Follow-up recorded ✓' : 'Record follow-up'}
                    onPress={() => open(`followup:${i.id}`)}
                  />
                )}
              </ButtonRow>
            </Card>
          );
        })}

        <Card style={s.dashboardTrack}>
          <Text style={s.eyebrow}>Resource studio</Text>
          <Text accessibilityRole="header" style={s.cardTitle}>
            Generate teacher-approved materials
          </Text>
          <Text style={s.cardBody}>
            Worksheets, exit tickets, guided examples and answer keys remain drafts until
            approval.
          </Text>
          <AppButton
            variant="primary"
            full
            title="Generate resource"
            onPress={() => open('worksheet')}
          />
        </Card>

        <CardSpan2>
          <CardHead
            eyebrow="Progress tracking"
            title="Concept mastery from graded evidence"
          />
          {concepts.length ? (
            <View style={s.qualityBars}>
              {concepts.slice(0, 3).map((c) => (
                <View key={c.concept} style={s.barTrackCell}>
                  <Bar label={c.concept} pct={c.mastery} />
                </View>
              ))}
              <View style={s.barTrackCell}>
                <Bar label="Intervention follow-up completion" pct={followupRate} />
              </View>
            </View>
          ) : (
            <Text style={s.modalCopy}>
              No graded evidence yet — grade answer sheets to see real concept mastery here.
            </Text>
          )}
        </CardSpan2>
      </View>
    </>
  );
}
