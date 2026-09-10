/**
 * The four shell dialogs that report on the workspace itself: what happened,
 * what is unread, what was consented to, and where the account is signed in.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `Activity` (~1584),
 * `NotificationDialog` (~1585), `ConsentDialog` (~1681) and `SecurityDialog`
 * (~1682).
 *
 * They live in the workspace slice rather than the teacher one because the
 * shell opens them for every role - the sidebar's "Activity & audit" button,
 * the top bar's bell, and two of the Settings cards.
 *
 * `Activity` takes `events` as its own prop rather than reading `state`,
 * exactly as the registry passed it: the audit list is the only thing it shows,
 * and handing it the whole workspace would re-render the dialog on every
 * unrelated keystroke.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE
 * ---------------------------------------------------------------------------
 * `ConsentDialog` was a `<form>` whose three required checkboxes had to be
 * ticked before the browser would submit. `Checkbox required` in
 * `@/shared/components/form` reproduces that: the form refuses to submit and
 * names the box, rather than a browser bubble doing it.
 *
 * `SecurityDialog` is not a form on the web either - both its buttons act
 * immediately - so it stays a plain panel here.
 */

import { Text, View } from 'react-native';

import { AppButton, ButtonRow } from '@/shared/components/buttons';
import { Checkbox, Form, SubmitButton } from '@/shared/components/form';
import { DialogHead } from '@/shared/components/primitives';
import { StatusPill } from '@/shared/components/status';
import { useAppStyles } from '@/shared/theme/styles';
import type { W } from '@/shared/types/workspace';

export function Activity({
  events,
  resetDemo,
  close,
}: W<'resetDemo' | 'close'> & { events: string[] }) {
  const s = useAppStyles();
  return (
    <>
      <DialogHead eyebrow="Audit trail" title="Recent activity" />
      <View style={s.activityList}>
        {events.map((entry, index) => (
          // The web keyed on the index too: entries are prose, not rows, and two
          // identical lines a second apart are both real.
          <View key={`${entry}-${index}`} style={s.activityRow}>
            <Text style={s.activityIcon}>✓</Text>
            <Text style={[s.activityText, { flexShrink: 1 }]}>{entry}</Text>
          </View>
        ))}
      </View>
      <ButtonRow>
        <AppButton
          title="Restore sample data"
          onPress={() => {
            resetDemo();
            close();
          }}
        />
        <AppButton variant="primary" title="Done" onPress={close} />
      </ButtonRow>
    </>
  );
}

export function NotificationDialog({ state, done }: W<'state' | 'done'>) {
  const s = useAppStyles();
  const recent: string[] = (state.events || []).slice(0, 5);
  return (
    <>
      <DialogHead eyebrow="Notifications" title="Your updates" />
      {!recent.length ? <Text style={s.modalCopy}>No recent activity yet.</Text> : null}
      {recent.map((entry, index) => (
        <View key={`${entry}-${index}`} style={s.notification}>
          <Text style={s.activityText}>{entry}</Text>
        </View>
      ))}
      <AppButton variant="primary" full title="Mark all as read" onPress={done} />
    </>
  );
}

export function ConsentDialog({ done }: W<'done'>) {
  return (
    <Form onSubmit={() => done()}>
      <DialogHead eyebrow="Privacy & consent" title="Data-processing choices" />
      <Checkbox label="I accept the terms and privacy policy" required defaultChecked />
      <Checkbox
        label="I am authorised to upload school and student data"
        required
        defaultChecked
      />
      <Checkbox
        label="I understand AI-assisted processing and teacher approval"
        required
        defaultChecked
      />
      <Checkbox label="Allow anonymised product improvement" />
      <SubmitButton title="Save consent choices" />
    </Form>
  );
}

export function SecurityDialog({ done }: W<'done'>) {
  const s = useAppStyles();
  return (
    <>
      <DialogHead eyebrow="Sessions & security" title="Account protection" />
      <View style={s.listItem}>
        <View style={s.listItemBody}>
          <Text style={s.listItemText}>Windows · Chrome</Text>
          <Text style={s.listItemCaption}>Current session · Mumbai</Text>
        </View>
        <StatusPill tone="success">Active</StatusPill>
      </View>
      <View style={s.listItem}>
        <View style={s.listItemBody}>
          <Text style={s.listItemText}>Android · Chrome</Text>
          <Text style={s.listItemCaption}>Last active 2 days ago</Text>
        </View>
        <AppButton title="Revoke" onPress={done} />
      </View>
      <Checkbox label="Require MFA for administrator actions" />
      <AppButton variant="secondary" full title="Log out all other devices" onPress={done} />
    </>
  );
}
