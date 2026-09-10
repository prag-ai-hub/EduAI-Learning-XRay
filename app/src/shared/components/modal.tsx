/**
 * The dialog shell every modal in the app sits in, and the two dialogs that are
 * generic enough to live beside it.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx:890 (`AppDialog`'s wrapper),
 * 1705 (`ConfirmDialog`) and 1583 (`SimpleSettings`).
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE
 * ---------------------------------------------------------------------------
 * The web was `.modal-backdrop > .modal.functional-modal` - a fixed overlay with
 * `onMouseDown` on the backdrop closing only when the press landed on the
 * backdrop itself. React Native has no `position: fixed` and no event bubbling
 * to test a target against, so:
 *
 *  * On native the overlay is RN's `Modal`, which is the only construct that
 *    escapes the parent view hierarchy and gets the Android back button
 *    (`onRequestClose`) for free.
 *  * On web `Modal` from react-native-web renders an extra document-level
 *    subtree and loses the page's scroll position, so the overlay is an
 *    absolutely positioned sibling instead - which is what the CSS was.
 *
 * "Press the backdrop, not the panel" is enforced structurally rather than by
 * comparing targets: the panel claims the touch responder, so a press on it
 * never reaches the backdrop's `Pressable`.
 */

import type { ReactNode } from 'react';
import { Modal as RNModal, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { AppButton } from '@/shared/components/buttons';
import { Field, Form, Select, SubmitButton } from '@/shared/components/form';
import { DialogHead } from '@/shared/components/primitives';
import { useAppStyles } from '@/shared/theme/styles';

export type ModalShellProps = {
  /** `aria-label` on the web dialog - what a screen reader announces. */
  label: string;
  onClose: () => void;
  children: ReactNode;
  /** Native only; the web overlay is rendered conditionally by its parent. */
  visible?: boolean;
};

export function ModalShell({ label, onClose, children, visible = true }: ModalShellProps) {
  const s = useAppStyles();

  const overlay = (
    <Pressable
      style={s.modalBackdrop}
      onPress={onClose}
      accessible={false}
      // The backdrop is a dismiss affordance, not a control; naming it would
      // put a second "button" in the reading order in front of the dialog.
      importantForAccessibility="no">
      <View
        style={[s.modal, s.functionalModal]}
        accessibilityViewIsModal
        accessibilityLabel={label}
        role="dialog"
        // Claims the responder so a press inside the panel never reaches the
        // backdrop. This is the RN equivalent of `e.target === e.currentTarget`.
        onStartShouldSetResponder={() => true}>
        <Pressable
          style={s.modalClose}
          onPress={onClose}
          role="button"
          accessibilityLabel="Close">
          <Text style={s.modalCloseText}>×</Text>
        </Pressable>
        <ScrollView showsVerticalScrollIndicator={false}>{children}</ScrollView>
      </View>
    </Pressable>
  );

  if (Platform.OS === 'web') return visible ? overlay : null;

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent>
      {overlay}
    </RNModal>
  );
}

/**
 * The one-question dialog: a heading, a sentence, one button.
 *
 * Eight of the shell's dialogs are nothing but this - approval, publish, the
 * password reset, the two workflow explainers - so it carries no form and no
 * state of its own.
 */
export function ConfirmDialog({
  eyebrow,
  title,
  text,
  action,
  onConfirm,
}: {
  eyebrow: string;
  title: string;
  text: string;
  action: string;
  onConfirm: () => void;
}) {
  const s = useAppStyles();
  return (
    <>
      <DialogHead eyebrow={eyebrow} title={title} />
      <Text style={s.modalCopy}>{text}</Text>
      <AppButton title={action} variant="primary" full onPress={onConfirm} />
    </>
  );
}

/**
 * The settings dialog eleven of the shell's screens share.
 *
 * The field shapes are positional in the original and stay positional here: the
 * second field is always a three-way enabled/disabled/approval select, the
 * first defaults to "Current configuration" and the rest to "School default".
 * It is a demonstration surface - none of it is persisted - and inventing a
 * schema for it now would be inventing product, not porting it.
 */
export function SimpleSettings({
  title,
  fields,
  done,
}: {
  title: string;
  fields: string[];
  done: () => void;
}) {
  return (
    <Form onSubmit={() => done()}>
      <DialogHead eyebrow="Settings" title={title} />
      {fields.map((label, index) =>
        index === 1 ? (
          <Select
            key={label}
            name={label}
            label={label}
            options={['Enabled', 'Disabled', 'Approval required']}
          />
        ) : (
          <Field
            key={label}
            name={label}
            label={label}
            required
            defaultValue={index === 0 ? 'Current configuration' : 'School default'}
          />
        ),
      )}
      <SubmitButton title="Save settings" />
    </Form>
  );
}
