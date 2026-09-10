/**
 * /signin - the only way into the product.
 *
 * Ported from frontend/app/signin/page.tsx. Authentication happens here and
 * /app sends anonymous visitors back, so there is one entry point and the
 * post-login destination can depend on the role.
 *
 * ---------------------------------------------------------------------------
 * WHAT CHANGED, AND WHY
 * ---------------------------------------------------------------------------
 * 1. The web built its own Supabase client from `/api/auth/config` and then
 *    read `/api/profile` by hand to resolve the role. Both of those are what
 *    `useSession` already does - including the configured-at-build-time client
 *    and the token handover to `authFetch` - so this screen consumes the hook
 *    rather than repeating the bootstrap. `landingPath` still decides where the
 *    resolved role belongs, exactly as before.
 *
 * 2. `location.origin` does not exist on a device: the OAuth return address is
 *    `Linking.createURL('/signin')`, which is the site origin on web and the
 *    app's own deep link on iOS and Android. On a device supabase-js cannot
 *    navigate a tab either, so the provider URL is opened in the system
 *    authentication session and the answer - a PKCE `code`, or tokens in the
 *    fragment - is turned into a session here.
 *
 * 3. The "Use email and password" card focused the email input directly
 *    (`document.querySelector('input[name="email"]')`). `form.tsx` has no
 *    `focusField`, so this screen holds the input ref itself and hands it to
 *    `Field` through `inputProps`. That spread lands after `Field`'s own ref,
 *    so this ref replaces it: the only thing lost is `Field` focusing itself
 *    when its own validation fails.
 */

import { useEffect, useRef, useState } from 'react';
import { Platform, Text, View, type TextInput, type TextInputProps } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { AuthDivider, AuthShell, OAuthButtonRow } from '@/features/auth/components/auth-shell';
import { useSession } from '@/features/auth/hooks/use-session';
import { landingPath } from '@/features/auth/roles';
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

/** `.login-proof` - the three cards beside the sign-in card. */
const PROOF = [
  {
    badge: '01',
    title: 'Evidence first',
    caption: 'Every insight links back to approved student work.',
  },
  {
    badge: '02',
    title: 'Teacher authority',
    caption: 'AI suggestions stay drafts until you approve them.',
  },
  {
    badge: '03',
    title: 'Action ready',
    caption: 'Move from a gap to a focused intervention in minutes.',
  },
] as const;

export default function SignInRoute() {
  const s = useAppStyles();
  const router = useRouter();
  const { client, session, profile, loading, authError } = useSession();

  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  /**
   * Where "I am a parent" wants to land, held here rather than pushed into the
   * URL. A parent arrives at this screen with nothing in `?next=` - they
   * followed "Sign in", not a link that knew what they came for - and the
   * button that says so is on this card. Local state keeps that intent through
   * the sign-up round trip without a navigation that would remount the form
   * they are halfway through.
   */
  const [intent, setIntent] = useState<string | null>(null);
  const email = useRef<TextInput>(null);

  const login = mode === 'login';

  // Covers both an existing session and the return hop from a provider, which
  // lands back here rather than deep in the app. `loading` is still true while
  // the profile is being read, and the role is what decides the destination.
  // `?next=` is where the caller was trying to go before it sent them here -
  // register-school does this for an anonymous visitor. Without honouring it
  // they sign in successfully and land wherever their role usually goes, having
  // silently lost what they came to do.
  //
  // Only a path within this app is accepted. Taking the parameter at face value
  // would let a crafted link bounce someone straight back out to another site
  // immediately after authenticating, which is a redirect a phishing page can
  // use and a signed-in user has no reason to expect.
  const { next } = useLocalSearchParams<{ next?: string }>();
  const requested =
    typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : null;
  // `?next=` wins: a visitor sent here from /register-school has a destination
  // someone else chose for them, and it is not this card's to override.
  const destination = requested ?? intent;

  useEffect(() => {
    if (!session || loading) return;
    router.replace((destination ?? landingPath(profile)) as Href);
  }, [session, loading, profile, router, destination]);

  const submit = async (values: FormValues) => {
    if (!client) return;
    const address = values.trimmed('email').toLowerCase();
    const password = values.get('password');
    setMessage('');
    setNotice('');
    const result = login
      ? await client.auth.signInWithPassword({ email: address, password })
      : await client.auth.signUp({
          email: address,
          password,
          options: { emailRedirectTo: Linking.createURL('/signin') },
        });
    if (result.error) {
      setMessage(result.error.message);
      return;
    }
    if (!login && !result.data.session) {
      setNotice('Check your email to confirm your account, then sign in.');
      return;
    }
    // A session now exists; the effect above routes once its role is known.
  };

  const oauth = async (provider: 'google' | 'azure') => {
    if (!client) {
      setMessage('Authentication is still loading.');
      return;
    }
    setMessage('');
    // Returns here, not to /app, so the role-aware redirect stays in one place.
    const redirectTo = Linking.createURL('/signin');
    const { data, error } = await client.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        skipBrowserRedirect: Platform.OS !== 'web',
        ...(provider === 'azure' ? { scopes: 'email' } : {}),
      },
    });
    if (error) {
      setMessage(error.message);
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

  return (
    <AuthShell
      variant="login"
      eyebrow="EduAI Learning X-Ray"
      title="Turn learning evidence into the right next step."
      lead="Teacher-approved grading, clear concept diagnosis and practical interventions - without rankings or surveillance."
      proof={PROOF}
      storyLabel="EduAI Learning X-Ray introduction"
      panelLabel="Sign in">
      <Eyebrow>{login ? 'Welcome back' : 'Create your account'}</Eyebrow>
      <Text accessibilityRole="header" style={s.loginCardTitle}>
        {login ? 'Sign in to Learning X-Ray' : 'Create your Learning X-Ray account'}
      </Text>
      <Text style={s.loginCardLead}>
        Use your school account to securely access your workspace.
      </Text>
      {session ? (
        <View role="status" style={s.insight}>
          <Text style={s.insightText}>
            You are already signed in. Taking you to your workspace…
          </Text>
        </View>
      ) : null}

      <OAuthButtonRow
        variant="login"
        onGoogle={() => void oauth('google')}
        onMicrosoft={() => void oauth('azure')}
        onEmail={() => email.current?.focus()}
        disabled={!client}
      />

      <AuthDivider variant="login">or sign in with email</AuthDivider>

      <Form onSubmit={submit}>
        <Field
          name="email"
          label="Email address"
          type="email"
          autoComplete="email"
          required
          // See note 3 at the top of the file: `Field` exposes no ref of its own.
          inputProps={{ ref: email } as TextInputProps}
        />
        <Field
          name="password"
          label="Password"
          type="password"
          minLength={8}
          autoComplete={login ? 'current-password' : 'new-password'}
          required
        />
        <FormError>{message || authError}</FormError>
        {notice ? (
          <View role="status" style={s.insight}>
            <Text style={s.insightText}>{notice}</Text>
          </View>
        ) : null}
        <SignInButton
          idle={login ? 'Sign in securely' : 'Create account'}
          disabled={!client}
        />
      </Form>

      <AppButton
        full
        title={login ? 'New teacher? Create an account' : 'Already have an account? Sign in'}
        onPress={() => {
          setMode(login ? 'signup' : 'login');
          setMessage('');
          setNotice('');
        }}
      />

      {/* A parent signs up here like anyone else - Supabase owns the identity
          for all four roles - and then needs /parent/join, which is where the
          Parent role is actually attached and the invite code redeemed. This
          button is what remembers that through the round trip. */}
      <AppButton
        variant="link"
        full
        title="Are you a parent? Create a parent account"
        onPress={() => {
          setIntent('/parent/join');
          setMode('signup');
          setMessage('');
          setNotice('');
          email.current?.focus();
        }}
        textStyle={s.loginFooterLink}
      />

      <View style={s.loginNote}>
        <Text style={s.loginNoteDot}>●</Text>
        <Text style={s.loginNoteText}>Secure sign-in · Session protection · Audit history</Text>
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

/**
 * The submit button, whose label changes while the request is in flight.
 *
 * Separate because `useFormContext` only sees the form from inside it - called
 * where `<Form>` is rendered it would throw.
 */
function SignInButton({ idle, disabled }: { idle: string; disabled: boolean }) {
  const form = useFormContext();
  return <SubmitButton title={form.submitting ? 'Please wait…' : idle} disabled={disabled} />;
}
