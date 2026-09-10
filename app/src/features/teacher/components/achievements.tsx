/**
 * The Achievements module - recognition for evidence quality and follow-up,
 * never for volume, and never ranked against another teacher.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `AchievementsView` (~668).
 * Every badge caption is derived from real graded results and completed
 * interventions, so an empty workspace honestly reads "Not yet".
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE
 * ---------------------------------------------------------------------------
 * `.metric-grid` is a four-column grid that becomes a horizontal scroll strip
 * below 760px (`styles.ts`: `metricGrid` drops its `flexWrap` and `metricTrack`
 * takes a 154px floor). A wrapping flex row cannot express both, so the strip
 * is a real horizontal ScrollView on a compact layout.
 *
 * `.achievement-grid > button` shares its CSS with `.settings-grid > button`;
 * `settingsCard` is that shared rule, which is why this file styles a badge
 * with it rather than declaring a lookalike.
 */

import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';

import { allGradeResults } from '@/features/workspace/lib/analytics';
import { AppButton } from '@/shared/components/buttons';
import { Metric, PageHead } from '@/shared/components/primitives';
import { layoutFor, useAppStyles } from '@/shared/theme/styles';
import type { Assessment, Intervention, W } from '@/shared/types/workspace';

/** The five glyphs, in badge order - `["✦","↗","✓","◎","◷"]` on the web. */
const BADGE_GLYPHS = ['✦', '↗', '✓', '◎', '◷'];

export function AchievementsView({ state, notify }: W<'state' | 'notify'>) {
  const s = useAppStyles();
  const { width } = useWindowDimensions();
  const compact = layoutFor(width) === 'compact';

  const results = allGradeResults(state);
  const completedInterventions = state.interventions.filter(
    (i: Intervention) => i.status === 'Completed',
  ).length;
  const followupRate = state.interventions.length
    ? Math.round((completedInterventions / state.interventions.length) * 100)
    : 0;
  const avgQuality = state.assessments.length
    ? Math.round(
        state.assessments.reduce((sum: number, a: Assessment) => sum + (a.quality || 0), 0) /
          state.assessments.length,
      )
    : 0;

  const badges: [string, string][] = [
    ['First Learning X-Ray', results.length ? 'Completed' : 'Not yet — grade an answer sheet'],
    [
      'Intervention Planner',
      completedInterventions ? 'Completed' : 'Not yet — complete an intervention',
    ],
    ['Evidence-Based Teacher', `${Math.min(completedInterventions, 5)} of 5 cycles`],
    ['Assessment Quality Champion', `${avgQuality}% avg quality`],
    ['Answer sheets graded', `${results.length} graded`],
  ];

  const metrics = (
    <>
      <View style={s.metricTrack}>
        <Metric
          label="Improvement cycles"
          value={String(completedInterventions)}
          note="Completed"
        />
      </View>
      <View style={s.metricTrack}>
        <Metric
          label="Answer sheets graded"
          value={String(results.length)}
          note="EduAI analysis"
        />
      </View>
      <View style={s.metricTrack}>
        <Metric label="Follow-up completion" value={`${followupRate}%`} note="This term" />
      </View>
      <View style={s.metricTrack}>
        <Metric
          label="Avg assessment quality"
          value={`${avgQuality}%`}
          note="Across all assessments"
        />
      </View>
    </>
  );

  return (
    <>
      <PageHead
        eyebrow="Progress without competition"
        title="Achievements"
        subtitle="Recognition rewards evidence quality, follow-up and improvement—not upload volume.">
        <AppButton
          title="Weekly summary"
          onPress={() => notify('Weekly progress summary prepared')}
        />
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

      <View style={s.achievementGrid}>
        {badges.map(([name, status], index) => (
          <Pressable
            key={name}
            role="button"
            accessibilityLabel={`${name}: ${status}`}
            onPress={() => notify(`${name}: ${status}`)}
            style={({ hovered, pressed }) => [
              s.settingsCard,
              s.achievementTrack,
              (hovered || pressed) && s.settingsCardHover,
            ]}>
            <View style={s.achievementIcon}>
              <Text style={s.achievementIconText}>{BADGE_GLYPHS[index]}</Text>
            </View>
            <Text style={s.settingsCardTitle}>{name}</Text>
            <Text style={s.settingsCardCaption}>{status}</Text>
          </Pressable>
        ))}
      </View>

      <View style={s.insight}>
        <Text style={s.insightText}>
          No teacher or student leaderboard is used. School challenges and celebrations can be
          disabled by administrators.
        </Text>
      </View>
    </>
  );
}
