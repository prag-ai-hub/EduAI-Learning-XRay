import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import { secureStore } from '@/shared/storage';

/**
 * Supabase client for the mobile app.
 *
 * Supabase Auth is the identity provider for every EduAI client - the web app,
 * and this. The Django API verifies the token this client issues; the app never
 * holds a credential of its own beyond the session.
 *
 * The session is kept in `secureStore` from @/shared/storage, which is already
 * the one place that decides where a secret lives per platform: the keychain /
 * keystore on a device, chunked past SecureStore's ~2 KB per-value ceiling, and
 * a Web Storage area in a browser. This file deliberately does not make that
 * choice a second time - expo-secure-store has no web implementation at all
 * (`ExpoSecureStore.web.ts` is `export default {}`), so a storage adapter that
 * calls it unconditionally throws on the first read in a browser, and the whole
 * of Expo web then signs nobody in.
 */

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const isWeb = Platform.OS === 'web';

/**
 * supabase-js wants Web Storage naming - getItem / setItem / removeItem over
 * string values - and `secureStore` exposes get / set / remove. Renaming is the
 * whole adapter; the chunking, the key-charset guard and the platform branch
 * all stay in @/shared/storage where the rest of the app already gets them.
 *
 * The keys supabase-js writes are `sb-<project ref>-auth-token` and
 * `<that>-code-verifier`, both of which satisfy secureStore's SecureStore key
 * rule, so the guard cannot fire on a real project URL.
 */
const sessionStorageAdapter = {
  getItem: (key: string): Promise<string | null> => secureStore.get(key),
  setItem: (key: string, value: string): Promise<void> => secureStore.set(key, value),
  removeItem: (key: string): Promise<void> => secureStore.remove(key),
};

export const supabaseConfigured = Boolean(url && publishableKey);

/**
 * Null when the app was built without Supabase configuration, so a screen can
 * say so rather than crashing on a client that cannot work.
 */
export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, publishableKey!, {
      auth: {
        storage: sessionStorageAdapter,
        autoRefreshToken: true,
        persistSession: true,
        // Native has no URL bar to read a session out of, and its deep links are
        // handled explicitly by the OAuth flow. A browser is the opposite case:
        // password recovery, magic links and OAuth all come back as a redirect
        // carrying the session, and only supabase-js reading the URL turns that
        // into a signed-in state. The three Next.js entry points that already do
        // this - app/signin, app/parent and FunctionalEduAIApp - all pass true.
        detectSessionInUrl: isWeb,
      },
    })
  : null;

export async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
