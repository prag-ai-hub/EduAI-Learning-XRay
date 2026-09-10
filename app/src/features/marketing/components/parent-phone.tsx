/**
 * The phone mock-up in the founding-cohort section: what a parent actually
 * receives.
 *
 * Ported from `ParentPhone` in frontend/app/ui/MarketingHome.tsx.
 *
 * The copy is a sample report and is hard-coded there rather than in
 * `copy.ts` - it is one illustration, not a content block the page reuses - so
 * it stays here, verbatim, including the fictional teacher and date.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE
 * ---------------------------------------------------------------------------
 * `.phone-body ol` was a numbered list where each `<li>` held a bold week label
 * and its text. React Native has no list markers, and the CSS did not use one
 * either - it laid the two spans out in a row with a hairline rule between
 * items, which is what `phoneRow` already carries.
 */

import { Text, View } from 'react-native';

import { Space, useAppStyles } from '@/shared/theme/styles';

/** The three-step plan shown on the mock-up. */
const PLAN: readonly [string, string][] = [
  ['Week 1', 'Mole ratio practice'],
  ['Week 2', 'Guided examples'],
  ['Week 4', 'Reassessment'],
];

export function ParentPhone() {
  const s = useAppStyles();
  return (
    <View
      style={s.phone}
      accessibilityLabel="A parent's view of an approved 30-day plan, shown on a phone">
      <View style={s.phoneBar}>
        <View style={s.phoneBarDot} />
        <Text style={s.phoneBarText}>Parent view</Text>
        <Text style={s.phoneBarText}>▦</Text>
      </View>
      <View style={s.phoneBody}>
        <Text style={s.phoneKicker}>Approved for</Text>
        <Text accessibilityRole="header" style={s.phoneTitle}>
          Aarav&apos;s 30-day plan
        </Text>

        <View style={s.parentScore}>
          <Text style={s.parentScoreValue}>3</Text>
          <Text style={s.parentScoreLabel}>concepts secure</Text>
          <Text style={s.parentScoreValue}>2</Text>
          <Text style={s.parentScoreLabel}>to work on</Text>
        </View>

        {PLAN.map(([week, work]) => (
          <View key={week} style={s.phoneRow}>
            <Text style={[s.phoneRowText, { fontWeight: '700' }]}>{week}</Text>
            {/* The gap is spacing, not content. Two literal spaces inside the
                Text made it part of the string, so it survived selection and
                copy-paste and could not respond to the type scale. */}
            <Text style={[s.phoneRowText, { marginLeft: Space.s2 }]}>{work}</Text>
          </View>
        ))}

        <Text style={s.phoneFootnote}>{'Approved by Asha Sharma\n31 July 2026'}</Text>
      </View>
    </View>
  );
}
