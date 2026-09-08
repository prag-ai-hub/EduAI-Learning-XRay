import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Device-side key/value storage.
 *
 * The Next.js app used three different browser stores and the choice mattered,
 * because the three things it kept have wildly different size and secrecy
 * profiles. Collapsing them onto one backend breaks at least one of them, so
 * this module keeps three, and every existing key is mapped below.
 *
 *   key                                        web app store   here         why
 *   -----------------------------------------  --------------  -----------  -------------------------------------
 *   eduai-theme                                localStorage    appStore     five bytes, not secret, must persist
 *   eduai-bulk-analysis:{assessmentId}         sessionStorage  appStore     a short array of file ids (~1 KB)
 *   eduai-xray-offline-cache-v1:{userId}       localStorage    bulkStore    the workspace snapshot - up to 4 MB
 *   eduai-learning-xray-files (IndexedDB)      IndexedDB       NOT HERE     10 MB file blobs; see the note below
 *
 * Call sites in the web app, for the record:
 *   frontend/app/ui/FunctionalEduAIApp.tsx:266        access token write/clear
 *   frontend/app/ui/ParentShareDialog.tsx:21          access token read
 *   frontend/app/ui/FunctionalEduAIApp.tsx:319,320    offline cache read/write
 *   frontend/app/ui/FunctionalEduAIApp.tsx:319,326    theme read/write
 *   frontend/app/ui/FunctionalEduAIApp.tsx:1012-1015,1697  bulk analysis queue
 *   frontend/app/ui/FunctionalEduAIApp.tsx:1963       IndexedDB file blob cache
 *
 * Why the 4 MB snapshot cannot go in secureStore: SecureStore caps a single
 * value at roughly 2048 bytes. A 4 MB write does not merely fail slowly, it
 * fails - and the web app's write path is wrapped in a bare `catch {}`, so on a
 * real device the offline cache would look like it worked and be empty on the
 * next launch. src/app/api/workspace+api.ts:75 confirms 4 MB is the real
 * ceiling for this blob, not a guess.
 *
 * Why it does not go in AsyncStorage either, if that package ever arrives:
 * AsyncStorage on Android is SQLite behind an Android CursorWindow, which
 * refuses rows past ~2 MB with "Row too big to fit into CursorWindow", and its
 * whole database defaults to 6 MB (raised only by the
 * `AsyncStorage_db_size_in_MB` Gradle property). A 4 MB value sits on the wrong
 * side of both limits. Multi-megabyte values belong in a file.
 *
 * The IndexedDB blob store is deliberately out of scope. It holds 10 MB binary
 * files keyed by id, which is a file cache, not key/value storage; it belongs in
 * its own module over expo-file-system's File/Directory API.
 */

/** Read/write/delete for one namespace, plus JSON helpers - every existing call site JSON-encodes. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** Returns `fallback` when the key is absent or holds unparseable JSON (a torn write, an old shape). */
  getJson<T>(key: string, fallback: T): Promise<T>;
  setJson(key: string, value: unknown): Promise<void>;
}

type RawStore = Pick<KeyValueStore, 'get' | 'set' | 'remove'>;

const isWeb = Platform.OS === 'web';

function warn(message: string, reason?: unknown): void {
  if (process.env.NODE_ENV !== 'production') console.warn(`[storage] ${message}`, reason ?? '');
}

function withJson(raw: RawStore): KeyValueStore {
  return {
    ...raw,
    async getJson<T>(key: string, fallback: T): Promise<T> {
      const value = await raw.get(key);
      if (value === null) return fallback;
      try {
        return JSON.parse(value) as T;
      } catch (reason) {
        warn(`"${key}" did not hold valid JSON; using the fallback`, reason);
        return fallback;
      }
    },
    setJson(key: string, value: unknown): Promise<void> {
      return raw.set(key, JSON.stringify(value));
    },
  };
}

// ---------------------------------------------------------------------------
// Web
// ---------------------------------------------------------------------------

/**
 * Wraps a Web Storage area. `pick` is called lazily on every access rather than
 * read once, because Expo Router statically renders web routes in Node at build
 * time, where there is no `window` at module-evaluation time.
 */
function webStore(pick: () => Storage, label: string): RawStore {
  // Stands in during static rendering only. Nothing written then is expected to
  // survive to the browser, so losing it is correct rather than merely tolerable.
  const duringStaticRender = new Map<string, string>();

  const area = (): Storage | null => {
    if (typeof window === 'undefined') return null;
    try {
      return pick();
    } catch (reason) {
      // Reading window.localStorage itself throws when the browser is set to
      // block site data.
      warn(`${label} is unavailable`, reason);
      return null;
    }
  };

  return {
    async get(key: string): Promise<string | null> {
      const store = area();
      if (!store) return duringStaticRender.get(key) ?? null;
      try {
        return store.getItem(key);
      } catch (reason) {
        warn(`${label}.getItem("${key}") failed`, reason);
        return null;
      }
    },
    async set(key: string, value: string): Promise<void> {
      const store = area();
      if (!store) {
        duringStaticRender.set(key, value);
        return;
      }
      try {
        store.setItem(key, value);
      } catch (reason) {
        // Safari in private mode, and any origin at its ~5 MB quota, throw
        // here. The 4 MB snapshot is close enough to that quota that this is a
        // live risk on web - but it is a cache whose authority is the server,
        // so a failed write must not break the save that triggered it. Warned,
        // not thrown, and never silent in development.
        warn(`${label}.setItem("${key}") failed - ${value.length} chars, likely over quota`, reason);
      }
    },
    async remove(key: string): Promise<void> {
      const store = area();
      if (!store) {
        duringStaticRender.delete(key);
        return;
      }
      try {
        store.removeItem(key);
      } catch (reason) {
        warn(`${label}.removeItem("${key}") failed`, reason);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Native: keychain
// ---------------------------------------------------------------------------

/**
 * SecureStore rejects a value over roughly 2048 bytes, so values are split and
 * reassembled. 1600 is a deliberate margin: the limit is on bytes and the split
 * below measures UTF-8 bytes, so the margin only has to cover the key overhead.
 */
const SECURE_CHUNK_BYTES = 1600;

/**
 * Marks a base key as holding a chunk count rather than a value. The leading NUL prefix
 * cannot begin a JWT or JSON.stringify output, so a value written before
 * this module existed is still readable: it just does not carry the marker.
 */
const CHUNK_MARKER = '\0eduai.chunks:';

/** SecureStore keys must match /^[\w.-]+$/ - a ":" in a key is rejected at runtime, not compile time. */
const SECURE_KEY = /^[A-Za-z0-9._-]+$/;

function utf8Size(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/** Splits on code-point boundaries so a surrogate pair is never cut in half. */
function splitByUtf8Bytes(value: string, maxBytes: number): string[] {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const character of value) {
    const size = utf8Size(character.codePointAt(0) ?? 0);
    if (bytes + size > maxBytes && current.length > 0) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += character;
    bytes += size;
  }
  parts.push(current);
  return parts;
}

function requireSecureKey(key: string): void {
  if (!SECURE_KEY.test(key)) {
    throw new Error(
      `secureStore keys may only contain letters, digits, ".", "-" and "_" (got "${key}"). ` +
        'A key built from an id with a ":" separator belongs in appStore or bulkStore.',
    );
  }
}

/** The chunk count a base key currently advertises, or 0 if it holds no marker. */
async function storedChunkCount(key: string): Promise<number> {
  const head = await SecureStore.getItemAsync(key);
  if (head === null || !head.startsWith(CHUNK_MARKER)) return 0;
  const count = Number(head.slice(CHUNK_MARKER.length));
  return Number.isInteger(count) && count > 0 ? count : 0;
}

/** Applies the SecureStore key rule on every platform, so a bad key fails the same way everywhere. */
function guardKeys(raw: RawStore): RawStore {
  return {
    get: (key) => {
      requireSecureKey(key);
      return raw.get(key);
    },
    set: (key, value) => {
      requireSecureKey(key);
      return raw.set(key, value);
    },
    remove: (key) => {
      requireSecureKey(key);
      return raw.remove(key);
    },
  };
}

const nativeSecureStore: RawStore = {
  async get(key: string): Promise<string | null> {
    const head = await SecureStore.getItemAsync(key);
    if (head === null) return null;
    if (!head.startsWith(CHUNK_MARKER)) return head;
    const count = Number(head.slice(CHUNK_MARKER.length));
    if (!Number.isInteger(count) || count < 1) return null;
    const parts = await Promise.all(
      Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(`${key}.${i}`)),
    );
    // A missing chunk means a half-finished write or a partial wipe. Reporting
    // a truncated token would be worse than reporting none.
    return parts.some((part) => part === null) ? null : parts.join('');
  },

  async set(key: string, value: string): Promise<void> {
    const previousCount = await storedChunkCount(key);
    const parts = splitByUtf8Bytes(value, SECURE_CHUNK_BYTES);
    // Chunks first, header last: a crash mid-write leaves the previous header
    // pointing at a complete previous value rather than at a half-written one.
    await Promise.all(parts.map((part, i) => SecureStore.setItemAsync(`${key}.${i}`, part)));
    await SecureStore.setItemAsync(key, `${CHUNK_MARKER}${parts.length}`);
    // A shorter value leaves the tail chunks of the longer one behind. `get`
    // would ignore them, but they are fragments of a live secret sitting in the
    // keychain indefinitely, so they are cleared once the header no longer
    // refers to them.
    if (previousCount > parts.length) {
      await Promise.all(
        Array.from({ length: previousCount - parts.length }, (_, i) =>
          SecureStore.deleteItemAsync(`${key}.${parts.length + i}`),
        ),
      );
    }
  },

  async remove(key: string): Promise<void> {
    const count = await storedChunkCount(key);
    await Promise.all(
      Array.from({ length: count }, (_, i) => SecureStore.deleteItemAsync(`${key}.${i}`)),
    );
    await SecureStore.deleteItemAsync(key);
  },
};

// ---------------------------------------------------------------------------
// Native: files
// ---------------------------------------------------------------------------

/**
 * One file per key, under Paths.document.
 *
 * expo-file-system is a direct dependency of `expo` itself, so it is present in
 * every SDK 57 app. This is the SDK 54+ API - File/Directory/Paths - not the
 * removed readAsStringAsync/documentDirectory functions.
 *
 * Paths.document, not Paths.cache: the offline snapshot is written precisely
 * when the workspace could not reach the server, so it can hold the only copy
 * of a teacher's work. The OS may evict Paths.cache under storage pressure,
 * which would discard exactly that. The cost is that iOS backs Documents up to
 * iCloud; for unsynced user work that is the right trade.
 */

/**
 * Keys carry ":" and user ids, which are not safe filename characters
 * everywhere. Every character outside [A-Za-z0-9._-] becomes "~" plus exactly
 * four hex digits; a fixed width keeps the mapping injective, so two keys can
 * never land on one file. Decoding is never needed - the key is the input.
 */
function encodeFileName(key: string): string {
  return key.replace(
    /[^A-Za-z0-9._-]/g,
    (character) => `~${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/** Makes each in-flight temp filename unique even within one millisecond. */
let tempSequence = 0;

function nativeFileStore(folder: string): RawStore {
  const directory = (): Directory => {
    const target = new Directory(Paths.document, 'eduai-storage', folder);
    if (!target.exists) target.create({ intermediates: true, idempotent: true });
    return target;
  };
  const fileFor = (key: string): File => new File(directory(), `${encodeFileName(key)}.json`);

  return {
    async get(key: string): Promise<string | null> {
      try {
        const file = fileFor(key);
        if (!file.exists) return null;
        return await file.text();
      } catch (reason) {
        warn(`could not read "${key}" from ${folder}`, reason);
        return null;
      }
    },

    async set(key: string, value: string): Promise<void> {
      // Nulled once the move succeeds, because moveSync repoints the instance's
      // uri at the destination - deleting it after that would delete the value.
      let temporary: File | null = null;
      try {
        const parent = directory();
        const encoded = encodeFileName(key);
        // Write to a sibling and move it into place. A 4 MB write is not
        // instant, and a process killed halfway through a direct write leaves a
        // truncated file - which parses as nothing and silently discards the
        // previous good snapshot. moveSync(overwrite) swaps it in as one step.
        // The counter disambiguates two writes inside the same millisecond.
        temporary = new File(parent, `${encoded}.${Date.now()}-${tempSequence++}.tmp`);
        temporary.create({ overwrite: true, intermediates: true });
        temporary.write(value);
        temporary.moveSync(new File(parent, `${encoded}.json`), { overwrite: true });
        temporary = null;
      } catch (reason) {
        warn(`could not write "${key}" to ${folder} - ${value.length} chars`, reason);
        // A write or move that failed leaves the sibling behind. Left alone
        // these accumulate at multi-megabyte sizes on a device that is already
        // short of space, which is the usual reason the write failed.
        try {
          if (temporary?.exists) temporary.delete();
        } catch {
          // Nothing further to try; the file is already only wasted space.
        }
      }
    },

    async remove(key: string): Promise<void> {
      try {
        const file = fileFor(key);
        if (file.exists) file.delete();
      } catch (reason) {
        warn(`could not delete "${key}" from ${folder}`, reason);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The three stores
// ---------------------------------------------------------------------------

/**
 * Secrets. Native: the iOS keychain / Android keystore, chunked past the ~2 KB
 * per-value limit.
 *
 * Web: sessionStorage, which is what the Next.js app already used for the
 * access token - a browser has no keychain, and sessionStorage at least scopes
 * the token to the tab and drops it when the tab closes. Values here are
 * therefore genuinely less protected on web than on a device; nothing bigger or
 * more sensitive than a short-lived bearer token should be put in it.
 *
 * Small values only. Every kilobyte costs another keychain round trip.
 */
export const secureStore: KeyValueStore = withJson(
  // The key charset is checked on web too, though sessionStorage would accept
  // anything. Only SecureStore imposes it, so without this a key containing ":"
  // would work all through web development and throw on the first device.
  guardKeys(isWeb ? webStore(() => window.sessionStorage, 'sessionStorage') : nativeSecureStore),
);

/**
 * Small, non-secret, durable values - preferences and short queues.
 *
 * Web: localStorage, matching the web app. Native: a file per key.
 *
 * @react-native-async-storage/async-storage is NOT installed in this project
 * (absent from app/package.json and from node_modules), and a static import of
 * a missing module fails the Metro build outright - a try/catch around it does
 * not help, because resolution happens at bundle time. The file-backed store is
 * used instead: same contract, durable, no new dependency. If the package is
 * added later, swap `nativeFileStore('app')` below for an AsyncStorage adapter
 * and nothing else changes. Do NOT do the same to bulkStore - see its note.
 */
export const appStore: KeyValueStore = withJson(
  isWeb ? webStore(() => window.localStorage, 'localStorage') : nativeFileStore('app'),
);

/**
 * Multi-megabyte values: today just the workspace snapshot, which the workspace
 * API caps at 4 MB.
 *
 * Native: always a file. Not SecureStore (~2 KB per value) and not AsyncStorage
 * even once it exists (Android CursorWindow refuses rows past ~2 MB, and the
 * default database is 6 MB in total).
 *
 * Web: localStorage, as the web app does. That is the largest synchronous store
 * a browser offers without IndexedDB, but its quota is only about 5 MB per
 * origin, so a snapshot near the 4 MB ceiling can be refused. The failure is
 * warned about and swallowed: the server copy is authoritative, and the cache
 * being cold is recoverable where a crashed save is not. Moving this to
 * IndexedDB on web is the fix if snapshots grow.
 */
export const bulkStore: KeyValueStore = withJson(
  isWeb ? webStore(() => window.localStorage, 'localStorage') : nativeFileStore('bulk'),
);

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/**
 * The key strings, verbatim from the web app. They are shared with it through
 * the database-backed workspace, so renaming one here would strand data.
 */
// The access token is deliberately absent. It is owned by @/shared/api/net
// (getAccessToken / currentAccessToken), and the whole Supabase session -
// access token included - is already persisted to SecureStore by
// @/shared/api/supabase. A second copy here would never be refreshed: a
// stale bearer JWT sitting in the keychain with no expiry management.
export const StorageKeys = {
  /** appStore. "dark" | "light". */
  theme: 'eduai-theme',
  /** appStore. The file ids still queued for bulk analysis on one assessment. */
  bulkAnalysisQueue: (assessmentId: string) => `eduai-bulk-analysis:${assessmentId}`,
  /** bulkStore. The offline workspace snapshot for one user - up to 4 MB. */
  offlineCache: (userId: string) => `eduai-xray-offline-cache-v1:${userId}`,
} as const;
