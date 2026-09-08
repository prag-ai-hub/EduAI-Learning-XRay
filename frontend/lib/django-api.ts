"use client";

/**
 * Client for the Django REST service.
 *
 * The request logic and the error envelope live in the Expo app at
 * app/src/shared/api, which this imports rather than copies. There is one
 * implementation of the API contract while both clients exist; when the Expo
 * app reaches parity this file goes away with the rest of frontend/. What stays here is the part only a browser
 * can do: read the config this app serves, and hold a Supabase session.
 *
 * The browser calls Django directly rather than proxying through Next.js: the
 * two are separate deployments, and a proxy would put every request through a
 * Worker for no benefit.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ApiError, createApiClient } from "../../app/src/shared/api";

export { ApiError };
export type { School, Paginated } from "../../app/src/shared/api";

type AuthConfig = { url: string; publishableKey: string; djangoApiUrl: string };

let configPromise: Promise<AuthConfig> | null = null;
let client: SupabaseClient | null = null;

/** Cached: every page would otherwise refetch the same static config. */
function loadConfig(): Promise<AuthConfig> {
  configPromise ??= fetch("/api/auth/config", { cache: "no-store" }).then(async response => {
    const body = await response.json();
    if (!response.ok) {
      throw new ApiError(body.error || "Authentication is not configured.", response.status);
    }
    return body as AuthConfig;
  });
  return configPromise;
}

async function supabase(): Promise<SupabaseClient> {
  const config = await loadConfig();
  client ??= createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

/** The current Supabase access token, or null when signed out. */
export async function accessToken(): Promise<string | null> {
  const { data } = await (await supabase()).auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Built per call rather than once: the base URL arrives asynchronously from
 * /api/auth/config, so there is nothing to construct at module load.
 */
async function client_(): Promise<ReturnType<typeof createApiClient>> {
  const { djangoApiUrl } = await loadConfig();
  return createApiClient({ baseUrl: djangoApiUrl, getToken: accessToken });
}

export const djangoApi = {
  get: async <T,>(path: string): Promise<T> => (await client_()).get<T>(path),
  post: async <T,>(path: string, payload?: unknown): Promise<T> =>
    (await client_()).post<T>(path, payload),
};

/** Whether the Django service is configured for this environment at all. */
export async function djangoApiAvailable(): Promise<boolean> {
  try {
    return Boolean((await loadConfig()).djangoApiUrl);
  } catch {
    return false;
  }
}
