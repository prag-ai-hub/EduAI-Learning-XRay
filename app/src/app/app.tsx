/**
 * /app - the signed-in workspace for teachers, school administrators and the
 * platform team.
 *
 * Ported from frontend/app/app/page.tsx, which rendered `FunctionalEduAIApp`
 * (frontend/app/ui/FunctionalEduAIApp.tsx ~249). That component was the gate
 * in front of the workspace: splash while the session resolves, off to
 * /signin without one, the profile-completion form for an account with no
 * profile row, and the workspace once there is a role to render.
 *
 * The session bootstrap is `useSession`'s, not repeated here. What this route
 * adds is the routing the web did with `location.replace`, which a device does
 * not have:
 *
 *  * no session       -> /signin, after showing a bootstrap error for 2.5s
 *                        rather than bouncing past it, as the web did;
 *  * a Parent         -> /parent. The web rendered a "coming soon" card here;
 *                        the parent portal exists now and is not this screen;
 *  * sign-out         -> /signin, because `signOut` clears the session and
 *                        deliberately does not decide where to go.
 *
 * `mount` keys the workspace. A sync conflict's "reload" bumps it, so the
 * workspace remounts and restores the other device's revision - the web's
 * `location.reload()`, without reloading anything else.
 */

import { useEffect, useState } from 'react';
import { useRouter, type Href } from 'expo-router';

import { TeacherAuth } from '@/features/auth/components/teacher-auth';
import { useSession } from '@/features/auth/hooks/use-session';
import { WorkspaceScreen } from '@/features/workspace/screens/workspace';
import { AppLoading } from '@/shared/components/brand';

/** How long a bootstrap failure stays readable before the redirect. */
const ERROR_READ_MS = 2500;

export default function AppRoute() {
  const router = useRouter();
  const { client, session, profile, needsProfile, loading, authError, onProfile, signOut } =
    useSession();
  const [mount, setMount] = useState(0);

  useEffect(() => {
    if (loading) return;
    if (!session) {
      const timer = setTimeout(
        () => router.replace('/signin' as Href),
        authError ? ERROR_READ_MS : 0,
      );
      return () => clearTimeout(timer);
    }
    if (profile?.role === 'Parent') router.replace('/parent' as Href);
  }, [loading, session, profile, authError, router]);

  if (loading) return <AppLoading message="Preparing your secure workspace…" />;
  if (!session) return <AppLoading message={authError || 'Taking you to sign in…'} />;

  if (needsProfile || !profile)
    return (
      <TeacherAuth
        client={client}
        session={session}
        needsProfile={needsProfile}
        error={authError}
        onProfile={onProfile}
        onRegisterSchool={() => router.replace('/register-school' as Href)}
      />
    );

  if (profile.role === 'Parent') return <AppLoading message="Taking you to your parent dashboard…" />;

  return (
    <WorkspaceScreen
      key={mount}
      profile={profile}
      onSignOut={() => {
        void signOut().then(() => router.replace('/signin' as Href));
      }}
      onReload={() => setMount((n) => n + 1)}
    />
  );
}
