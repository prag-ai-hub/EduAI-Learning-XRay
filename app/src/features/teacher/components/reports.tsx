/**
 * The Reports module - six tabs over the same graded evidence, plus the
 * sharing and safeguard panels that travel with every export.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `Reports` (~608).
 *
 * The empty states are the point of the screen: with nothing graded it says so
 * rather than drawing a chart of demo numbers, and a single graded date says
 * "grade evidence across more than one date to see a trend" rather than
 * plotting one bar as if it were a line.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE
 * ---------------------------------------------------------------------------
 * The `.chart` bars keep their percentage heights: `chart` carries a definite
 * 230px height, so a `height: "n%"` child resolves against it exactly as the
 * CSS did. The web's vertical gradient collapses to the solid navy it ends on -
 * see the CAVEATS block in styles.ts.
 *
 * The expiry `<select>` and the two `.check` boxes are `Select`/`Checkbox` from
 * `form.tsx` standing alone, without a `<Form>`. They are unnamed here exactly
 * as they were unnamed in the markup: this panel demonstrates the sharing
 * controls, and the dialog behind "Create secure link" is what submits.
 */

import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { conceptMastery, masteryTrend } from '@/features/workspace/lib/analytics';
import { reportTitle } from '@/features/workspace/lib/demo-state';
import { AppButton } from '@/shared/components/buttons';
import { Checkbox, Select } from '@/shared/components/form';
import { SchoolPerformanceMatrix } from '@/shared/components/performance-matrix';
import { Bar, Card, CardHead, CardSpan2, PageHead } from '@/shared/components/primitives';
import { FilterChips } from '@/shared/components/status';
import { useAppStyles } from '@/shared/theme/styles';
import type { W } from '@/shared/types/workspace';

const TABS = [
  'Student performance',
  'Performance matrix report',
  'Concept mastery',
  'Learning gaps',
  'Teacher summary',
  'School dashboard',
] as const;

type Tab = (typeof TABS)[number];

const SAFEGUARDS = [
  'No teacher or student ranking',
  'Assessment limitations disclosed',
  'Teacher-approved results only',
  'Revocable access',
];

export function Reports({ state, open, notify }: W<'state' | 'open' | 'notify'>) {
  const s = useAppStyles();
  const [tab, setTab] = useState<Tab>('Student performance');

  const concepts = useMemo(() => conceptMastery(state), [state]);
  const trend = useMemo(() => masteryTrend(state), [state]);

  return (
    <>
      <PageHead
        eyebrow="Reports"
        title="Reports"
        subtitle="Interactive performance views with quality, privacy and limitation context.">
        <AppButton
          variant="primary"
          icon="＋"
          title="Generate report"
          onPress={() => open('report')}
        />
      </PageHead>

      <FilterChips
        options={TABS}
        value={tab}
        onChange={setTab}
        accessibilityLabel="Report views"
      />

      {tab === 'Performance matrix report' ? (
        <SchoolPerformanceMatrix state={state} />
      ) : (
        <View style={s.dashboardGrid}>
          <CardSpan2>
            <CardHead eyebrow={tab} title={reportTitle(tab)}>
              <AppButton
                title="Export"
                onPress={() => notify(`${tab} exported as a report`)}
              />
            </CardHead>

            {!concepts.length ? (
              <Text style={s.modalCopy}>
                No graded evidence yet. Grade answer sheets to populate real reports here.
              </Text>
            ) : tab.includes('matrix') || tab.includes('mastery') ? (
              <View style={s.conceptBars}>
                {concepts.map((c) => (
                  <Bar key={c.concept} label={c.concept} pct={c.mastery} />
                ))}
              </View>
            ) : trend.length ? (
              <View style={s.chart} accessibilityLabel="Performance trend chart">
                {trend.map((t) => (
                  <Pressable
                    key={t.label}
                    role="button"
                    accessibilityLabel={`${t.label}, ${t.value}%`}
                    onPress={() => notify(`${t.label}: ${t.value}% mastery`)}
                    style={[s.chartBar, { height: `${Math.max(0, Math.min(100, t.value))}%` }]}
                  />
                ))}
              </View>
            ) : (
              <Text style={s.modalCopy}>
                Grade evidence across more than one date to see a trend.
              </Text>
            )}
          </CardSpan2>

          <Card style={s.dashboardTrack}>
            <Text style={s.eyebrow}>Secure sharing</Text>
            <Text accessibilityRole="header" style={s.cardTitle}>
              Leadership report
            </Text>
            <Select label="Expiry" options={['7 days', '30 days', '90 days']} />
            <Checkbox label="Require access code" defaultChecked />
            <Checkbox label="Allow download" />
            <AppButton
              variant="primary"
              full
              title="Create secure link"
              onPress={() => open('share-report')}
            />
          </Card>

          <Card style={s.dashboardTrack}>
            <Text style={s.eyebrow}>Data safeguards</Text>
            <Text accessibilityRole="header" style={s.cardTitle}>
              Context included
            </Text>
            <View style={s.checklist}>
              {SAFEGUARDS.map((item) => (
                <View key={item} style={s.checklistRow}>
                  <Text style={s.checklistBullet}>✓</Text>
                  <Text style={s.checklistText}>{item}</Text>
                </View>
              ))}
            </View>
          </Card>
        </View>
      )}
    </>
  );
}
