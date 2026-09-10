/**
 * /parent/join - "Create a parent account".
 *
 * The one place in this product where a person creates their own profile row.
 * Every other account is made by someone with authority over it: a school
 * administrator's alongside the school they registered, a teacher's by the
 * invitation that school sent. A parent has neither, so the role matrix
 * provisions them as "Self sign-up + invite code"
 * (docs/plan/01-ROLE-PERMISSION-MATRIX.md) and this screen is that line.
 *
 * ---------------------------------------------------------------------------
 * THE ORDER OF THE THREE STEPS, AND WHY IT CANNOT BE CHANGED
 * ---------------------------------------------------------------------------
 * 1. **Supabase first.** Django cannot create an identity - `public.users.id`
 *    carries a foreign key to `auth.users.id` - so an anonymous visitor goes to
 *    /signin and comes back here with a session, exactly as /register-school
 *    sends them.
 * 2. **The profile next.** `POST /api/v1/accounts/parents` attaches the Parent
 *    role to that identity. Until it exists, every Django endpoint answers 403:
 *    a verified token with no profile row holds no role and therefore no
 *    capability.
 * 3. **The code last.** Redemption needs the Parent role to exist - the
 *    `parent_student_links_role_check` trigger refuses the insert otherwise -
 *    and it is the step that actually grants access to anything. The account
 *    on its own reaches nothing: a Parent's capabilities are all scoped through
 *    `parent_student_links`, so an unlinked one sees an empty list.
 *
 * Steps 2 and 3 are separate calls because they are separate concerns on the
 * server. Redemption is throttled per account, audited to the issuing school,
 * and answers every refusal identically; folding it into sign-up would give it
 * a second door with a second throttle bucket. It also has to work alone, for a
 * parent linking a second child a term later.
 *
 * Step 2 is idempotent, so a code refused at step 3 leaves an account the
 * parent can simply try again from - which is what the second card is.
 */

import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import { AuthShell } from '@/features/auth/components/auth-shell';
import { useSession } from '@/features/auth/hooks/use-session';
import { ApiError, signUpAsParent } from '@/features/parents/api/parentsApi';
import { LinkChildForm } from '@/features/parents/components/link-child-form';
import { AppButton } from '@/shared/components/buttons';
import {
  Field,
  Form,
  FormError,
  SubmitButton,
  useFormContext,
  type FormValues,
} from '@/shared/components/form';
import { Eyebrow } from '@/shared/components/primitives';
import { useAppStyles } from '@/shared/theme/styles';

/** `.login-proof` - what joining actually involves. */
const PROOF = [
  {
    badge: '01',
    title: 'Create your account',
    caption: 'Your name and the email you signed in with. Nothing else.',
  },
  {
    badge: '02',
    title: 'Enter your invite code',
    caption: "The code your child's teacher gave you links you to them.",
  },
  {
    badge: '03',
    title: 'See approved work only',
    caption: 'Teacher-approved reports. No rankings, no other children.',
  },
] as const;

export default function ParentJoinRoute() {
  const s = useAppStyles();
  const router = useRouter();
  const { session, profile, loading } = useSession();

  /** Set when the profile call succeeds - the header's step 2, this card's
   *  "Step 1 of 2". An account that already held the role is the other half of
   *  `enrolled` below, and is read from the profile rather than copied into
   *  state: a value that can be computed has no business being synchronised. */
  const [signedUp, setSignedUp] = useState(false);
  const [message, setMessage] = useState('');

  /** This account holds the Parent role: we just gave it one, or it had one. */
  const enrolled = signedUp || profile?.role === 'Parent';

  useEffect(() => {
    if (loading) return;
    if (!session) {
      // Carries the destination, as /register-school does. Without it a visitor
      // who followed "I am a parent" signs in and lands wherever their role
      // usually goes, having lost what they came to do.
      router.replace('/signin?next=/parent/join' as Href);
      return;
    }
    // An account that already has some other role belongs somewhere that is not
    // this screen, and the server says the same - it refuses to convert an
    // existing account, because a Parent carries no school and a teacher's
    // does. A Parent stays and goes straight to the code, via `enrolled`.
    if (profile && profile.role !== 'Parent') router.replace('/app' as Href);
  }, [session, profile, loading, router]);

  const submit = async (values: FormValues) => {
    setMessage('');
    try {
      await signUpAsParent({
        name: values.trimmed('name'),
        phone: values.trimmed('phone'),
      });
      setSignedUp(true);
    } catch (cause) {
      setMessage(
        cause instanceof ApiError
          ? cause.message
          : 'Your account could not be created. Please try again.',
      );
    }
  };

  const ready = !loading && Boolean(session);

  return (
    <AuthShell
      variant="login"
      eyebrow="EduAI Learning X-Ray"
      title="See how your child is really doing."
      lead="Teacher-approved reports on what your child has understood and what to practise next - written and approved by their teacher, never generated behind their back."
      proof={PROOF}
      storyLabel="What a parent account shows"
      panelLabel="Create a parent account">
      {!ready ? (
        <View role="status" style={s.insight}>
          <Text style={s.insightText}>Checking your account…</Text>
        </View>
      ) : null}

      {ready && !enrolled ? (
        <>
          <Eyebrow>Step 1 of 2</Eyebrow>
          <Text accessibilityRole="header" style={s.loginCardTitle}>
            Create your parent account
          </Text>
          <Text style={s.loginCardLead}>
            We use the email address you signed in with. Your child&apos;s school decides what you
            can see, and you will need the invite code they gave you next.
          </Text>
          <Form onSubmit={submit}>
            <Field name="name" label="Your full name" required minLength={2} autoComplete="name" />
            <Field name="phone" label="Phone (optional)" type="tel" autoComplete="tel" />
            <FormError>{message}</FormError>
            <JoinButton />
          </Form>
        </>
      ) : null}

      {ready && enrolled ? (
        <>
          <Eyebrow>Step 2 of 2</Eyebrow>
          <Text accessibilityRole="header" style={s.loginCardTitle}>
            Enter your invite code
          </Text>
          <Text style={s.loginCardLead}>
            Your child&apos;s teacher issues this code. It works once, and it expires - ask the
            school for a new one if it does not work.
          </Text>
          <LinkChildForm
            submitLabel="Link my child"
            onLinked={() => router.replace('/parent' as Href)}
          />
          <AppButton
            full
            title="I will do this later"
            onPress={() => router.replace('/parent' as Href)}
          />
        </>
      ) : null}

      <View style={s.loginNote}>
        <Text style={s.loginNoteDot}>●</Text>
        <Text style={s.loginNoteText}>
          Approved reports only · No rankings · No other children
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

/** The label changes while the request is in flight; see `useFormContext`. */
function JoinButton() {
  const form = useFormContext();
  return <SubmitButton title={form.submitting ? 'Creating your account…' : 'Continue'} />;
}
