/**
 * The sample Class 9 heat map - twelve concepts by eight students - and the
 * three read-outs beside it.
 *
 * Ported from the `#heatmap` section of frontend/app/ui/MarketingHome.tsx.
 * Every value comes from `@/features/marketing/lib/copy`; nothing is generated,
 * so the illustration is identical to the web page's.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE
 * ---------------------------------------------------------------------------
 * The web was one CSS grid:
 * `grid-template-columns: 160px repeat(students.length, 1fr)`, filled by a
 * `flatMap` that emitted a row label followed by its cells. React Native has no
 * grid, so it is one flex row per concept: a fixed-width label
 * (`mktHeatRowLabel`) and then `1fr` cells (`mktHeatCell`), with a header row of
 * the same shape. The whole thing sits in a horizontal ScrollView with the
 * stylesheet's `heatMinWidth` floor, which is what `overflow-x` did on a phone.
 *
 * The cells were `<button title="...">`. There is nothing to press - the title
 * was the only content - so each cell is a labelled `View`: a screen reader
 * still reads "AS · Mole ratio · Needs attention", and no tap target is
 * advertised that does nothing.
 */

import { ScrollView, Text, View } from 'react-native';

import { concepts, heat, heatKey, heatNotes, students } from '@/features/marketing/lib/copy';
import { useAppStyles, type AppStyles } from '@/shared/theme/styles';

/** `heat` stores 0 = needs attention, 1 = partial, 2 = secure. */
const TIER_LABEL = ['Needs attention', 'Partial', 'Secure'] as const;

function tierStyle(s: AppStyles, value: number) {
  return value === 2 ? s.tierSecure : value === 1 ? s.tierPartial : s.tierGapMkt;
}

function keyStyles(s: AppStyles, label: string) {
  // The legend reads best-first (Secure, Partial, Needs attention); the tiers
  // are indexed worst-first, so they are matched by name rather than position.
  if (label === 'Secure') return { box: s.tierSecure, text: s.tierSecureText };
  if (label === 'Partial') return { box: s.tierPartial, text: s.tierPartialText };
  return { box: s.tierGapMkt, text: s.tierGapMktText };
}

export function HeatGrid() {
  const s = useAppStyles();
  return (
    <View style={s.heatLayout}>
      <View style={s.heatCard}>
        <View style={s.heatKey}>
          {heatKey.map((label) => {
            const tint = keyStyles(s, label);
            return (
              <View key={label} style={[s.heatKeyItem, tint.box]}>
                <Text style={[s.heatKeyText, tint.text]}>{label}</Text>
              </View>
            );
          })}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={s.mktHeat}>
            <View style={s.mktHeatRow}>
              {/* The empty top-left corner - `<i/>` on the web. A Text, so it
                  holds the row-label track's width without a View inheriting
                  that track's type styling. */}
              <Text style={s.mktHeatRowLabel} />
              {students.map((student) => (
                <Text key={student} style={s.mktHeatColLabel}>
                  {student}
                </Text>
              ))}
            </View>

            {concepts.map((concept, row) => (
              <View key={concept} style={s.mktHeatRow}>
                <Text style={s.mktHeatRowLabel} numberOfLines={2}>
                  {concept}
                </Text>
                {students.map((student, column) => {
                  const value = heat[row * students.length + column];
                  return (
                    <View
                      key={concept + student}
                      style={[s.mktHeatCell, tierStyle(s, value)]}
                      accessibilityLabel={`${student} · ${concept} · ${TIER_LABEL[value]}`}
                    />
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      <View style={s.heatAside}>
        {heatNotes.map(([index, note]) => (
          <View key={index} style={s.heatAsideCard}>
            <Text style={s.heatAsideTitle}>{index}</Text>
            <Text style={s.heatAsideText}>{note}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
