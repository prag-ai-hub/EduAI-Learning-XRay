import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { accessToken } from '@/shared/api/supabase';

/**
 * The one place the app talks to its own `/api/*` routes.
 *
 * The web app wrote `fetch("/api/profile")` everywhere. A relative URL only
 * means something when there is a document to be relative to: on iOS and
 * Android it resolves to nothing and every call fails, while on web it happens
 * to work - which is why the bug hides. Every call site goes through `apiUrl()`
 * here instead. On web it stays relative, so cookies, CORS and the service
 * worker behave exactly as they do today; on native it gets an absolute origin.
 *
 * This module also owns the Supabase access token. The web app kept it in a
 * module-level `let activeAccessToken` inside FunctionalEduAIApp.tsx, written
 * by the auth listener and read by `authFetch`. Two modules cannot share one
 * mutable binding, so the variable lives here and the auth wiring calls
 * `setAccessToken()` - nothing else needs to see the variable.
 *
 * Note the two different services this app talks to:
 *   - these `/api/*` routes  -> app/src/app/api/*+api.ts, served by the Expo
 *     server (Metro in development, the deployed web server in production).
 *     That is what this module addresses.
 *   - the Django analysis service -> app/src/shared/api/django.ts, a different origin
 *     read from EXPO_PUBLIC_API_BASE_URL. Do not route `/api/*` there.
 */

// ---------------------------------------------------------------------------
// Where "/api/..." lives
// ---------------------------------------------------------------------------

/**
 * Resolved once. Metro inlines `process.env.EXPO_PUBLIC_*` at build time and
 * `hostUri` cannot change while the bundle is running, so there is nothing to
 * re-read.
 */
let cachedBase: string | undefined;

function trimBase(value: string | undefined | null): string {
  const trimmed = (value ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : '';
}

/**
 * `hostUri` is the Expo CLI dev server - "192.168.1.5:8081", or a tunnel host.
 * The dev server is also what serves the `+api.ts` routes in development, so it
 * is the right origin for Expo Go and for a development build on a real phone,
 * where "localhost" would mean the phone itself.
 *
 * An explicit port means a LAN/loopback dev server (http); a bare hostname means
 * an Expo tunnel, which is always https.
 */
function devServerBase(hostUri: string): string {
  const host = hostUri
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .split('/')[0]
    .trim();
  if (!host) return '';
  return `${/:\d+$/.test(host) ? 'http' : 'https'}://${host}`;
}

function resolveBase(): string {
  // 1. The deliberate setting: the origin serving this app's own API routes.
  //    Set it to the deployed Expo web origin for a store build.
  const explicit = trimBase(process.env.EXPO_PUBLIC_API_ORIGIN);
  if (explicit) return explicit;

  // 2. Expo Router's own field for the same idea, so a project that configures
  //    `["expo-router", { origin: "https://..." }]` needs no second setting.
  const routerOrigin = Constants.expoConfig?.extra?.router?.origin;
  const fromRouter = trimBase(typeof routerOrigin === 'string' ? routerOrigin : '');
  if (fromRouter) return fromRouter;

  // 3. Development: the machine running `npx expo start`. Verified against
  //    expo-constants 57 - `expoConfig.hostUri` is typed and documented as
  //    "only present during development using @expo/cli", so a production
  //    build simply falls through.
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const fromHost = devServerBase(hostUri);
    if (fromHost) return fromHost;
  }

  // 4. Last resort. EXPO_PUBLIC_API_BASE_URL is the *Django* service in
  //    app/.env.example (http://localhost:8000), which does not serve these
  //    routes - it is tried last, and only helps when a deployment happens to
  //    put both behind one origin. Prefer EXPO_PUBLIC_API_ORIGIN.
  return trimBase(process.env.EXPO_PUBLIC_API_BASE_URL);
}

/** The absolute origin `/api/*` is served from, or "" when web-relative. */
export function apiBaseUrl(): string {
  if (cachedBase === undefined) cachedBase = resolveBase();
  return cachedBase;
}

function isAbsolute(path: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(path);
}

/**
 * "/api/foo" -> a URL this platform can actually fetch.
 *
 * Web keeps the relative path (same-origin request, unchanged cookie and CORS
 * behaviour). Native gets an absolute origin, and throws a message naming the
 * setting when there is none - a silent relative fetch on a phone fails later
 * with an unexplained "Network request failed".
 */
export function apiUrl(path: string): string {
  if (isAbsolute(path)) return path;
  const suffix = path.startsWith('/') ? path : `/${path}`;

  // In the browser, and during a web server render when nothing is configured,
  // relative is both correct and what the app does today.
  if (Platform.OS === 'web' && (typeof window !== 'undefined' || !apiBaseUrl())) {
    return suffix;
  }

  const base = apiBaseUrl();
  if (!base) {
    throw new Error(
      'No API origin for this build. Set EXPO_PUBLIC_API_ORIGIN to the host serving ' +
        'the /api routes of this app, or run against a development server.',
    );
  }
  return `${base}${suffix}`;
}

/** `apiUrl` for places that cannot throw - an <Image> source, say. */
export function apiUrlOrNull(path: string): string | null {
  try {
    return apiUrl(path);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The access token
// ---------------------------------------------------------------------------

/**
 * Owned here, exactly as FunctionalEduAIApp.tsx owned it, so the auth listener
 * and every caller of `authFetch` see the same value. Empty means signed out or
 * not yet known.
 */
let activeAccessToken = '';

/** Called from the Supabase `onAuthStateChange` handler with the new session. */
export function setAccessToken(token: string | null | undefined): void {
  activeAccessToken = token ?? '';
}

/** Called on sign-out. */
export function clearAccessToken(): void {
  activeAccessToken = '';
}

/**
 * The cached token, synchronously. "" when the auth listener has not run yet -
 * prefer `currentAccessToken()` anywhere an await is possible.
 *
 * This replaces the web app's `sessionStorage.getItem("eduai-access-token")`,
 * which has no equivalent on a phone.
 */
export function getAccessToken(): string {
  return activeAccessToken;
}

/**
 * The token to send. Falls back to the Supabase session (keychain-backed on
 * native, and refreshed by supabase-js when expired) so a screen deep-linked
 * into before the auth listener ran still authenticates.
 */
export async function currentAccessToken(): Promise<string> {
  if (activeAccessToken) return activeAccessToken;
  return refreshAccessToken();
}

/**
 * Re-reads the session, ignoring the cache. `getSession()` renews an expired
 * token, which is how a phone left in a pocket for an hour recovers.
 */
export async function refreshAccessToken(): Promise<string> {
  const token = await accessToken().catch(() => null);
  activeAccessToken = token ?? '';
  return activeAccessToken;
}

/** Bearer header for a call site that builds its own headers object. */
export async function authHeaders(
  extra?: Record<string, string>,
): Promise<Record<string, string>> {
  const token = await currentAccessToken();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(extra ?? {}) };
}

// ---------------------------------------------------------------------------
// fetch
// ---------------------------------------------------------------------------

function prepare(init: RequestInit, token: string): RequestInit {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  // `cache: "no-store"` is a browser fetch option; native fetch ignores it, so
  // the same intent is expressed as a header there. Web is left alone on
  // purpose - adding Cache-Control to a browser request would turn same-origin
  // GETs into CORS preflights for no gain.
  if (
    Platform.OS !== 'web' &&
    !headers.has('Cache-Control') &&
    (init.cache === 'no-store' || init.cache === 'no-cache' || init.cache === 'reload')
  ) {
    headers.set('Cache-Control', 'no-cache');
  }

  return { ...init, headers };
}

/** A streamed body cannot be sent twice, so such a request is never retried. */
function isReplayable(init: RequestInit): boolean {
  if (init.body == null) return true;
  return !(typeof ReadableStream !== 'undefined' && init.body instanceof ReadableStream);
}

/**
 * `fetch` for the app's own API, without authentication - `/api/auth/config`,
 * `/api/system-health`, `/api/shares/<token>`.
 */
export function apiFetch(path: string | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(String(path)), prepare(init, ''));
}

/**
 * The replacement for FunctionalEduAIApp's `authFetch`: same behaviour - attach
 * the Supabase access token as a bearer, send nothing extra when signed out -
 * plus an absolute URL on native.
 *
 * The one addition is a single retry after a 401 with a freshly read token. The
 * web app never needed it because a tab is short-lived; a phone app resumes
 * hours later holding a token the auth listener has not yet replaced.
 */
export async function authFetch(
  path: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  const url = apiUrl(String(path));
  const token = await currentAccessToken();
  const response = await fetch(url, prepare(init, token));

  if (response.status !== 401 || !token || !isReplayable(init)) return response;

  const fresh = await refreshAccessToken();
  if (!fresh || fresh === token) return response;
  return fetch(url, prepare(init, fresh));
}

// ---------------------------------------------------------------------------
// Encoding
//
// Hermes has no `btoa` and no `TextEncoder`; Expo SDK 57 installs TextDecoder,
// URL and structuredClone on native but neither of those two (verified in
// expo/src/winter/runtime.native.ts). Anything that reached for them - such as
// base64FromText in FunctionalEduAIApp.tsx, on the live document-upload path -
// crashes on a phone. These work on every runtime: the platform built-in when
// it exists, a pure-JS implementation when it does not.
// ---------------------------------------------------------------------------

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** UTF-8 bytes for a string. The `TextEncoder().encode()` replacement. */
export function utf8Encode(text: string): Uint8Array {
  const Native = (globalThis as { TextEncoder?: typeof TextEncoder }).TextEncoder;
  if (Native) return new Native().encode(text);

  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i++;
      } else {
        code = 0xfffd; // lone high surrogate, as the encoding spec requires
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      code = 0xfffd; // lone low surrogate
    }

    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

/** Standard base64 (padded) for raw bytes. */
export function base64FromBytes(bytes: Uint8Array): string {
  const encode = (globalThis as { btoa?: (input: string) => string }).btoa;
  if (encode) {
    // A megabyte of arguments would overflow the stack, so build the binary
    // string in chunks.
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return encode(binary);
  }

  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const has1 = i + 1 < bytes.length;
    const has2 = i + 2 < bytes.length;
    const b0 = bytes[i];
    const b1 = has1 ? bytes[i + 1] : 0;
    const b2 = has2 ? bytes[i + 2] : 0;
    parts.push(
      BASE64_ALPHABET[b0 >> 2] +
        BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)] +
        (has1 ? BASE64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=') +
        (has2 ? BASE64_ALPHABET[b2 & 0x3f] : '='),
    );
  }
  return parts.join('');
}

/**
 * Base64 of the UTF-8 bytes of a string - the `btoa(TextEncoder)` pair the web
 * app used, in one call that also works on Hermes.
 */
export function base64FromText(text: string): string {
  return base64FromBytes(utf8Encode(text));
}

/**
 * Base64 body of a Blob or File, without the `data:` prefix - what
 * /api/ocr, /api/grade and /api/document-to-pdf-source expect.
 *
 * FileReader is polyfilled by React Native and present in browsers, and is the
 * only route that works for a native Blob (which has no `arrayBuffer()`).
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}
