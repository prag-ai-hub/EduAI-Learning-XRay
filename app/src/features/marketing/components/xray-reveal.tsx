/**
 * The hero illustration: one answer script, revealed as concept-level evidence
 * by dragging across it.
 *
 * Ported from `XrayReveal` in frontend/app/ui/MarketingHome.tsx.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE - the two web constructs that do not exist here
 * ---------------------------------------------------------------------------
 * 1. `clip-path: inset(0 0 0 <value>%)` hid the left part of the navy scan
 *    layer. React Native has no clip-path. The substitute is the standard one:
 *    a positioned wrapper with `overflow: hidden` that starts at the reveal
 *    line, holding a child shifted back by the same amount and given the full
 *    measured width. The child therefore paints at exactly the coordinates it
 *    would have had unclipped, so the four concept tags stay pinned to the same
 *    words as the reveal moves - which a percentage-width overlay would not do.
 *
 * 2. `<input type="range">` has no equivalent either, and
 *    @react-native-community/slider is not a dependency. The illustration is its
 *    own touch responder instead: a press moves the line to that point and a
 *    drag follows the finger, which is how the range track behaved. Every layer
 *    inside is `pointerEvents="none"` so the coordinate is always measured
 *    against the one responder view and never against whichever `Text` was hit.
 *    The control is exposed to assistive technology as an `adjustable`, so the
 *    increment and decrement gestures still work without a visible track.
 *
 * The layout, the colours and the rotations all come from the existing
 * stylesheet; nothing here is restyled.
 */

import { useCallback, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';

import { useAppStyles } from '@/shared/theme/styles';

/** The range the web input allowed. Outside it the tags fall off the paper. */
const MIN = 18;
const MAX = 82;
/** How far one assistive increment moves the line; the web input stepped by 1. */
const STEP = 4;

/** The four findings, at the position on the script each one refers to. */
const TAGS: readonly { label: string; top: `${number}%`; left: `${number}%`; gap: boolean }[] = [
  { label: 'Mole ratio · gap', top: '26%', left: '54%', gap: true },
  { label: 'Balancing · secure', top: '44%', left: '59%', gap: false },
  { label: 'Limiting reagent · gap', top: '61%', left: '47%', gap: true },
  { label: 'Unit conversion · secure', top: '76%', left: '61%', gap: false },
];

const LABEL = 'The same answer script shown first as one mark, then as concept-level evidence';

function clamp(value: number): number {
  return Math.min(MAX, Math.max(MIN, value));
}

export type XrayRevealProps = {
  /** Omit to let the component hold its own position, as a static page would. */
  value?: number;
  setValue?: (next: number) => void;
};

/**
 * `pointerEvents` as a STYLE, not a prop.
 *
 * React Native deprecated the prop form; it still works and warns, and these
 * four were the only console warnings the app produced. The behaviour is not a
 * detail here: every layer over the strip has to be transparent to touch, or
 * the drag that moves the reveal line gets captured by whatever the finger
 * lands on.
 */
const NO_TOUCH = { pointerEvents: 'none' } as const;

export function XrayReveal({ value, setValue }: XrayRevealProps) {
  const s = useAppStyles();
  const [internal, setInternal] = useState(52);
  const current = value ?? internal;
  const [width, setWidth] = useState(0);

  const commit = useCallback(
    (next: number) => {
      if (value === undefined) setInternal(next);
      setValue?.(next);
    },
    [value, setValue],
  );

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  }, []);

  /** The reveal line follows the touch directly, as dragging a range track does. */
  const moveTo = useCallback(
    (event: GestureResponderEvent) => {
      if (!width) return;
      commit(clamp((event.nativeEvent.locationX / width) * 100));
    },
    [width, commit],
  );

  const line = (width * current) / 100;

  return (
    <View
      style={s.xrayReveal}
      accessibilityLabel={LABEL}
      accessibilityRole="adjustable"
      accessibilityValue={{ min: MIN, max: MAX, now: Math.round(current) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'increment') commit(clamp(current + STEP));
        if (event.nativeEvent.actionName === 'decrement') commit(clamp(current - STEP));
      }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={moveTo}
      onResponderMove={moveTo}>
      {/* Everything lives one level in, filling the content box. `.xray-reveal`
          has a 13px border, so a touch coordinate taken on the outer view would
          be measured against the border box while its absolutely positioned
          children sit inside the content box - the reveal line would then sit a
          couple of per cent away from the finger. */}
      <View style={StyleSheet.absoluteFill} onLayout={onLayout}>
        <View style={[s.answerScript, NO_TOUCH]}>
          <View style={s.paperTop}>
            <Text style={[s.answerScriptText, BOLD]}>Class 9 · Science</Text>
            <Text style={s.paperStamp}>62/100</Text>
          </View>
          <Text style={s.answerScriptText}>
            Q4. Calculate the limiting reagent and show the mole ratio.
          </Text>
          <Text style={[s.answerScriptText, ITALIC]}>2H₂ + O₂ → 2H₂O</Text>
          <Text style={s.handwriting}>The ratio is 2:1. Oxygen will finish first because...</Text>
          <Text style={s.answerScriptText}>Q5. Balance the equation and include units.</Text>
          <Text style={[s.answerScriptText, ITALIC]}>Fe + O₂ → Fe₂O₃</Text>
          <Text style={s.handwriting}>4Fe + 3O₂ → 2Fe₂O₃</Text>
        </View>

        {/* The clip-path replacement: the window, and the full-width layer
            inside it shifted back so its children keep their positions. */}
        <View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: line,
            width: Math.max(0, width - line),
            overflow: 'hidden',
          }}
          >
          <View style={[s.scanSide, { left: -line, right: undefined, width }]}>
            {TAGS.map((tag) => (
              <View
                key={tag.label}
                style={[s.tag, tag.gap ? s.gapTag : s.secureTag, { top: tag.top, left: tag.left }]}>
                <Text style={[s.tagText, tag.gap ? s.gapTagText : s.secureTagText]}>
                  {tag.label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={[s.scanLine, { left: line }, NO_TOUCH]} />
        <View style={[s.sliderHandle, { left: line }, NO_TOUCH]}>
          <Text style={s.sliderHandleText}>↔</Text>
        </View>
      </View>
    </View>
  );
}

/** `.paper-top b` and the two `<em>` equations - the only inline type changes. */
const BOLD = { fontWeight: '700' } as const;
const ITALIC = { fontStyle: 'italic' } as const;
