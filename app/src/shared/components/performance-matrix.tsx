/**
 * The school performance matrix - subjects down, classes across, one colour
 * band per cell.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx:621-627.
 *
 * It lives in `shared/` rather than in a slice because Reports (teacher) and
 * PrincipalApp both render it and neither owns it. It reads only its `state`
 * prop and shared types, so nothing here reaches into a feature.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE
 * ---------------------------------------------------------------------------
 * The web was one CSS grid with
 * `grid-template-columns: minmax(170px,1.25fr) repeat(n, minmax(120px,1fr))`.
 * React Native has no grid, so it becomes a header row plus one flex row per
 * subject, each cell carrying its own track weight, inside a horizontal
 * ScrollView with the stylesheet's `matrixMinWidth` floor - which is exactly
 * what the CSS's `min-width` and `overflow-x:auto` did below 900px.
 *
 * The band rule is unchanged and is deliberately *not* `masteryTone`: this
 * grades a whole cohort's scores into 90/75/55 quartile-ish bands, where
 * `masteryTone` grades one concept's mastery at 80/55. Same-looking numbers,
 * different question.
 */

import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { LinkButton } from '@/shared/components/buttons';
import { Card, CardHead } from '@/shared/components/primitives';
import { StatusPill, type StatusTone } from '@/shared/components/status';
import { useAppStyles, type AppStyles } from '@/shared/theme/styles';
import type { Assessment, DemoState, GradeResult } from '@/shared/types/workspace';

type Band = 'green' | 'yellow' | 'orange' | 'red';
type CellBand = Band | 'empty';

type CellData = {
  results: GradeResult[];
  band: CellBand;
  /** Null when the cell holds no results at all - rendered as an em dash. */
  average: number | null;
};

const BAND_PRIORITY: readonly Band[] = ['green', 'yellow', 'orange', 'red'];

const BAND_LEGEND: readonly [Band, string][] = [
  ['green', 'Green · 90% and above'],
  ['yellow', 'Yellow · 75–89%'],
  ['orange', 'Orange · 55–74%'],
  ['red', 'Red · Below 55%'],
];

function percentageOf(result: GradeResult): number {
  return Math.round((result.score / Math.max(1, result.maxMarks)) * 100);
}

function bandOf(percentage: number): Band {
  return percentage >= 90 ? 'green' : percentage >= 75 ? 'yellow' : percentage >= 55 ? 'orange' : 'red';
}

/** The `.status <band>` and `.matrix-cell <band>` tints, from the stylesheet. */
function bandStyles(s: AppStyles, band: CellBand) {
  switch (band) {
    case 'green':
      return { box: s.tierGreen, text: s.tierGreenText };
    case 'yellow':
      return { box: s.tierYellow, text: s.tierYellowText };
    case 'orange':
      return { box: s.tierOrange, text: s.tierOrangeText };
    case 'red':
      return { box: s.tierRed, text: s.tierRedText };
    default:
      return { box: s.tierEmpty, text: s.tierEmptyText };
  }
}

/** The four bands are also the four `StatusPill` colour tones. */
const BAND_TONE: Record<Band, StatusTone> = {
  green: 'green',
  yellow: 'yellow',
  orange: 'orange',
  red: 'red',
};

export function SchoolPerformanceMatrix({ state }: { state: DemoState }) {
  const s = useAppStyles();
  const [selectedCell, setSelectedCell] = useState<{
    className: string;
    subject: string;
    results: GradeResult[];
  } | null>(null);

  const classNames = useMemo(
    () =>
      Array.from(
        new Set<string>(state.assessments.map((a: Assessment) => `Class ${a.grade}${a.section}`)),
      ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [state.assessments],
  );

  const subjects = useMemo(
    () => Array.from(new Set<string>(state.assessments.map((a: Assessment) => a.subject))).sort(),
    [state.assessments],
  );

  const cell = (className: string, subject: string): CellData => {
    const assessments = state.assessments.filter(
      (a: Assessment) => `Class ${a.grade}${a.section}` === className && a.subject === subject,
    );
    const results: GradeResult[] = assessments.flatMap((a: Assessment) =>
      Object.values(a.gradeResults || {}),
    );
    const bands: Record<Band, number> = { green: 0, yellow: 0, orange: 0, red: 0 };
    results.forEach((result) => {
      bands[bandOf(percentageOf(result))]++;
    });
    // Ties go to the better band, because BAND_PRIORITY is walked best-first
    // and a strictly-greater test never displaces an equal earlier entry.
    const band: CellBand = results.length
      ? BAND_PRIORITY.reduce((winner, current) => (bands[current] > bands[winner] ? current : winner))
      : 'empty';
    return {
      results,
      band,
      average: results.length
        ? Math.round(results.reduce((sum, result) => sum + percentageOf(result), 0) / results.length)
        : null,
    };
  };

  return (
    <>
      <Card style={s.principalMatrixCard}>
        <CardHead
          eyebrow="Performance matrix report"
          title="Learning performance across grades, sections and subjects"
        />
        <Text style={s.modalCopy}>
          Each cell uses the score band containing the majority of students in that class and
          subject. Select a colored cell to view every student.
        </Text>

        <View style={s.matrixLegend} accessibilityLabel="Performance matrix score bands">
          {BAND_LEGEND.map(([band, label]) => (
            <View key={band} style={[s.matrixLegendItem, bandStyles(s, band).box]}>
              <Text style={s.matrixLegendText}>{label}</Text>
            </View>
          ))}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={s.principalMatrix} role="grid" accessibilityLabel="School performance matrix">
            <View style={s.matrixHeaderRow}>
              <View style={[s.matrixHeaderCell, s.matrixSubject]} role="columnheader">
                <Text style={s.matrixHeaderText}>Subjects</Text>
              </View>
              {classNames.map((className) => (
                <View key={className} style={s.matrixHeaderCell} role="columnheader">
                  <Text style={s.matrixHeaderText}>{className}</Text>
                </View>
              ))}
            </View>

            {subjects.map((subject) => (
              <View key={subject} style={s.matrixRow}>
                <View style={[s.matrixHeaderCell, s.matrixSubject]} role="rowheader">
                  <Text style={s.matrixHeaderText}>{subject}</Text>
                </View>
                {classNames.map((className) => {
                  const data = cell(className, subject);
                  const tint = bandStyles(s, data.band);
                  const empty = !data.results.length;
                  return (
                    <Pressable
                      key={`${subject}-${className}`}
                      role="button"
                      disabled={empty}
                      onPress={() => setSelectedCell({ className, subject, results: data.results })}
                      accessibilityLabel={`${className}, ${subject}, ${
                        data.average === null
                          ? 'no results'
                          : `${data.average}% average, majority ${data.band}`
                      }`}
                      style={({ hovered, pressed }) => [
                        s.matrixCell,
                        tint.box,
                        (hovered || pressed) && !empty && s.matrixCellHover,
                      ]}>
                      <Text style={[s.matrixCellValue, tint.text]}>
                        {data.average === null ? '—' : `${data.average}%`}
                      </Text>
                      <Text style={[s.matrixCellCaption, tint.text]}>
                        {empty
                          ? 'No results'
                          : `${data.results.length} students · majority ${data.band}`}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
      </Card>

      {selectedCell ? (
        <Card style={s.matrixDrilldown}>
          <CardHead
            eyebrow="Class drill-down"
            title={`${selectedCell.className} · ${selectedCell.subject}`}>
            <LinkButton title="Close" onPress={() => setSelectedCell(null)} />
          </CardHead>
          <View style={s.userTable}>
            {selectedCell.results
              .slice()
              .sort((a, b) => b.score / b.maxMarks - a.score / a.maxMarks)
              .map((result) => {
                const percentage = percentageOf(result);
                const band = bandOf(percentage);
                return (
                  <View style={s.userRow} key={result.fileId}>
                    <View style={[s.performanceDot, bandStyles(s, band).box]} />
                    <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 0 }}>
                      <Text style={s.userRowName}>{result.studentName}</Text>
                      <Text style={s.userRowCaption}>
                        {result.gaps.slice().sort((a, b) => a.mastery - b.mastery)[0]?.concept ||
                          'No priority gap identified'}
                      </Text>
                    </View>
                    <Text style={s.userRowName}>
                      {result.score}/{result.maxMarks} · {percentage}%
                    </Text>
                    <StatusPill tone={BAND_TONE[band]}>{band}</StatusPill>
                  </View>
                );
              })}
          </View>
        </Card>
      ) : null}
    </>
  );
}
