"use client";

/**
 * Client for the Django REST service.
 *
 * The browser calls Django directly rather than proxying through Next.js: the
 * two are separate deployments, and a proxy would put every request through a
 * Worker for no benefit. Django's CORS allowlist names this origin, and the
 * Supabase access token is what authenticates the call - Django verifies it and
 * resolves the caller's profile from `public.users`.
 *
 * Nothing here decides authority. The API is the authority; this module only
 * carries the token and unwraps the error envelope.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type AuthConfig = { url:string; publishableKey:string; djangoApiUrl:string };

let configPromise: Promise<AuthConfig> | null = null;
let client: SupabaseClient | null = null;

/** Cached: every page would otherwise refetch the same static config. */
function loadConfig(): Promise<AuthConfig> {
  configPromise ??= fetch("/api/auth/config", { cache: "no-store" }).then(async response => {
    const body = await response.json();
    if (!response.ok) throw new ApiError(body.error || "Authentication is not configured.", response.status);
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

export class ApiError extends Error {
  readonly status:number;
  readonly code:string;
  /** Field-level messages, when the failure was validation. */
  readonly fields:Record<string,string[]>;

  constructor(message:string, status:number, code = "error", fields:Record<string,string[]> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  /** True when signing in again could plausibly help. */
  get isAuthProblem(){ return this.status === 401; }
}

/**
 * Turn Django's `{error:{code,detail}}` envelope into something renderable.
 *
 * `detail` is whatever DRF produced: a string for a permission error, or a
 * map of field to messages for a validation error. Both are flattened to one
 * readable sentence, with the field map kept for form-level display.
 */
function toApiError(status:number, body:unknown): ApiError {
  const envelope = (body as {error?:{code?:string; detail?:unknown}})?.error;
  const detail = envelope?.detail;
  const code = envelope?.code || "error";

  if (typeof detail === "string") return new ApiError(detail, status, code);

  if (detail && typeof detail === "object") {
    const entries = Object.entries(detail as Record<string,unknown>);
    const fields:Record<string,string[]> = {};
    for (const [field, value] of entries) {
      fields[field] = Array.isArray(value) ? value.map(String) : [String(value)];
    }
    const first = entries[0];
    if (first) {
      const [field, value] = first;
      const message = Array.isArray(value) ? String(value[0]) : String(value);
      return new ApiError(field === "detail" ? message : `${message}`, status, code, fields);
    }
  }
  return new ApiError("That request could not be completed.", status, code);
}

async function request<T>(path:string, init:RequestInit = {}): Promise<T> {
  const { djangoApiUrl } = await loadConfig();
  if (!djangoApiUrl) {
    throw new ApiError("This feature is not available yet in this environment.", 503, "not_configured");
  }
  const token = await accessToken();
  if (!token) throw new ApiError("Please sign in again.", 401, "not_authenticated");

  const response = await fetch(`${djangoApiUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });

  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => null);
  if (!response.ok) throw toApiError(response.status, body);
  return body as T;
}

export const djangoApi = {
  get: <T,>(path:string) => request<T>(path),
  post: <T,>(path:string, payload?:unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(payload ?? {}) }),
};

/** Whether the Django service is configured for this environment at all. */
export async function djangoApiAvailable(): Promise<boolean> {
  try { return Boolean((await loadConfig()).djangoApiUrl); }
  catch { return false; }
}
