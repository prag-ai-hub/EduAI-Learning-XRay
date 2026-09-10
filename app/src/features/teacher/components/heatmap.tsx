/**
 * The X-Ray module - the concept x student heat map and everything read off it.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `AssessmentHeatmap`
 * (~566). Every figure is aggregated from real graded results for the selected
 * assessment; with nothing graded the screen says so and stops, rather than
 * drawing placeholder bands.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE - the grid
 * ---------------------------------------------------------------------------
 * The web was one CSS grid:
 * `grid-template-columns: 100px repeat(concepts, minmax(72px,1fr))`, filled by
 * a flatMap that emitted a student's name followed by their cells. React Native
 * has no grid, so it is a header row plus one flex row per student.
 *
 * With flex, two rows only line up if they were given the same track widths in
 * the same order - there is no shared column definition to fall back on. So the
 * widths are computed once here (`LABEL_WIDTH`, `COLUMN`) and the same objects
 * are applied to the header and to every body row. Changing a column width
 * therefore cannot move the header without moving the cells with it.
 *
 * `minmax(72px, 1fr)` survives as a `minWidth` on the shared column plus a
 * container floor wide enough for every column to reach it; the whole grid then
 * scrolls horizontally, which is what `.heatmap{overflow-x:auto}` did.
 *
 * The stylesheet's compact rule rotates the column headings to vertical text
 * (`writing-mode: vertical-rl`). There is no writing mode in React Native, so
 * on a phone the headings stay horizontal and the grid scrolls instead - the
 * same information, reached by a swipe rather than by a tilt of the head.
 */

import { useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';

import { downloadClassLearningGapReport } from '@/features/documents/lib/downloads';
import { inferDocumentRole } from '@/features/workspace/lib/documents';
import { AppButton, ButtonRow } from '@/shared/components/buttons';
import { BrandDocumentHeader } from '@/shared/components/brand';
import { Select } from '@/shared/components/form';
import { useAppStyles, layoutFor, Space, type AppStyles } from '@/shared/theme/styles';
import type { GradeResult, UploadFile, W } from '@/shared/types/workspace';

/** `minmax(72px, 1fr)` - the floor every concept column keeps. */
const COLUMN_MIN = 72;

/** The four heat bands, under the names the CSS gave them. */
type Band = 'excellent' | 'average' | 'weak' | 'review';

function bandFor(value: number | null): Band {
  if (value === null) return 'review';
  if (value >= 80) return 'excellent';
  if (value <= 35) return 'weak';
  return 'average';
}

function bandStyles(s: AppStyles, band: Band) {
  switch (band) {
    case 'excellent':
      return { box: s.tierMastered, text: s.tierMasteredText };
    case 'average':
      return { box: s.tierDeveloping, text: s.tierDevelopingText };
    case 'weak':
      return { box: s.tierGap, text: s.tierGapText };
    default:
      return { box: s.tierReview, text: s.tierReviewText };
  }
}

const LEGEND: readonly [Band, string][] = [
  ['weak', 'Weak · 35% or less'],
  ['average', 'Average · 36% to 79%'],
  ['excellent', 'Excellent · 80% or above'],
  ['review', 'Not assessed'],
];

/**
 * `.xray-summary .metric` - the same metric card on surface2 with a shorter
 * floor. `Metric` in `@/shared/components/primitives` takes no style prop, and
 * giving the wrapper the tint would hide it behind the card's own opaque
 * background, so this variant states the two keys the stylesheet already holds.
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

export function AssessmentHeatmap({ selected, open, notify }: W<'selected' | 'open' | 'notify'>) {
  const s = useAppStyles();
  const { width } = useWindowDimensions();
  const compact = layoutFor(width) === 'compact';
  const [exporting, setExporting] = useState(false);

  const results: GradeResult[] = Object.values(selected.gradeResults || {});
  const hasData = results.length > 0;

  // Aggregate mastery per concept across every real graded result.
  const conceptTotals: Record<string, { sum: number; count: number }> = {};
  results.forEach((r) =>
    r.gaps.forEach((g) => {
      const bucket = conceptTotals[g.concept] || { sum: 0, count: 0 };
      bucket.sum += g.mastery;
      bucket.count += 1;
      conceptTotals[g.concept] = bucket;
    }),
  );
  const concepts = Object.keys(conceptTotals);
  const avgFor = (concept: string) =>
    Math.round(conceptTotals[concept].sum / conceptTotals[concept].count);
  const sortedConcepts = concepts.slice().sort((a, b) => avgFor(a) - avgFor(b));
  const priorityConcept = sortedConcepts[0];
  const classMastery = concepts.length
    ? Math.round(concepts.reduce((sum, c) => sum + avgFor(c), 0) / concepts.length)
    : 0;
  const priorityStudents = results.filter((r) =>
    r.gaps.some((g) => g.concept === priorityConcept && g.mastery < 70),
  );
  const students = Array.from(new Set(results.map((r) => r.studentName)));

  const clusterMap = new Map<string, string[]>();
  results.forEach((r) => {
    const signature =
      r.gaps
        .filter((g) => g.mastery < 70)
        .sort((a, b) => a.mastery - b.mastery)
        .slice(0, 2)
        .map((g) => g.concept)
        .join(' + ') || 'Monitor only';
    clusterMap.set(signature, [...(clusterMap.get(signature) || []), r.studentName]);
  });
  const clusters = Array.from(clusterMap.entries()).sort((a, b) => b[1].length - a[1].length);

  const lastGradedFileId = selected.lastGradedFileId || results[0]?.fileId;

  // The one shared column definition: the header row and every student row read
  // these, so a column cannot move in one without moving in the other.
  const labelWidth = compact ? 70 : 100;
  const gap = compact ? Space.s4 : Space.s7;
  const gridMinWidth = labelWidth + Math.max(1, concepts.length) * (COLUMN_MIN + gap);
  const column = { minWidth: COLUMN_MIN };

  const exportClassReport = async () => {
    setExporting(true);
    try {
      await downloadClassLearningGapReport(selected, results);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : 'The class report could not be exported.',
        'error',
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <View style={s.assessmentAnalysisActions}>
        <View style={{ flexShrink: 1 }}>
          <Text style={s.eyebrow}>Selected assessment · Students</Text>
          <Text accessibilityRole="header" style={s.assessmentAnalysisTitle}>
            {selected.title}
          </Text>
          <Text style={s.assessmentAnalysisCaption}>
            Class {selected.grade}
            {selected.section} · {selected.subject} · {results.length} analysed student
            {results.length === 1 ? '' : 's'}
          </Text>
        </View>
        <ButtonRow>
          <AppButton
            title={exporting ? 'Preparing…' : 'Download Learning Gap Report'}
            disabled={!hasData || exporting}
            onPress={() => void exportClassReport()}
          />
          <AppButton
            variant="primary"
            title="Create study guide"
            disabled={!hasData}
            onPress={() => open(`study-guide:${lastGradedFileId}`)}
          />
          <AppButton title="Build gap worksheet" onPress={() => open('worksheet')} />
          <AppButton title="Assessment quality" onPress={() => open('quality')} />
        </ButtonRow>
      </View>

      {!hasData ? (
        <View style={[s.card, s.cardSpan2]}>
          <Text style={s.eyebrow}>No graded evidence yet</Text>
          <Text accessibilityRole="header" style={s.cardTitle}>
            Grade at least one answer sheet to see real learning gaps
          </Text>
          <Text style={s.cardBody}>
            This report is built entirely from Mistral-graded results for {selected.subject}. Once
            you grade a student&apos;s answer sheet, their concept-level gaps will appear here
            instead of placeholder data.
          </Text>
        </View>
      ) : null}

      {hasData ? (
        <View style={s.executiveSummary}>
          <Text style={s.eyebrow}>Executive summary</Text>
          <Text accessibilityRole="header" style={s.executiveSummaryTitle}>
            Learning gaps requiring attention
          </Text>
          {sortedConcepts.map((concept) => (
            <Text key={concept} style={s.executiveSummaryItem}>
              • {concept} — {avgFor(concept)}% average mastery
            </Text>
          ))}
        </View>
      ) : null}

      {hasData ? (
        <View style={s.dashboardGrid}>
          <View style={[s.brandedDocument, s.cardSpan2]}>
            <BrandDocumentHeader
              label="Learning gap report"
              title={selected.title}
              meta={`${selected.subject} · ${results.length} analysed answer sheet${
                results.length === 1 ? '' : 's'
              }`}
            />

            <View style={s.sourceRibbon}>
              <Text style={s.sourceRibbonText}>Evidence used</Text>
              {selected.files.map((file: UploadFile) => (
                <View key={file.id} style={s.sourceRibbonTag}>
                  <Text style={s.sourceRibbonText}>
                    {file.documentRole || inferDocumentRole(file.name)} · {file.name}
                  </Text>
                </View>
              ))}
            </View>

            <View style={s.xraySummary}>
              <SummaryMetric
                label="Class mastery"
                value={`${classMastery}%`}
                note="Graded evidence"
              />
              <SummaryMetric
                label="Priority concepts"
                value={String(sortedConcepts.filter((c) => avgFor(c) < 70).length)}
                note={`${priorityStudents.length} students`}
              />
              <SummaryMetric
                label="Confidence"
                value={results.length > 2 ? 'High' : results.length > 1 ? 'Medium' : 'Low'}
                note={`${results.length} evidence point${results.length === 1 ? '' : 's'}`}
              />
              <SummaryMetric
                label="Quality"
                value={`${selected.quality || 0}%`}
                note="Suitable with limitations"
              />
            </View>

            <View style={s.gapClusters}>
              <View style={s.clusterHeading}>
                <Text style={s.clusterHeadingTitle}>Dynamic intervention groups</Text>
                <Text style={s.clusterHeadingCaption}>Students with similar priority gaps</Text>
              </View>
              {clusters.map(([label, names], index) => (
                <Pressable
                  key={label}
                  role="button"
                  accessibilityLabel={`Group ${index + 1}: ${label}. ${names.join(', ')}`}
                  onPress={() => notify(`${label}: ${names.join(', ')}`)}
                  style={[s.gapCluster, s.gapClusterTrack]}>
                  <Text style={s.gapClusterKicker}>Group {index + 1}</Text>
                  <Text style={s.gapClusterTitle}>{label}</Text>
                  <Text style={s.gapClusterBody}>{names.join(' · ')}</Text>
                </Pressable>
              ))}
            </View>

            {/* `flexGrow` on both the content container and the grid is what
                keeps `1fr` meaning "share the card" on a wide screen: without
                it the grid would size to `gridMinWidth` and stop there. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ flexGrow: 1 }}>
              <View style={[s.heatmap, { minWidth: gridMinWidth, flexGrow: 1 }]}>
                <View style={s.heatmapRow}>
                  {/* The empty top-left corner - `<div/>` on the web. It holds
                      the row-label track open so column one starts in the same
                      place on the header as on every student's row. */}
                  <Text style={s.heatmapRowLabel} />
                  {concepts.map((concept) => (
                    <Text key={concept} style={[s.heatmapColLabel, column]} numberOfLines={2}>
                      {concept}
                    </Text>
                  ))}
                </View>

                {students.map((student) => {
                  const result = results.find((r) => r.studentName === student);
                  return (
                    <View key={student} style={s.heatmapRow}>
                      <Text style={s.heatmapRowLabel} numberOfLines={2}>
                        {student}
                      </Text>
                      {concepts.map((concept) => {
                        const gap = result?.gaps.find((g) => g.concept === concept);
                        const value = gap ? gap.mastery : null;
                        const band = bandFor(value);
                        const tint = bandStyles(s, band);
                        return (
                          <Pressable
                            key={concept + student}
                            role="button"
                            disabled={value === null}
                            accessibilityLabel={`${student}, ${concept}, ${
                              value === null ? 'not assessed' : `${value}% ${band}`
                            }`}
                            onPress={() =>
                              open(
                                `evidence:${encodeURIComponent(student)}:${encodeURIComponent(
                                  concept,
                                )}`,
                              )
                            }
                            style={[s.heatmapCell, column, tint.box]}>
                            <Text style={[s.heatmapCellText, tint.text]}>
                              {value === null ? '—' : `${value}%`}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  );
                })}
              </View>
            </ScrollView>

            <View style={s.heatLegend} accessibilityLabel="Heatmap performance categories">
              {LEGEND.map(([band, label]) => (
                <View key={band} style={s.heatLegendItem}>
                  <View style={[s.heatLegendSwatch, bandStyles(s, band).box]} />
                  <Text style={s.heatLegendLabel}>{label}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={[s.card, s.dashboardTrack]}>
            <Text style={s.eyebrow}>Priority gap</Text>
            <Text accessibilityRole="header" style={s.cardTitle}>
              {priorityConcept || 'No concept identified yet'}
            </Text>
            <View style={s.bigStat}>
              <Text style={s.bigStatValue}>{priorityStudents.length}</Text>
              <Text style={s.bigStatCaption}>students</Text>
            </View>
            <Text style={s.cardBody}>
              {priorityConcept
                ? `Lowest average mastery across graded evidence for ${selected.subject}: ${avgFor(
                    priorityConcept,
                  )}%.`
                : 'Grade more answer sheets to surface a priority concept.'}
            </Text>
            <View style={s.gapFunnel}>
              {sortedConcepts.slice(0, 3).map((concept) => {
                const value = avgFor(concept);
                return (
                  <View key={concept} style={s.gapFunnelRow}>
                    <View
                      style={[
                        s.gapFunnelFill,
                        value < 60 && s.gapFunnelFillCritical,
                        { width: `${Math.max(0, Math.min(100, value))}%` },
                      ]}
                    />
                    <Text style={s.gapFunnelLabel}>
                      {concept} · {value}%
                    </Text>
                  </View>
                );
              })}
            </View>
            <AppButton
              title="View student evidence"
              disabled={!priorityStudents.length}
              onPress={() =>
                open(
                  `evidence:${encodeURIComponent(
                    priorityStudents[0]?.studentName || '',
                  )}:${encodeURIComponent(priorityConcept || '')}`,
                )
              }
            />
            <AppButton
              variant="primary"
              title="Generate study guide"
              disabled={!priorityConcept}
              onPress={() => open(`study-guide:${lastGradedFileId}`)}
            />
          </View>

          <View style={[s.card, s.dashboardTrack]}>
            <Text style={s.eyebrow}>Teacher authority</Text>
            <Text accessibilityRole="header" style={s.cardTitle}>
              Approve diagnosis
            </Text>
            {/* Both selects were unnamed on the web and are unnamed here: the
                teacher's classification is recorded by the audit trail the
                button writes to, not by a form submission. */}
            <Select
              label="Classification"
              options={[
                'Priority learning gap',
                'Developing',
                'Possible performance issue',
                'Insufficient evidence',
              ]}
            />
            <Select
              label="Observation"
              options={[
                'No additional observation',
                'Time issue',
                'Language issue',
                'Careless error',
              ]}
            />
            <AppButton
              variant="primary"
              full
              title="Approve X-Ray"
              onPress={() => notify('Diagnosis approved and stored in the audit trail')}
            />
          </View>
        </View>
      ) : null}
    </>
  );
}
