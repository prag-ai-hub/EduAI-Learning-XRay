import { createApiClient } from '@/shared/api';

import { currentAccessToken } from '@/shared/api/net';

/**
 * Client for the Django REST service.
 *
 * The request logic and the error envelope come from ../../../shared/api, which
 * the Next.js app imports too - one implementation, so a field renamed in the
 * API cannot be fixed in one client and forgotten in the other.
 *
 * What is specific here is where the two inputs come from: the base URL is
 * baked in at build time by Expo, and the token is the one `authFetch` sends.
 *
 * That second part used to be `accessToken()` from `@/shared/api/supabase`,
 * which reads the build-time Supabase singleton and returns null when the build
 * has no EXPO_PUBLIC_SUPABASE_*. `useSession` supports exactly that build - it
 * creates its client from `/api/auth/config` instead and hands the token to
 * `@/shared/api/net` - so every Django call from such a build was refused with
 * "Please sign in again" while `authFetch`, reading the same session, worked.
 * `currentAccessToken` reads the token `useSession` handed over and falls back
 * to the singleton, so the two clients can no longer disagree about whether
 * someone is signed in.
 */

export { ApiError } from '@/shared/api';
export type { Paginated, School, SchoolRegistration } from '@/shared/api';

const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

export const api = createApiClient({ baseUrl, getToken: currentAccessToken });

/** Whether this build points at an analysis service at all. */
export const apiConfigured = Boolean(baseUrl);

export const schools = {
  /** The caller's own school and where its approval stands. */
  mine: () => api.get<{ school: import('@/shared/api').School | null }>(
    '/api/v1/schools/mine',
  ),
};
