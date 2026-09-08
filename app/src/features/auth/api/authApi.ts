/**
 * The auth feature's network surface.
 *
 * House rule: a screen or a feature hook never calls `fetch` directly and never
 * imports `@/shared/api/net`. It calls `authFetch` from here, which attaches the
 * bearer token and retries once through a refresh on a 401.
 *
 * The transport itself lives in `@/shared/api/net` rather than in this file,
 * because `@/shared/files` needs it too and `shared/` may not import `features/`.
 * This module is the boundary feature code imports; `net` is the plumbing under
 * it. There is still exactly one implementation.
 */

export {
  apiFetch,
  authFetch,
  authHeaders,
  clearAccessToken,
  currentAccessToken,
  getAccessToken,
  refreshAccessToken,
  setAccessToken,
} from '@/shared/api/net';

export { apiBaseUrl, apiUrl, apiUrlOrNull } from '@/shared/api/net';
