/**
 * The button kit.
 *
 * `className="primary"`, `"secondary"`, `"link"`, `"primary full"` and
 * `"link danger"` appear on nearly every one of the ~60 components being
 * ported. On the web those are cascading classes on a `<button>`; React Native
 * has neither a cascade nor a `<button>`, so the variants live here and every
 * screen composes them by prop instead of by string.
 *
 * Ported from the `.primary` / `.secondary` / `.link` / `.button-row` /
 * `.danger` rules in frontend/app/globals.css and their call sites in
 * frontend/app/ui/FunctionalEduAIApp.tsx.
 *
 * Styling is `@/shared/theme/styles` only. The one thing this file decides for
 * itself is the *press* state: the CSS hover rules have no touch equivalent, so
 * `primaryHover` doubles as the pressed style, which is the convention
 * `form.tsx`'s `SubmitButton` already set.
 */

import type { ReactNode } from 'react';
import { Pressable, type StyleProp, Text, type TextStyle, View, type ViewStyle } from 'react-native';

import { useAppStyles } from '@/shared/theme/styles';

/**
 * `danger` is a variant here and a modifier in the CSS (`.danger{color:#a02b24}`
 * layered over another class). Three call sites use it: two are `link danger`,
 * which is what the variant means, and one is `primary full danger`, which is
 * what the `danger` *prop* is for. Both spellings are supported so no call site
 * has to be reworded.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'link' | 'danger';

export type AppButtonProps = {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  /** `.full` - full width, with the CSS's 18px top margin. */
  full?: boolean;
  disabled?: boolean;
  /** Tint the label red on top of any variant - `.primary.full.danger`. */
  danger?: boolean;
  /** A leading glyph, as in `＋ Create class`. Kept out of the label so it is not read aloud. */
  icon?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

export function AppButton({
  title,
  onPress,
  variant = 'secondary',
  full,
  disabled,
  danger,
  icon,
  accessibilityLabel,
  style,
  textStyle,
}: AppButtonProps) {
  const s = useAppStyles();
  const linkish = variant === 'link' || variant === 'danger';
  const base = variant === 'primary' ? s.primary : linkish ? s.link : s.secondary;
  const label = variant === 'primary' ? s.primaryText : linkish ? s.linkText : s.secondaryText;
  const red = danger || variant === 'danger';

  return (
    <Pressable
      role="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed, hovered }) => [
        base,
        full && s.full,
        (hovered || pressed) && variant === 'primary' && s.primaryHover,
        // The stylesheet has no `.secondary:hover`. This is deliberate touch
        // feedback, not a ported rule: a Pressable with no visible reaction
        // reads as broken on a device, where there is no cursor to show that
        // something is pressable. Named here so it is not mistaken for the
        // visual language having been altered.
        (hovered || pressed) && variant === 'secondary' && s.rowButtonHover,
        // `.primary:disabled{opacity:.5}` is the only disabled rule the
        // stylesheet carries; applying it to every variant dimmed link and
        // danger buttons the web never dimmed.
        disabled && variant === 'primary' && s.primaryDisabled,
        style,
      ]}>
      {icon ? (
        <Text style={[label, red && s.danger]} accessibilityElementsHidden>
          {icon}
        </Text>
      ) : null}
      <Text style={[label, red && s.danger, textStyle]}>{title}</Text>
    </Pressable>
  );
}

/**
 * `.button-row` - the wrapping flex row that holds a card's or a dialog's
 * actions. `end` is `justify-content:flex-end`, which the dialog footers use.
 */
export function ButtonRow({
  children,
  end,
  style,
}: {
  children: ReactNode;
  end?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const s = useAppStyles();
  return <View style={[s.buttonRow, end && s.buttonRowEnd, style]}>{children}</View>;
}

/**
 * `<button className="link">` - the borderless text action used inside table
 * rows and card heads. A thin wrapper rather than a prop on `AppButton` because
 * roughly forty call sites read `<LinkButton title="Download report" …/>`, and
 * that is the shape they read as on the web too.
 */
export function LinkButton({
  title,
  onPress,
  disabled,
  danger,
  accessibilityLabel,
  style,
  textStyle,
}: Omit<AppButtonProps, 'variant' | 'full' | 'icon'>) {
  return (
    <AppButton
      variant="link"
      title={title}
      onPress={onPress}
      disabled={disabled}
      danger={danger}
      accessibilityLabel={accessibilityLabel}
      style={style}
      textStyle={textStyle}
    />
  );
}

/**
 * A top-bar icon button - the ☀/☾ appearance toggle and the ♢ notifications
 * bell, which carries an unread count.
 *
 * The glyph is the content, so the label has to be spelled out: `aria-label` on
 * the web, `accessibilityLabel` here. The badge is `.top-actions em`, absolutely
 * positioned at the corner exactly as the CSS put it.
 */
export function IconButton({
  glyph,
  onPress,
  accessibilityLabel,
  badge,
  style,
}: {
  glyph: string;
  onPress?: () => void;
  accessibilityLabel: string;
  /** Omitted or 0 renders nothing, matching `{count > 0 && <em>…</em>}`. */
  badge?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const s = useAppStyles();
  return (
    <Pressable
      role="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed, hovered }) => [s.topActionButton, (hovered || pressed) && s.rowButtonHover, style]}>
      <Text style={s.secondaryText}>{glyph}</Text>
      {badge ? (
        <View style={[s.topActionBadge, s.navBadge]}>
          <Text style={s.navBadgeText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
