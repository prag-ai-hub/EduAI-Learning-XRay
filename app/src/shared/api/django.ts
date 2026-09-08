import { createApiClient } from '@/shared/api';

import { accessToken } from '@/shared/api/supabase';

/**
 * Client for the Django REST service.
 *
 * The request logic and the error envelope come from ../../../shared/api, which
 * the Next.js app imports too - one implementation, so a field renamed in the
 * API cannot be fixed in one client and forgotten in the other.
 *
 * What is specific here is where the two inputs come from: the base URL is
 * baked in at build time by Expo, and the token comes from a session held in
 * the device keychain.
 */

export { ApiError } from '@/shared/api';
export type { Paginated, School, SchoolRegistration } from '@/shared/api';

const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

export const api = createApiClient({ baseUrl, getToken: accessToken });

/** Whether this build points at an analysis service at all. */
export const apiConfigured = Boolean(baseUrl);

export const schools = {
  /** The caller's own school and where its approval stands. */
  mine: () => api.get<{ school: import('@/shared/api').School | null }>(
    '/api/v1/schools/mine',
  ),
};
