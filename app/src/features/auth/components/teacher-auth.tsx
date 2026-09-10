/**
 * The in-app authentication gate: sign in, sign up, and the profile form a
 * teacher completes on their first login.
 *
 * Ported from `TeacherAuth` in frontend/app/ui/FunctionalEduAIApp.tsx. The
 * two-pane layout, the divider and the provider buttons are all
 * `@/features/auth/components/auth-shell`, which is where the three web copies
 * of that markup were consolidated.
 *
 * ---------------------------------------------------------------------------
 * PLATFORM NOTES
 * ---------------------------------------------------------------------------
 * 1. `location.origin`. There is no location on a device, so the return address
 *    is `Linking.createURL('/app')`: the site origin on web, the app's own
 *    `eduaixray://` deep link on iOS and Android.
 *
 * 2. The OAuth hop. On the web supabase-js navigates the tab and the session
 *    comes back through `detectSessionInUrl`. A device has no tab: the provider
 *    URL is opened in the system authentication session and the result is
 *    turned into a session here - a `code` through the PKCE exchange, tokens in
 *    the fragment through `setSession`. Both flows are covered because which
 *    one applies depends on the client's `flowType`.
 *
 * 3. `location.assign("/register-school")`. Navigation is the caller's, for the
 *    same reason `useSession().signOut` does not navigate: this component is
 *    rendered by the shell, and only the shell knows the route tree.
 */

import { useState } from 'react';
import { Platform, Text } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import type { Session, SupabaseClient } from '@supabase/supabase-js';

import { authFetch } from '@/features/auth/api/authApi';
import { AuthDivider, AuthShell, OAuthButtonRow } from '@/features/auth/components/auth-shell';
import { toRole } from '@/features/workspace/lib/demo-state';
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
import type { DemoProfile, Role } from '@/shared/types/workspace';

/** `.demo-auth-story ol` - the three steps beside the card. */
const STEPS = [
  { badge: '1', title: 'Sign in securely' },
  { badge: '2', title: 'Create or resume assessments' },
  { badge: '3', title: 'Review AI evidence before publishing' },
] as const;

export type TeacherAuthProps = {
  client: SupabaseClient | null;
  session: Session | null;
  /** Signed in, but /api/profile has nothing for this account yet. */
  needsProfile: boolean;
  /** A bootstrap failure from the session hook, shown as the opening message. */
  error: string;
  onProfile: (profile: DemoProfile) => void;
  /**
   * Where to send a teacher whose profile cannot be created because their
   * school has never been registered. The web replaced the location with
   * /register-school; the route tree is the caller's to know.
   */
  onRegisterSchool: () => void;
};

export function TeacherAuth({
  client,
  session,
  needsProfile,
  error,
  onProfile,
  onRegisterSchool,
}: TeacherAuthProps) {
  const s = useAppStyles();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [message, setMessage] = useState(error);

  const login = mode === 'login';

  const submitAuth = async (values: FormValues) => {
    if (!client) return;
    const email = values.trimmed('email').toLowerCase();
    const password = values.get('password');
    setMessage('');
    const result = login
      ? await client.auth.signInWithPassword({ email, password })
      : await client.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: Linking.createURL('/app') },
        });
    if (result.error) setMessage(result.error.message);
    else if (!login && !result.data.session)
      setMessage('Check your email to confirm your account, then return here to log in.');
  };

  const oauth = async (provider: 'google' | 'azure') => {
    if (!client) return;
    setMessage('');
    const redirectTo = Linking.createURL('/app');
    const { data, error: oauthError } = await client.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        // On the web supabase-js performs the redirect itself, which is what
        // the Next.js page relied on.
        skipBrowserRedirect: Platform.OS !== 'web',
        ...(provider === 'azure' ? { scopes: 'email' } : {}),
      },
    });
    if (oauthError) {
      setMessage(oauthError.message);
      return;
    }
    if (Platform.OS === 'web' || !data?.url) return;

    const outcome = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (outcome.type !== 'success') return;
    const returned = new URL(outcome.url);
    const code = returned.searchParams.get('code');
    if (code) {
      const exchange = await client.auth.exchangeCodeForSession(code);
      if (exchange.error) setMessage(exchange.error.message);
      return;
    }
    // The implicit flow answers in the fragment, which URL leaves untouched.
    const fragment = new URLSearchParams(returned.hash.replace(/^#/, ''));
    const accessToken = fragment.get('access_token');
    const refreshToken = fragment.get('refresh_token');
    if (accessToken && refreshToken) {
      const restored = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (restored.error) setMessage(restored.error.message);
    }
  };

  const saveProfile = async (values: FormValues) => {
    setMessage('');
    const response = await authFetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: values.get('name'),
        school: values.get('school'),
        phone: values.get('phone'),
        subjects: values.get('subjects'),
        classes: values.get('classes'),
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      // Signing up alone no longer creates a school silently - registration is
      // reviewed, so send them to the one front door that does it properly.
      if (payload.code === 'school_registration_required') {
        onRegisterSchool();
        return;
      }
      setMessage(payload.error || 'Could not save your profile.');
      return;
    }
    const accountRole: Role = toRole(payload.profile.role);
    onProfile({
      id: payload.profile.id,
      name: payload.profile.name,
      email: payload.profile.email,
      role: accountRole,
      school: payload.profile.school,
      label: `${accountRole} account`,
    });
  };

  return (
    <AuthShell
      eyebrow="EduAI Learning X-Ray"
      title="Your work, securely saved to your teacher account."
      lead="Grade uploaded answer sheets, identify evidence-based learning gaps, and return later to continue exactly where you stopped."
      proof={STEPS}
      storyLabel="EduAI Learning X-Ray introduction"
      panelLabel={session && needsProfile ? 'Complete your profile' : 'Teacher account'}>
      {session && needsProfile ? (
        <>
          <Eyebrow>First login</Eyebrow>
          <Text accessibilityRole="header" style={s.demoAuthCardTitle}>
            Complete your teacher profile
          </Text>
          <Text style={s.demoAuthCardLead}>
            We&rsquo;ll use these details to create your private workspace.
          </Text>
          <Form onSubmit={saveProfile}>
            <Field name="name" label="Your name" required autoFocus />
            <Field name="school" label="School name" required />
            <Field name="phone" label="Phone (optional)" type="tel" />
            <Field
              name="subjects"
              label="Subjects taught"
              placeholder="e.g. Economics, Business Studies"
            />
            <Field name="classes" label="Classes taught" placeholder="e.g. Class 11 and 12" />
            <FormError>{message}</FormError>
            <BusyButton idle="Save profile & continue" busy="Creating workspace…" />
          </Form>
        </>
      ) : (
        <>
          <Eyebrow>Teacher account</Eyebrow>
          <Text accessibilityRole="header" style={s.demoAuthCardTitle}>
            {login ? 'Welcome back' : 'Create your account'}
          </Text>
          <Form onSubmit={submitAuth}>
            <Field
              name="email"
              label="Email address"
              type="email"
              autoComplete="email"
              required
            />
            <Field
              name="password"
              label="Password"
              type="password"
              minLength={8}
              autoComplete={login ? 'current-password' : 'new-password'}
              required
            />
            <FormError>{message}</FormError>
            <BusyButton idle={login ? 'Log in' : 'Create account'} busy="Please wait…" />
          </Form>

          <AuthDivider>or continue with</AuthDivider>
          <OAuthButtonRow
            onGoogle={() => void oauth('google')}
            onMicrosoft={() => void oauth('azure')}
            disabled={!client}
          />

          <AppButton
            title={login ? 'New teacher? Create an account' : 'Already have an account? Log in'}
            full
            onPress={() => {
              setMode(login ? 'signup' : 'login');
              setMessage('');
            }}
          />
        </>
      )}
    </AuthShell>
  );
}

/**
 * The submit button, whose label changes while the request is in flight.
 *
 * A separate component because `useFormContext` - like `useFormField` - only
 * sees the form from inside it; called where `<Form>` is rendered it would
 * throw.
 */
function BusyButton({ idle, busy }: { idle: string; busy: string }) {
  const form = useFormContext();
  return <SubmitButton title={form.submitting ? busy : idle} />;
}
