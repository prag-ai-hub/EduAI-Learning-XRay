/**
 * The two sharing dialogs: a leadership link, and the report generator.
 *
 * Ported from `ShareDialog` and `ReportDialog` in
 * frontend/app/ui/FunctionalEduAIApp.tsx. Both are rendered inside the dialog
 * registry's modal shell, so each returns the modal's contents and nothing
 * around them - exactly as the web ones did.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE - copying the link
 * ---------------------------------------------------------------------------
 * The web called `navigator.clipboard.writeText`. React Native has no clipboard
 * without `expo-clipboard`, which is not a dependency of this app, so the
 * button branches: the browser's own clipboard on web, and the platform share
 * sheet on a device, which is how a link leaves an app there. The link itself
 * is `selectable` in both, so it can always be copied by hand.
 */

import { useState } from 'react';
import { Platform, Pressable, Share, Text, View } from 'react-native';

import { AppButton } from '@/shared/components/buttons';
import { Checkbox, Form, FormGrid, Select, SubmitButton } from '@/shared/components/form';
import { DialogHead } from '@/shared/components/primitives';
import { useAppStyles } from '@/shared/theme/styles';
import type { W } from '@/shared/types/workspace';

/** Unambiguous characters only - no O/0, no I/1 - because the code is read aloud. */
const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newLink(): string {
  const token = Array.from(
    { length: 8 },
    () => TOKEN_ALPHABET[Math.floor(Math.random() * TOKEN_ALPHABET.length)],
  ).join('');
  return `eduai.demo/report/${token.slice(0, 4)}-${token.slice(4)}`;
}

export function ShareDialog({ done }: W<'done'>) {
  const s = useAppStyles();
  const [link, setLink] = useState('');
  const created = Boolean(link);

  const copy = async () => {
    if (Platform.OS === 'web') {
      await navigator.clipboard?.writeText(link);
      return;
    }
    await Share.share({ message: link });
  };

  return (
    <>
      <DialogHead eyebrow="Secure sharing" title="Leadership link" />
      {/* No `name` on any control: this dialog has no <Form>, exactly as the
          web one had no <form>, and a named field outside a form would warn. */}
      <Select label="Expires" options={['7 days', '30 days']} />
      <Checkbox label="Require one-time code" defaultChecked />
      <Checkbox label="Allow download" />
      {created ? (
        <View style={s.secureLink}>
          <Text selectable style={s.secureLinkCode}>
            {link}
          </Text>
          <Pressable
            role="button"
            accessibilityLabel="Copy the secure link"
            onPress={() => void copy()}
            style={s.secureLinkButton}>
            <Text style={s.secureLinkButtonText}>Copy</Text>
          </Pressable>
        </View>
      ) : null}
      <AppButton
        variant="primary"
        full
        title={created ? 'Done' : 'Create secure link'}
        onPress={() => (created ? done() : setLink(newLink()))}
      />
    </>
  );
}

export function ReportDialog({ done }: W<'done'>) {
  return (
    <Form onSubmit={done}>
      <DialogHead eyebrow="Interactive reports" title="Generate report" />
      <Select
        label="Report type"
        options={[
          'Student performance',
          'Performance matrix report',
          'Concept mastery',
          'Learning gaps',
          'Teacher summary',
          'School dashboard',
        ]}
      />
      <FormGrid>
        <Select label="Period" options={['Current month', 'Current term', 'Custom period']} />
        <Select label="Scope" options={['Class 6 · Mathematics', 'All classes', 'School-wide']} />
      </FormGrid>
      <Checkbox label="Include methodology and limitations" defaultChecked />
      <Checkbox label="Aggregate student data" defaultChecked />
      <SubmitButton title="Generate report" />
    </Form>
  );
}
