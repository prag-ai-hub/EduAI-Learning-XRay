/**
 * Everything that tells the user where something stands.
 *
 * Ported from the `.status`, `.toast`, `.sync-indicator`, `.credit-badge`,
 * `.demo-role-badge`, `.filters` and `.empty-state` markup in
 * frontend/app/ui/FunctionalEduAIApp.tsx (the top bar at :350-357, the filter
 * rows at :458, :613 and :845, and the pills scattered through the tables).
 *
 * `SCHOOL_STATUS_TONE` lives here and only here. The school directory renders
 * it onto the same `.status` pill as every other screen, so it belongs to the
 * pill, not to the directory.
 */

import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, type StyleProp, Text, View, type ViewStyle } from 'react-native';

import { FontSize, useAppPalette, useAppStyles } from '@/shared/theme/styles';
import type { ToastKind } from '@/shared/types/workspace';

// ---------------------------------------------------------------------------
// The pill
// ---------------------------------------------------------------------------

/**
 * Every `.status` modifier in the stylesheet.
 *
 * The first three are the semantic set the app uses; the four colour names are
 * the performance-matrix bands, which name a band rather than a meaning and are
 * kept as their own values so the matrix does not have to translate twice.
 */
export type StatusTone =
  | 'success'
  | 'warning'
  | 'neutral'
  | 'green'
  | 'yellow'
  | 'orange'
  | 'red';

/**
 * School lifecycle status to pill tone.
 *
 * Suspended is a warning rather than an error on purpose: it is reversible, and
 * the directory offers "Reactivate" right beside it. Closed is neutral because
 * nothing is left to act on.
 */
export const SCHOOL_STATUS_TONE: Record<string, StatusTone> = {
  Active: 'success',
  Pending: 'warning',
  Suspended: 'warning',
  Closed: 'neutral',
};

/** `<span className="status success">Version 3</span>`. */
export function StatusPill({
  children,
  tone,
  style,
}: {
  children: string;
  /** Omitted is the bare `.status` - surface2 on muted, as the CSS had it. */
  tone?: StatusTone;
  style?: StyleProp<ViewStyle>;
}) {
  const s = useAppStyles();
  const box =
    tone === 'success'
      ? s.statusSuccess
      : tone === 'warning'
        ? s.statusWarning
        : tone === 'neutral'
          ? s.statusNeutral
          : tone === 'green'
            ? s.statusGreen
            : tone === 'yellow'
              ? s.statusYellow
              : tone === 'orange'
                ? s.statusOrange
                : tone === 'red'
                  ? s.statusRed
                  : null;
  const text =
    tone === 'success'
      ? s.statusSuccessText
      : tone === 'warning'
        ? s.statusWarningText
        : tone === 'neutral'
          ? s.statusNeutralText
          : tone === 'green'
            ? s.statusGreenText
            : tone === 'yellow'
              ? s.statusYellowText
              : tone === 'orange'
                ? s.statusOrangeText
                : tone === 'red'
                  ? s.statusRedText
                  : null;
  return (
    <View style={[s.status, box, style]}>
      <Text style={[s.statusText, text]}>{children}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// The toast
// ---------------------------------------------------------------------------

/**
 * `.toast` - the shell's single notification, bottom-right on a desktop and
 * full-width above the mobile nav on a phone.
 *
 * It is absolutely positioned inside the app shell's root view (RN has no
 * `position: fixed`), so it must be rendered as the shell's last child, after
 * the content, or the content will paint over it.
 *
 * The leading glyph is `✓` for anything that is not an error, which is what the
 * web app did - a warning toast still reads as something that happened.
 */
export function Toast({ text, kind }: { text: string; kind: ToastKind }) {
  const s = useAppStyles();
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[s.toast, kind === 'warning' && s.toastWarning, kind === 'error' && s.toastError]}>
      <Text style={[s.toastText, s.toastHighlight]}>{kind === 'error' ? '!' : '✓'}</Text>
      <Text style={[s.toastText, { flexShrink: 1 }]}>{text}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// The top bar's three read-outs
// ---------------------------------------------------------------------------

export type SyncStatus = 'Loading' | 'Syncing' | 'Synced' | 'Offline' | 'Conflict';

/**
 * `.sync-indicator` - whether the workspace has reached the server.
 *
 * "Conflict" is the only state that is interactive: another device saved a
 * newer revision, and the only safe recovery is to reload. On the web that was
 * `location.reload()`; there is no such thing on a phone, so the caller is
 * handed `onReload` and decides - a web build reloads, a native build re-runs
 * the bootstrap fetch.
 */
export function SyncIndicator({
  status,
  onReload,
}: {
  status: SyncStatus;
  onReload?: () => void;
}) {
  const s = useAppStyles();
  const label =
    status === 'Synced'
      ? '● Cloud synced'
      : status === 'Syncing'
        ? '◌ Saving…'
        : status === 'Offline'
          ? '○ Offline · queued'
          : status === 'Conflict'
            ? '⚠ Changed elsewhere · reload'
            : '◌ Loading…';
  const tint =
    status === 'Synced'
      ? s.syncIndicatorSynced
      // Conflict deliberately absent: the stylesheet defines `.synced` and
      // `.offline` only, so Conflict keeps the container's muted colour and
      // says what it needs to in words. Tinting it orange made it read as a
      // degraded connection, which is the opposite of what it means - the work
      // is at risk, not merely unsent.
      : status === 'Offline'
        ? s.syncIndicatorOffline
        : null;

  if (status === 'Conflict')
    return (
      <Pressable
        role="button"
        accessibilityLabel="This workspace was changed on another device. Reload to continue from the latest version."
        onPress={onReload}>
        <Text style={[s.syncIndicator, tint]}>{label}</Text>
      </Pressable>
    );

  return <Text style={[s.syncIndicator, tint]}>{label}</Text>;
}

/**
 * `<span className="credit-badge">` - the remaining AI credits.
 *
 * That class has no rule anywhere in globals.css: on the web the badge simply
 * inherited the top bar's text. Nothing is inherited in React Native, so the
 * two values are stated here from tokens. This is the only style in the file
 * that does not come from a `styles.ts` key, and it is stated rather than
 * invented - it is what the browser rendered.
 */
export function CreditBadge({ total, used, remaining }: { total: number; used: number; remaining: number }) {
  const p = useAppPalette();
  return (
    <Text
      accessibilityLabel={`${used} of ${total} credits used`}
      style={{ color: p.text, fontSize: FontSize.f12 }}>
      Credits Remaining: {remaining}
    </Text>
  );
}

/** `.demo-role-badge` - the signed-in role, hidden below 560px by the stylesheet. */
export function RoleBadge({ label }: { label: string }) {
  const s = useAppStyles();
  return (
    <View style={s.demoRoleBadge}>
      <Text style={s.demoRoleBadgeText}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Filters and emptiness
// ---------------------------------------------------------------------------

/**
 * `.filters` - the single-select chip row above a list.
 *
 * `overflow: auto` on the CSS row becomes a horizontal ScrollView, so a long
 * set of chips scrolls instead of wrapping and pushing the list down.
 */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
  accessibilityLabel?: string;
}) {
  const s = useAppStyles();
  const press = useCallback((next: T) => () => onChange(next), [onChange]);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={accessibilityLabel}
      contentContainerStyle={s.filters}>
      {options.map((item) => (
        <Pressable
          key={item}
          role="tab"
          accessibilityState={{ selected: item === value }}
          onPress={press(item)}
          style={[s.filterChip, item === value && s.filterChipActive]}>
          <Text style={[s.filterChipText, item === value && s.filterChipTextActive]}>{item}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

/** `.empty-state` - the centred "nothing here yet, and here is why" panel. */
export function EmptyState({
  title,
  body,
  children,
}: {
  title: string;
  body?: string;
  /** An action inside the panel. Two of the source's empty states carry one -
   *  "Browse files" and its sibling - and without a slot for them wave 3 would
   *  have to either edit this shared component or inline a second panel. */
  children?: ReactNode;
}) {
  const s = useAppStyles();
  return (
    <View style={s.emptyState}>
      <Text style={s.emptyStateTitle}>{title}</Text>
      {body ? <Text style={s.emptyStateBody}>{body}</Text> : null}
      {children}
    </View>
  );
}
