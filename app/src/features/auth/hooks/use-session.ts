/**
 * The Supabase session and the profile gate - the two things the whole shell
 * hangs off.
 *
 * Ported from the body of `FunctionalEduAIApp` in
 * frontend/app/ui/FunctionalEduAIApp.tsx:249-293, which owned exactly this and
 * nothing else once the rendering was split out.
 *
 * Two departures from the web version, both deliberate:
 *
 *  * The web kept the access token in a module-level `let activeAccessToken`
 *    plus a `sessionStorage` copy, and its own `authFetch` read that variable.
 *    Here `@/shared/api/net` owns the token; this hook only hands it over. There
 *    is no second copy to go stale, and no module-level mutable state.
 *  * The session itself is persisted by the Supabase client's storage adapter,
 *    which `@/shared/api/supabase` has already pointed at `secureStore` - the
 *    keychain on a device. Writing the bearer JWT to storage again here would
 *    leave a copy that nothing ever refreshes.
 *
 * The client is the configured singleton where the build has
 * EXPO_PUBLIC_SUPABASE_*, and is otherwise created from `/api/auth/config`,
 * which is the path the Next.js app always took. Both arms get the same
 * storage adapter, so a session started under one is readable by the other.
 */

import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import {
  createClient,
  type AuthChangeEvent,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js';

import { authFetch, clearAccessToken, setAccessToken } from '@/features/auth/api/authApi';
import { toRole } from '@/features/workspace/lib/demo-state';
import { supabase, supabaseConfigured } from '@/shared/api/supabase';
import { secureStore } from '@/shared/storage';
import type { DemoProfile, Role } from '@/shared/types/workspace';

export type UseSession = {
  /** Null until the bootstrap resolves, and for good when it fails. */
  client: SupabaseClient | null;
  session: Session | null;
  /** Null while signed out, and while a signed-in user still has no profile. */
  profile: DemoProfile | null;
  /** Signed in, but /api/profile has nothing for this account yet. */
  needsProfile: boolean;
  loading: boolean;
  authError: string;
  /** What the profile-completion form calls once /api/profile accepts it. */
  onProfile: (profile: DemoProfile) => void;
  signOut: () => Promise<void>;
};

/**
 * supabase-js wants Web Storage naming over string values; `secureStore`
 * exposes get/set/remove. This is the same three-line rename
 * `@/shared/api/supabase` applies to the singleton - repeated rather than
 * exported from there because it is an implementation detail of that module,
 * and both copies point at the same store, which is the part that matters.
 */
const sessionStorageAdapter = {
  getItem: (key: string): Promise<string | null> => secureStore.get(key),
  setItem: (key: string, value: string): Promise<void> => secureStore.set(key, value),
  removeItem: (key: string): Promise<void> => secureStore.remove(key),
};

/** A profile row from /api/profile, in the shape the workspace holds it. */
function toProfile(row: {
  id: string;
  name: string;
  email: string;
  role: unknown;
  school: string;
}): DemoProfile {
  const accountRole: Role = toRole(row.role);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: accountRole,
    school: row.school,
    label: `${accountRole} account`,
  };
}

export function useSession(): UseSession {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<DemoProfile | null>(null);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    let alive = true;
    let unsubscribe: (() => void) | undefined;

    void (async () => {
      try {
        const supabaseClient = supabaseConfigured && supabase ? supabase : await clientFromApi();
        if (!alive) return;
        setClient(supabaseClient);

        const apply = async (next: Session | null) => {
          setSession(next);
          // The transport's token, updated on every auth event including the
          // silent refresh. `authFetch` reads it from there, never from here.
          if (next?.access_token) setAccessToken(next.access_token);
          else clearAccessToken();

          if (!next) {
            setProfile(null);
            setNeedsProfile(false);
            setLoading(false);
            return;
          }

          setLoading(true);
          const profileResponse = await authFetch('/api/profile', { cache: 'no-store' });
          const payload = await profileResponse.json();
          if (!profileResponse.ok) throw new Error(payload.error || 'Could not load your profile.');
          if (payload.profile) {
            setProfile(toProfile(payload.profile));
            setNeedsProfile(false);
          } else {
            setProfile(null);
            setNeedsProfile(true);
          }
          setLoading(false);
        };

        const { data } = await supabaseClient.auth.getSession();
        await apply(data.session);

        const { data: subscription } = supabaseClient.auth.onAuthStateChange(
          (_event: AuthChangeEvent, next: Session | null) => {
            void apply(next).catch((cause: unknown) => {
              setAuthError(cause instanceof Error ? cause.message : 'Authentication failed.');
              setLoading(false);
            });
          },
        );
        unsubscribe = () => subscription.subscription.unsubscribe();
      } catch (cause) {
        if (alive) {
          setAuthError(cause instanceof Error ? cause.message : 'Authentication failed.');
          setLoading(false);
        }
      }
    })();

    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, []);

  const onProfile = useCallback((next: DemoProfile) => {
    setProfile(next);
    setNeedsProfile(false);
  }, []);

  /**
   * Clears the session and the bearer token. Where to send the visitor
   * afterwards is the route's decision - the web app's `location.replace` is a
   * navigation, and this hook is rendered on more than one screen.
   */
  const signOut = useCallback(async () => {
    await client?.auth.signOut();
    clearAccessToken();
    setSession(null);
    setProfile(null);
    setNeedsProfile(false);
  }, [client]);

  return { client, session, profile, needsProfile, loading, authError, onProfile, signOut };
}

/**
 * The fallback bootstrap: ask the server for the project URL and publishable
 * key, then build a client with them.
 *
 * `detectSessionInUrl` is web-only for the reason `@/shared/api/supabase`
 * records - a device has no URL bar for a magic link or an OAuth hop to come
 * back through, and its deep links are handled explicitly.
 */
async function clientFromApi(): Promise<SupabaseClient> {
  const response = await authFetch('/api/auth/config', { cache: 'no-store' });
  const config = await response.json();
  if (!response.ok) throw new Error(config.error || 'Authentication is unavailable.');
  return createClient(config.url, config.publishableKey, {
    auth: {
      storage: sessionStorageAdapter,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: Platform.OS === 'web',
    },
  });
}
