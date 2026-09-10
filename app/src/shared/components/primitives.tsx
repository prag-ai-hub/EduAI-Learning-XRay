/**
 * The eight layout atoms the whole workspace is assembled from.
 *
 * Ported one-for-one from frontend/app/ui/FunctionalEduAIApp.tsx:1707-1714,
 * where each was a single line of JSX. They are here rather than in a slice
 * because roughly fifty files render at least one of them, and they are the
 * only thing keeping a page heading on the Students screen identical to the one
 * on Reports.
 *
 * NOTE: this file deliberately does NOT define `Field`. The monolith's
 * line-1711 `Field` was a `<label>` wrapper around a child control; the `Field`
 * this app has lives in `@/shared/components/form` and renders its own
 * `TextInput` with no children. They are different components with the same
 * name - see the mapping in docs/plan/05-SCREEN-PORT-WAVES.md before porting a
 * `<Field>` call site.
 *
 * Every value comes from `@/shared/theme/styles`. Where the web relied on
 * inheritance - a heading taking its colour from the page - the style key is
 * named explicitly, because React Native inherits nothing.
 */

import type { ReactNode } from 'react';
import { type StyleProp, Text, View, type ViewStyle } from 'react-native';

import { Grid, useAppStyles } from '@/shared/theme/styles';

/** `<p className="eyebrow">` - the small capitalised kicker above a heading. */
export function Eyebrow({ children, onNavy }: { children: string; onNavy?: boolean }) {
  const s = useAppStyles();
  return <Text style={[s.eyebrow, onNavy && s.eyebrowOnNavy]}>{children}</Text>;
}

/**
 * `.page-heading` - eyebrow, h1, lead paragraph, and the page's actions.
 *
 * On the web the actions were a `.button-row` beside the text and became a
 * fixed bottom-right FAB below 760px. That `position: fixed` cannot be a child
 * of this row in React Native (see the CAVEATS block in styles.ts), so a
 * compact screen that wants the FAB behaviour renders the button as a sibling
 * of its ScrollView instead. Here the actions simply wrap, which is what the
 * flex row does above 760 anyway.
 */
export function PageHead({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children?: ReactNode;
}) {
  const s = useAppStyles();
  return (
    <View style={s.pageHeading}>
      <View style={{ flexShrink: 1 }}>
        <Text style={s.eyebrow}>{eyebrow}</Text>
        <Text accessibilityRole="header" style={s.pageHeadingTitle}>
          {title}
        </Text>
        <Text style={s.pageHeadingLead}>{subtitle}</Text>
      </View>
      <View style={s.buttonRow}>{children}</View>
    </View>
  );
}

/**
 * The heading every dialog opens with. A fragment on the web, so it stays one
 * here - the modal shell owns the padding around it.
 */
export function DialogHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  const s = useAppStyles();
  return (
    <>
      <Text style={s.eyebrow}>{eyebrow}</Text>
      <Text accessibilityRole="header" style={s.modalTitle}>
        {title}
      </Text>
    </>
  );
}

/** `.card-head` - a card's eyebrow and title, with optional actions to the right. */
export function CardHead({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  const s = useAppStyles();
  return (
    <View style={s.cardHead}>
      <View style={{ flexShrink: 1 }}>
        <Text style={s.eyebrow}>{eyebrow}</Text>
        <Text accessibilityRole="header" style={s.cardTitle}>
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

/** `<section className="card">`. */
export function Card({
  children,
  style,
  selected,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** `.selected-card` - the navy focus ring on the chosen assessment. */
  selected?: boolean;
}) {
  const s = useAppStyles();
  return <View style={[s.card, selected && s.selectedCard, style]}>{children}</View>;
}

/**
 * `<section className="card span-2">`.
 *
 * `grid-column: span 2` inside `.dashboard-grid`. There is no grid here, so the
 * card takes the full width of the wrapping flex row - which is what `span 2`
 * produced in a two-column grid, and what the CSS itself falls back to below
 * 1050px (`.span-2{grid-column:auto}`).
 */
export function CardSpan2({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <Card style={[Grid.span, style]}>{children}</Card>;
}

/** `<article className="metric">` - a labelled figure with a caption. */
export function Metric({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  /** A string or number is wrapped for you; anything else is rendered as given. */
  value: ReactNode;
  note: string;
  /** `.metric.navy` and friends - a coloured top rule. Unused in the monolith. */
  tone?: 'navy' | 'orange' | 'red' | 'green';
}) {
  const s = useAppStyles();
  const rule =
    tone === 'navy'
      ? s.metricNavy
      : tone === 'orange'
        ? s.metricOrange
        : tone === 'red'
          ? s.metricRed
          : tone === 'green'
            ? s.metricGreen
            : null;
  return (
    <View style={[s.metric, rule]}>
      <Text style={s.metricLabel}>{label}</Text>
      {typeof value === 'string' || typeof value === 'number' ? (
        <Text style={s.metricValue}>{value}</Text>
      ) : (
        value
      )}
      <Text style={s.metricCaption}>{note}</Text>
    </View>
  );
}

/**
 * `.bar` - a labelled mastery bar.
 *
 * The fill was a left-to-right navy gradient. React Native has no gradient
 * without a native module, so `barFill` is the solid navy the gradient starts
 * from; the percentage, not the shading, is what the bar is read for.
 */
export function Bar({ label, pct }: { label: string; pct: number }) {
  const s = useAppStyles();
  const safe = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={`${label}, ${safe}%`}>
      <View style={s.barHead}>
        <Text style={s.barLabel}>{label}</Text>
        <Text style={s.barValue}>{pct}%</Text>
      </View>
      <View style={s.barTrack}>
        <View style={[s.barFill, { width: `${safe}%` }]} />
      </View>
    </View>
  );
}

/** `.progress` - the upload/processing bar, with its percentage over the fill. */
export function Progress({ value }: { value: number }) {
  const s = useAppStyles();
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <View
      style={s.progress}
      accessibilityRole="progressbar"
      accessibilityLabel={`${value}% complete`}>
      <View style={[s.progressFill, { width: `${safe}%` }]} />
      <Text style={s.progressLabel}>{value}%</Text>
    </View>
  );
}
