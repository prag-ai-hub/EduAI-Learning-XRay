/**
 * The three dialogs a school administrator runs against a person: invite one,
 * correct their details, and give them credits.
 *
 * Ported from frontend/app/ui/FunctionalEduAIApp.tsx `InviteDialog` (~1578),
 * `CreditAllocationDialog` (~1579) and `UserEdit` (~1580).
 *
 * Two of them talk to the server and one does not, and that split is real
 * rather than an oversight in the source: an invitation and a credit
 * allocation both have to be recorded outside this device - one sends an email,
 * the other moves a balance somebody is billed for - while editing a name is a
 * workspace edit like any other. `UserEdit` therefore has no busy state and no
 * error path, because it cannot fail.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTE
 * ---------------------------------------------------------------------------
 * Every request goes through `authFetch`, which owns the bearer token and the
 * 401 refresh. The paths stay relative *as arguments*: `authFetch` resolves
 * them against the API origin, which is what makes them work on a device, where
 * a relative URL resolves to nothing.
 *
 * The `<form onSubmit>` blocks are `@/shared/components/form`; the monolith's
 * `<Field label>{children}` label wrapper maps to `Field` around an input and
 * `Select` around a `<select>`. `busy` stays local state rather than the form's
 * own `submitting` because the button's *label* changes with it, and the
 * component that renders `<Form>` sits outside its provider.
 */

import { useState } from 'react';
import { Text, View } from 'react-native';

import { authFetch } from '@/features/auth/api/authApi';
import { Field, Form, FormError, FormGrid, Select, SubmitButton } from '@/shared/components/form';
import { DialogHead } from '@/shared/components/primitives';
import { useAppStyles } from '@/shared/theme/styles';
import type { DemoState, User, W } from '@/shared/types/workspace';

const INVITE_ROLES = ['Teacher', 'Admin'];

const EDIT_ROLES = ['Teacher', 'Principal', 'School administrator', 'Data operator'];

/**
 * The message the API sent, or the caller's fallback.
 *
 * The web read `(await response.json()).error` unguarded; a gateway that
 * answers with HTML would throw there and leave the dialog spinning, so the
 * parse is tolerated and only the message is taken from it.
 */
async function apiMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error || fallback;
}

/** Invite a teacher or an administrator into this school. */
export function InviteDialog({ state, setState, done }: W<'state' | 'setState' | 'done'>) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const schools = state.schools.map((school) => school.split(' · ')[0]);

  return (
    <Form
      onSubmit={async (values) => {
        const email = values.get('email').toLowerCase();
        // Checked here as well as on the server: the local roster is what the
        // administrator is looking at, and a duplicate should be refused before
        // an invitation email goes out.
        if (state.users.some((user) => user.email.toLowerCase() === email)) {
          setError('A user with this email already exists.');
          return;
        }
        setBusy(true);
        setError('');
        const payload = {
          name: values.get('name'),
          email,
          role: values.get('role'),
          credits: values.number('credits'),
        };
        const response = await authFetch('/api/admin/invitations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        setBusy(false);
        if (!response.ok) {
          setError(await apiMessage(response, 'Invitation could not be sent.'));
          return;
        }
        const invited: User = {
          id: `u${Date.now()}`,
          name: payload.name,
          email,
          role: payload.role,
          school: values.get('school'),
          phone: '',
          status: 'Invited',
          totalCredits: payload.credits,
          usedCredits: 0,
        };
        setState((current: DemoState) => ({
          ...current,
          users: [invited, ...current.users],
          events: [`Invitation sent securely · ${invited.email}`, ...current.events],
        }));
        done();
      }}>
      <DialogHead eyebrow="School administration" title="Invite Teacher" />
      <Field
        name="name"
        label="Name"
        required
        minLength={2}
        placeholder="Teacher's full name"
      />
      <Field
        name="email"
        label="Email address"
        type="email"
        required
        placeholder="teacher@school.edu"
      />
      <FormGrid>
        <Select name="role" label="Role" options={INVITE_ROLES} />
        <Field name="credits" label="Credits" type="number" min={0} required defaultValue="10" />
        <Select name="school" label="School" options={schools} />
      </FormGrid>
      <FormError>{error}</FormError>
      <SubmitButton
        title={busy ? 'Sending secure invitation…' : 'Send Invitation'}
        disabled={busy}
      />
    </Form>
  );
}

/**
 * Add credits to one user, with the reason recorded.
 *
 * The reason is required because the allocation is auditable: the event line it
 * writes is the only record of who decided, and "+10 credits" with no cause
 * cannot be reviewed later.
 */
export function CreditAllocationDialog({
  user,
  setState,
  done,
}: W<'setState' | 'done'> & { user: User }) {
  const s = useAppStyles();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const total = user.totalCredits || 0;
  const used = user.usedCredits || 0;

  return (
    <Form
      onSubmit={async (values) => {
        const credits = values.number('credits');
        const reason = values.get('reason');
        setBusy(true);
        const response = await authFetch('/api/admin/users', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id, credits, reason }),
        });
        setBusy(false);
        if (!response.ok) {
          setError(await apiMessage(response, 'Credits could not be assigned.'));
          return;
        }
        setState((current: DemoState) => ({
          ...current,
          users: current.users.map((row) =>
            row.id === user.id ? { ...row, totalCredits: (row.totalCredits || 0) + credits } : row,
          ),
          events: [
            `${credits > 0 ? '+' : ''}${credits} credits · ${user.email} · ${reason}`,
            ...current.events,
          ],
        }));
        done();
      }}>
      <DialogHead eyebrow="Credit allocation" title={`Assign Credits · ${user.name}`} />
      <View style={s.impactBox}>
        <Text style={s.impactBoxTitle}>Current balance</Text>
        <Text style={s.impactBoxCaption}>
          Total {total} · Used {used} · Remaining {Math.max(0, total - used)}
        </Text>
      </View>
      <Field name="credits" label="Credits to add" type="number" required defaultValue="10" />
      <Field name="reason" label="Reason" required placeholder="e.g. New School Allocation" />
      <FormError>{error}</FormError>
      <SubmitButton title={busy ? 'Assigning…' : 'Assign Credits'} disabled={busy} />
    </Form>
  );
}

/** Correct a user's name, email, role or phone number. */
export function UserEdit({ user, setState, done }: W<'setState' | 'done'> & { user: User }) {
  return (
    <Form
      onSubmit={(values) => {
        setState((current: DemoState) => ({
          ...current,
          users: current.users.map((row) =>
            row.id === user.id
              ? {
                  ...row,
                  name: values.get('name'),
                  email: values.get('email'),
                  role: values.get('role'),
                  phone: values.get('phone'),
                }
              : row,
          ),
        }));
        done();
      }}>
      <DialogHead eyebrow="Manage user" title="Edit details" />
      <Field name="name" label="Name" required defaultValue={user.name} />
      <Field name="email" label="Email" type="email" required defaultValue={user.email} />
      <Select name="role" label="Role" options={EDIT_ROLES} defaultValue={user.role} />
      <Field name="phone" label="Phone" defaultValue={user.phone} />
      <SubmitButton title="Save changes" />
    </Form>
  );
}
