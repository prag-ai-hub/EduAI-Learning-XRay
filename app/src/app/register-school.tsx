/**
 * /register-school.
 *
 * Ported from frontend/app/register-school/page.tsx.
 *
 * Signup happens in Supabase first - Django cannot create an identity, because
 * `public.users.id` references `auth.users.id` - so an anonymous visitor is
 * sent to /signin and comes back here with a session. This screen then creates
 * the school and the caller's SchoolAdmin profile in one Django call.
 *
 * A new school is always Pending. Approval is a Super Admin decision, so the
 * success state is a waiting room, not a workspace.
 *
 * The session comes from `useSession` rather than from a bare `accessToken()`
 * call: the Django client reads the token for itself, and this screen only
 * needs to know whether there is a signed-in caller at all.
 */

import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import { AuthShell } from '@/features/auth/components/auth-shell';
import { useSession } from '@/features/auth/hooks/use-session';
import { ApiError, api, schools, type School } from '@/shared/api/django';
import { AppButton } from '@/shared/components/buttons';
import {
  Field,
  Form,
  FormError,
  FormGrid,
  SubmitButton,
  useFormContext,
  type FormValues,
} from '@/shared/components/form';
import { Eyebrow } from '@/shared/components/primitives';
import { useAppStyles } from '@/shared/theme/styles';

/** `.login-proof` - what registering actually involves. */
const PROOF = [
  { badge: '01', title: 'Register', caption: 'Tell us about your school and who administers it.' },
  {
    badge: '02',
    title: 'We review',
    caption: 'A verification check, usually within two working days.',
  },
  {
    badge: '03',
    title: 'Invite your teachers',
    caption: 'Once approved, add staff and start your first assessment.',
  },
] as const;

/** What each application state means for the person reading it. */
const STATUS_COPY: Record<School['status'], string> = {
  Pending:
    'Your registration is with our team. We will email the administrator address as soon as it is reviewed — you do not need to do anything else.',
  Active: 'Your school is approved and active. You can invite teachers and start work.',
  Suspended: 'This school is currently suspended. Contact support to discuss reactivating it.',
  Closed:
    'This registration was not approved. Contact support if you believe that is a mistake.',
};

export default function RegisterSchoolRoute() {
  const s = useAppStyles();
  const router = useRouter();
  const { session, loading } = useSession();

  const [ready, setReady] = useState(false);
  const [existing, setExisting] = useState<School | null>(null);
  const [submitted, setSubmitted] = useState<School | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (loading) return;
    if (!session) {
      // Carries the destination, as the web did. Without it an anonymous
      // visitor who followed a "register your school" link signs in and lands
      // wherever their role usually goes, having lost what they came to do.
      router.replace('/signin?next=/register-school' as Href);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        // Already registered? Show where that application stands instead of
        // offering to start a second one.
        const { school } = await schools.mine();
        if (alive) {
          setExisting(school);
          setReady(true);
        }
      } catch (cause) {
        if (alive) {
          setMessage(
            cause instanceof ApiError
              ? cause.message
              : 'Registration is unavailable right now.',
          );
          setReady(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [session, loading, router]);

  const submit = async (values: FormValues) => {
    setMessage('');
    try {
      const { school } = await api.post<{ school: School }>('/api/v1/schools/register', {
        name: values.trimmed('name'),
        city: values.trimmed('city'),
        board: values.trimmed('board'),
        admin_name: values.trimmed('admin_name'),
        phone: values.trimmed('phone'),
      });
      setSubmitted(school);
    } catch (cause) {
      setMessage(
        cause instanceof ApiError ? cause.message : 'Registration failed. Please try again.',
      );
    }
  };

  const pending = submitted ?? existing;

  return (
    <AuthShell
      variant="login"
      eyebrow="EduAI Learning X-Ray"
      title="Bring Learning X-Ray to your school."
      lead="Register once. We review every school before it goes live, so staff and student data are only ever opened to a verified institution."
      proof={PROOF}
      storyLabel="Why schools register"
      panelLabel="Register your school">
      {!ready ? (
        <View role="status" style={s.insight}>
          <Text style={s.insightText}>Checking your account…</Text>
        </View>
      ) : null}

      {ready && pending ? (
        <>
          <Eyebrow>{pending.status === 'Pending' ? 'Awaiting review' : 'Your school'}</Eyebrow>
          <Text accessibilityRole="header" style={s.loginCardTitle}>
            {pending.name}
          </Text>
          <Text style={s.loginCardLead}>{STATUS_COPY[pending.status]}</Text>
          <View role="status" style={s.insight}>
            <Text style={s.insightText}>Status: {pending.status}</Text>
          </View>
          {pending.status === 'Active' ? (
            <AppButton
              variant="primary"
              full
              title="Open your workspace"
              onPress={() => router.replace('/app' as Href)}
            />
          ) : (
            <AppButton full title="Back to home" onPress={() => router.replace('/')} />
          )}
        </>
      ) : null}

      {ready && !pending ? (
        <>
          <Eyebrow>Register your school</Eyebrow>
          <Text accessibilityRole="header" style={s.loginCardTitle}>
            Tell us about your school
          </Text>
          <Text style={s.loginCardLead}>
            You will become its administrator. Nothing goes live until our team has reviewed the
            registration.
          </Text>
          <Form onSubmit={submit}>
            <Field
              name="name"
              label="School name"
              required
              minLength={3}
              autoComplete="organization"
              placeholder="Nehru Vidyalaya"
            />
            <FormGrid>
              {/* HTML's `address-level2` is a city; React Native spells the
                  same hint `postal-address-locality`. */}
              <Field
                name="city"
                label="City"
                autoComplete="postal-address-locality"
                placeholder="Pune"
              />
              <Field name="board" label="Board" placeholder="CBSE" />
            </FormGrid>
            <Field name="admin_name" label="Your full name" required minLength={2} autoComplete="name" />
            <Field name="phone" label="Phone" type="tel" autoComplete="tel" />
            <FormError>{message}</FormError>
            <RegisterButton />
          </Form>
        </>
      ) : null}

      <View style={s.loginNote}>
        <Text style={s.loginNoteDot}>●</Text>
        <Text style={s.loginNoteText}>
          Reviewed before activation · Audit history · Your data stays yours
        </Text>
      </View>

      <View style={s.loginFooter}>
        <AppButton
          variant="link"
          title="Home"
          onPress={() => router.replace('/')}
          textStyle={s.loginFooterLink}
        />
        <AppButton
          variant="link"
          title="Privacy"
          onPress={() => router.push('/privacy' as Href)}
          textStyle={s.loginFooterLink}
        />
        <AppButton
          variant="link"
          title="Terms"
          onPress={() => router.push('/terms' as Href)}
          textStyle={s.loginFooterLink}
        />
        <Text style={[s.loginFooterText, s.loginFooterSpacer]}>© 2026 EduAI Hub</Text>
      </View>
    </AuthShell>
  );
}

/** The label changes while the registration is in flight; see `useFormContext`. */
function RegisterButton() {
  const form = useFormContext();
  return <SubmitButton title={form.submitting ? 'Submitting…' : 'Submit registration'} />;
}
