/**
 * The table kit - and the one place the column-width contract lives.
 *
 * Ported from the `.table` / `.tr` / `.th` / `.row-button` markup at
 * frontend/app/ui/FunctionalEduAIApp.tsx:449, the `.resource-table` at :654-660
 * and the `.journey` strip at :473.
 *
 * ---------------------------------------------------------------------------
 * CSS grid, and what replaced it
 * ---------------------------------------------------------------------------
 *
 * `.tr` is `display:grid; grid-template-columns:2fr .8fr 1fr .7fr` (and
 * `1.6fr .7fr .8fr` below 760px). React Native has no grid, so a row is a flex
 * row and each cell is a track whose `flexGrow` carries the `fr` weight -
 * `styles.ts` has already translated the four tracks as `trColumn1`,
 * `trColumn2`, `trCell` and `trColumn4`.
 *
 * The part that does not survive on its own is *alignment across rows*. With
 * grid, the header and every body row share one track definition, so column
 * three lines up whatever is in it. With flex, each row is measured
 * independently, and two rows only line up if they were given the same track
 * weights in the same order.
 *
 * So `Row` and `HeadRow` assign the tracks themselves, by position: the first
 * child gets track 1, the second track 2, and so on, and a row with fewer
 * children simply leaves the later tracks unused - which is exactly what the
 * grid did. Callers pass content, never widths. That is the whole reason this
 * file exists rather than twelve screens each writing `flex: 1`.
 *
 * Two consequences worth knowing:
 *  - a cell's content must not set its own width, or it fights the track;
 *  - `flexBasis: 0` on the tracks means a row never wraps. A row too narrow for
 *    its content scrolls horizontally instead, which is what `Table`'s `scroll`
 *    prop and `.resource-row`'s `min-width` are for.
 */

import { Children, type ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  type StyleProp,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';

import { Grid, layoutFor, useAppStyles, type AppStyles } from '@/shared/theme/styles';

/** The four `.tr` tracks, in order. Index 4 and beyond reuse the last one. */
function trackFor(s: AppStyles, index: number) {
  return [s.trColumn1, s.trColumn2, s.trCell, s.trColumn4][Math.min(index, 3)];
}

/** The four `.resource-row` tracks: `minmax(180px,1.35fr) repeat(3,minmax(140px,1fr))`. */
function resourceTrackFor(s: AppStyles, index: number) {
  return index === 0 ? s.resourceRowTitleCell : s.resourceRowCell;
}

function tracked(
  children: ReactNode,
  track: (index: number) => StyleProp<ViewStyle>,
): ReactNode {
  return Children.map(children, (child, index) =>
    child == null || child === false ? null : <View style={track(index)}>{child}</View>,
  );
}

// ---------------------------------------------------------------------------
// .table
// ---------------------------------------------------------------------------

/**
 * `<div className="table">` - the bordered, clipped container.
 *
 * `scroll` turns it into a horizontal ScrollView with a floor width, for the
 * rows that genuinely cannot fit a phone. The rows inside keep their track
 * weights either way.
 */
export function Table({
  children,
  scroll,
  minWidth = 560,
  style,
  accessibilityLabel,
}: {
  children: ReactNode;
  scroll?: boolean;
  minWidth?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const s = useAppStyles();
  const body = <View style={[s.table, scroll && { minWidth }, style]}>{children}</View>;
  if (!scroll) return body;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel={accessibilityLabel}>
      {body}
    </ScrollView>
  );
}

/** `<div className="tr th">` - the column headings. Children are plain strings. */
export function HeadRow({ children }: { children: ReactNode }) {
  const s = useAppStyles();
  return (
    <View style={[s.tr, s.trHeader]}>
      {Children.map(children, (child, index) => (
        <View style={trackFor(s, index)}>
          {typeof child === 'string' ? <Text style={s.trHeaderText}>{child}</Text> : child}
        </View>
      ))}
    </View>
  );
}

/** `<div className="tr">` - one body row. */
export function Row({
  children,
  last,
  style,
}: {
  children: ReactNode;
  /** `.tr:last-child` - drop the bottom rule. */
  last?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const s = useAppStyles();
  return (
    <View style={[s.tr, last && s.trLast, style]}>{tracked(children, (i) => trackFor(s, i))}</View>
  );
}

/**
 * `<button className="tr row-button">` - a whole row that is one tap target.
 *
 * The web app's `.row-button:hover` becomes the press state as well, because a
 * touch device never hovers.
 */
export function RowButton({
  children,
  onPress,
  last,
  accessibilityLabel,
  disabled,
}: {
  children: ReactNode;
  onPress: () => void;
  last?: boolean;
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  const s = useAppStyles();
  return (
    <Pressable
      role="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed, hovered }) => [
        s.tr,
        s.rowButton,
        last && s.trLast,
        (hovered || pressed) && s.rowButtonHover,
        disabled && s.disabled,
      ]}>
      {tracked(children, (i) => trackFor(s, i))}
    </Pressable>
  );
}

/**
 * The contents of one cell: a value, optionally over a caption.
 *
 * It renders the text, not the track - `Row` and `HeadRow` own the width. That
 * split is deliberate: a caller cannot accidentally give one row a different
 * column layout from the row above it.
 */
export function Cell({
  title,
  caption,
  strong,
  children,
}: {
  title?: string;
  caption?: string;
  /** The `<b>` the first column uses for a title. */
  strong?: boolean;
  children?: ReactNode;
}) {
  const s = useAppStyles();
  return (
    <>
      {title !== undefined ? (
        <Text style={[s.trText, strong && s.resourceRowTitle]} numberOfLines={2}>
          {title}
        </Text>
      ) : null}
      {caption !== undefined ? <Text style={s.trCaption}>{caption}</Text> : null}
      {children}
    </>
  );
}

// ---------------------------------------------------------------------------
// .resource-row
// ---------------------------------------------------------------------------

/**
 * `<div className="resource-row">` - the wider four-column row the Resources
 * screen uses, where every cell holds actions rather than a value.
 *
 * Its own stylesheet gives it a `min-width` below 760px, so it is meant to be
 * rendered inside a horizontal ScrollView on a phone - `<Table scroll>` around
 * it, or the screen's own.
 */
export function ResourceRow({
  children,
  head,
  last,
}: {
  children: ReactNode;
  /** `.resource-row.resource-head` - the heading row. */
  head?: boolean;
  last?: boolean;
}) {
  const s = useAppStyles();
  return (
    <View style={[s.resourceRow, head && s.resourceHead, last && s.resourceRowLast]}>
      {Children.map(children, (child, index) => (
        <View style={resourceTrackFor(s, index)}>
          {head && typeof child === 'string' ? (
            <Text style={s.resourceHeadText}>{child}</Text>
          ) : (
            child
          )}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// .journey
// ---------------------------------------------------------------------------

export type JourneyStep = {
  key: string;
  label: string;
  /** "Complete" or "Open step" in the monolith. */
  caption: string;
  state: 'done' | 'current' | 'todo';
  /** The glyph in the circle: a tick for a finished step, else its number. */
  glyph: string;
  onPress?: () => void;
};

/**
 * `.journey` - the ten-stage workflow strip on an assessment.
 *
 * The CSS gave it three layouts: a five-column grid, a three-column grid below
 * 1050px, and `display:flex; overflow:auto` with 155px-wide steps below 760px.
 * The first two are the same wrapping flex row here (`Grid.columns`), and the
 * third is a real horizontal ScrollView - a wrapping row of ten steps on a
 * phone would be five rows tall.
 */
export function JourneyStrip({ steps }: { steps: JourneyStep[] }) {
  const s = useAppStyles();
  const { width } = useWindowDimensions();
  const size = layoutFor(width);
  const compact = size === 'compact';
  const columns = size === 'wide' ? 5 : 3;

  const items = steps.map((step) => (
    <Pressable
      key={step.key}
      role="button"
      accessibilityLabel={`${step.label}, ${step.caption}`}
      accessibilityState={{ selected: step.state === 'current' }}
      onPress={step.onPress}
      style={[
        s.journeyStep,
        step.state === 'current' && s.journeyStepCurrent,
        compact ? { minWidth: 155 } : Grid.columns(columns),
      ]}>
      <View style={[s.journeyStepIcon, step.state === 'done' && s.journeyStepIconDone]}>
        <Text style={step.state === 'done' ? s.journeyStepIconDoneText : s.journeyStepCaption}>
          {step.glyph}
        </Text>
      </View>
      <View style={{ flexShrink: 1 }}>
        <Text style={s.journeyStepTitle}>{step.label}</Text>
        <Text style={s.journeyStepCaption}>{step.caption}</Text>
      </View>
    </Pressable>
  ));

  if (compact)
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={Grid.row(8)}>
        {items}
      </ScrollView>
    );

  return <View style={Grid.row(8)}>{items}</View>;
}
