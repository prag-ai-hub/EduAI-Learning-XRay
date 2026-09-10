/**
 * The teacher's Settings module - six cards, each opening one settings dialog.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `SettingsView` (~683).
 *
 * The web rendered `.settings-grid > button`, whose CSS is shared with
 * `.achievement-grid > button`; `styles.ts` carries it once as `settingsCard`,
 * so Achievements and Settings still look identical, as they did.
 */

import { Pressable, Text, View } from 'react-native';

import { PageHead } from '@/shared/components/primitives';
import { useAppStyles } from '@/shared/theme/styles';
import type { DialogName, W } from '@/shared/types/workspace';

/** title, caption, dialog. Typed rather than `string[][]` so a typo fails here. */
const ITEMS: readonly (readonly [string, string, DialogName])[] = [
  ['Profile & onboarding', 'Personal, teaching and school details', 'profile'],
  [
    'Grading preferences',
    'Strictness, partial credit, spelling and units',
    'grading-settings',
  ],
  [
    'Appearance & accessibility',
    'Theme, contrast, text and reduced motion',
    'appearance-settings',
  ],
  [
    'Notifications',
    'Processing, intervention and follow-up reminders',
    'notification-settings',
  ],
  [
    'Privacy & consent',
    'Terms, AI disclosure and product-improvement consent',
    'consent-settings',
  ],
  ['Sessions & security', 'Login history and log out all devices', 'security-settings'],
];

export function SettingsView({ open }: W<'open'>) {
  const s = useAppStyles();
  return (
    <>
      <PageHead
        eyebrow="Teacher preferences"
        title="Settings"
        subtitle="Control grading, notifications, accessibility, privacy and account security."
      />
      <View style={s.settingsGrid}>
        {ITEMS.map(([title, caption, dialog]) => (
          <Pressable
            key={title}
            role="button"
            accessibilityLabel={`${title}. ${caption}`}
            onPress={() => open(dialog)}
            style={({ hovered, pressed }) => [
              s.settingsCard,
              s.settingsTrack,
              (hovered || pressed) && s.settingsCardHover,
            ]}>
            <Text style={s.settingsCardTitle}>{title}</Text>
            <Text style={s.settingsCardCaption}>{caption}</Text>
            <Text style={s.settingsCardAction}>Manage →</Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}
