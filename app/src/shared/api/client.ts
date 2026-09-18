import { ApiError, toApiError } from "./errors";

/**
 * A client for the Django REST service.
 *
 * Deliberately knows nothing about where it runs. The base URL and the access
 * token are passed in, because the web app reads them from a server route and
 * a browser session while the mobile app reads them from the build environment
 * and the device keychain. Everything after that is identical, which is the
 * point of sharing it.
 */

export type ApiClientOptions = {
  /** Root of the Django service. Empty means "not configured here". */
  baseUrl: string;
  /** The caller's Supabase access token, or null when signed out. */
  getToken: () => Promise<string | null>;
  /** Injected so a Worker, a browser and Metro can each supply their own. */
  fetchImpl?: typeof fetch;
};

export type ApiClient = {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, payload?: unknown): Promise<T>;
  /** Partial update. The service uses PATCH, never PUT - see the roster views. */
  patch<T>(path: string, payload?: unknown): Promise<T>;
  /**
   * Named `del` because `delete` is a reserved word and cannot be a shorthand
   * method name here. Some deletes answer 204 (nothing), others 200 with the
   * changed row - `DELETE /students/{id}/` marks a student Inactive and returns
   * them - so the caller names the type it expects.
   */
  del<T>(path: string): Promise<T>;
};

export function createApiClient(options: ApiClientOptions): ApiClient {
  const base = (options.baseUrl || "").replace(/\/$/, "");
  const doFetch = options.fetchImpl ?? fetch;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!base) {
      // Never guess a host: a bearer token sent to whatever resolves is worse
      // than a clear failure.
      throw new ApiError(
        "The analysis service is not configured for this environment.",
        503,
        "not_configured",
      );
    }

    const token = await options.getToken();
    if (!token) throw new ApiError("Please sign in again.", 401, "not_authenticated");

    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(init.headers || {}),
        },
      });
    } catch (cause) {
      throw new ApiError(
        cause instanceof Error ? cause.message : "The network request failed.",
        0,
        "network_error",
      );
    }

    if (response.status === 204) return undefined as T;
    const body = await response.json().catch(() => null);
    if (!response.ok) throw toApiError(response.status, body);
    return body as T;
  }

  return {
    get: <T,>(path: string) => request<T>(path),
    post: <T,>(path: string, payload?: unknown) =>
      request<T>(path, { method: "POST", body: JSON.stringify(payload ?? {}) }),
    patch: <T,>(path: string, payload?: unknown) =>
      request<T>(path, { method: "PATCH", body: JSON.stringify(payload ?? {}) }),
    del: <T,>(path: string) => request<T>(path, { method: "DELETE" }),
  };
}
