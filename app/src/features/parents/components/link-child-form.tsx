/**
 * "Link a child" - the invite-code form.
 *
 * Used in two places, which is why it is a component rather than markup on a
 * screen: on /parent/join, where it is the second half of signing up, and on
 * the parent dashboard, where a parent adds a second child months later. The
 * server treats those identically - one endpoint, one throttle, one audit row -
 * so the client should not grow two versions of the form either.
 *
 * ---------------------------------------------------------------------------
 * THE MESSAGE IS THE SERVER'S, VERBATIM
 * ---------------------------------------------------------------------------
 * Wrong, expired, already used, revoked and issued-to-a-different-address all
 * answer with one 400 and one sentence, deliberately: a code that reported
 * *which* would say whether a code was ever real, and whether a given address
 * holds an account. So this form renders what it is given and never tries to
 * be more helpful - a friendlier "that code has expired" here would undo the
 * property the endpoint was built around.
 *
 * The code is upper-cased as it is typed because the server matches on
 * `upper(btrim(code))` and the alphabet is uppercase to begin with - a parent
 * copying off a printed slip should see what the slip says.
 */

import { useState } from 'react';
import { Text, View } from 'react-native';

import { ApiError, redeemInviteCode, type LinkedChild } from '@/features/parents/api/parentsApi';
import { AppButton } from '@/shared/components/buttons';
import {
  Field,
  Form,
  FormError,
  SubmitButton,
  useFormContext,
  type FormValues,
} from '@/shared/components/form';
import { useAppStyles } from '@/shared/theme/styles';

/** The alphabet the server generates from: no I/1 and no O/0 to mistype. */
const CODE = /[^A-Z0-9]/g;

export type LinkChildFormProps = {
  /** Called with the newly linked child once the server has accepted the code. */
  onLinked?: (child: LinkedChild | null) => void;
  /** Overrides the button's idle label - "Link my child" on the join screen. */
  submitLabel?: string;
};

export function LinkChildForm({ onLinked, submitLabel = 'Link this child' }: LinkChildFormProps) {
  const s = useAppStyles();
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [linked, setLinked] = useState<LinkedChild | null>(null);

  const submit = async (values: FormValues) => {
    setMessage('');
    const entered = values.trimmed('code').toUpperCase();
    try {
      const { child } = await redeemInviteCode(entered);
      setLinked(child);
      setCode('');
      onLinked?.(child);
    } catch (cause) {
      // Rendered as sent. See the note at the top of this file.
      setMessage(
        cause instanceof ApiError
          ? cause.message
          : 'That code could not be used right now. Please try again.',
      );
    }
  };

  if (linked) {
    return (
      <>
        <View role="status" style={s.insight}>
          <Text style={s.insightText}>
            {linked.name} is now linked to your account
            {linked.class_name ? ` (${linked.class_name}, ${linked.school_name})` : ''}. Their
            teacher-approved reports appear as they are published.
          </Text>
        </View>
        {/* Each child has their own code, so a third one is a real next step -
            and this component keeps its own state, so without this the card
            would be stuck on the confirmation of the second. */}
        <AppButton full title="Link another child" onPress={() => setLinked(null)} />
      </>
    );
  }

  return (
    <Form onSubmit={submit}>
      <Field
        name="code"
        label="Invite code"
        value={code}
        onChangeValue={(next) => setCode(next.toUpperCase().replace(CODE, ''))}
        placeholder="ABCD234XYZ"
        required
        requiredMessage="Enter the invite code your child's teacher gave you."
        // `parent_invite_codes_code_check` accepts 6 to 12 characters; the
        // server issues 10. Bounded here so a paste of a whole email cannot be
        // sent, not as a validity check - the server owns that.
        maxLength={12}
        autoComplete="off"
        submitOnEnter
        inputProps={{ autoCapitalize: 'characters', autoCorrect: false }}
      />
      <FormError>{message}</FormError>
      <LinkButton idle={submitLabel} />
    </Form>
  );
}

/** The label changes while the redemption is in flight; see `useFormContext`. */
function LinkButton({ idle }: { idle: string }) {
  const form = useFormContext();
  return <SubmitButton title={form.submitting ? 'Checking the code…' : idle} />;
}
