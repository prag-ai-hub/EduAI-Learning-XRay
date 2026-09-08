/**
 * Does a Supabase session survive on every platform this app ships to?
 *
 * Run:  node --test "src/shared/api/__tests__/*.test.cjs"   (from app/)
 *
 * `app/` has no test runner and does not need one for this: the runner is
 * node:test, which ships with Node, so nothing is added to package.json and no
 * other suite gets slower. The file is CommonJS because it installs a
 * `require` hook to compile the real TypeScript sources - there is no second
 * copy of the adapter here, `@/shared/api/supabase` and `@/shared/storage` are
 * loaded verbatim.
 *
 * What is faked is only the platform underneath them:
 *
 *   expo-secure-store  - the real module is a thin wrapper that forwards to the
 *                        native binding `ExpoSecureStore`. On web that binding
 *                        is literally `export default {}` (see
 *                        node_modules/expo-secure-store/src/ExpoSecureStore.web.ts),
 *                        so every call lands on `undefined(...)`. The web stub
 *                        below reproduces exactly that; the native stub is an
 *                        in-memory keychain that enforces the real ~2 KB
 *                        per-value ceiling.
 *   react-native       - Platform.OS, the switch both stubs are chosen by.
 *   window             - present for web, absent for native.
 *   fetch              - Supabase's /auth/v1/user and /auth/v1/logout, so a
 *                        session can be established and dropped with no network.
 *
 * supabase-js itself is the real package, and it is supabase-js that calls
 * getItem/setItem on the adapter under test.
 */

// This file runs under Node, never in a bundle; eslint-config-expo's globals
// are the React Native ones, so the two Node globals used here are declared.
/* global __dirname, Buffer */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const ts = require('typescript');

const APP_ROOT = path.resolve(__dirname, '../../../..');
const SRC_ROOT = path.join(APP_ROOT, 'src');

// ---------------------------------------------------------------------------
// Loading the real sources
// ---------------------------------------------------------------------------

Module._extensions['.ts'] = (module_, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      isolatedModules: true,
    },
  });
  module_._compile(outputText, filename);
};

/** Set per scenario; consulted by the _load hook below. */
let stubs = {};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (Object.hasOwn(stubs, request)) return stubs[request];
  if (request.startsWith('@/')) {
    const base = path.join(SRC_ROOT, request.slice(2));
    for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
      if (fs.existsSync(candidate)) return originalLoad.call(this, candidate, parent, isMain);
    }
  }
  return originalLoad.call(this, request, parent, isMain);
};

function forgetAppModules() {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(SRC_ROOT)) delete require.cache[key];
  }
}

// ---------------------------------------------------------------------------
// The platform stubs
// ---------------------------------------------------------------------------

/**
 * Mirrors expo-secure-store: the exported functions forward to the native
 * binding. `binding` is `{}` on web, which is the whole bug.
 */
function secureStoreStub(binding) {
  return {
    getItemAsync: async (key, options = {}) => binding.getValueWithKeyAsync(key, options),
    setItemAsync: async (key, value, options = {}) =>
      binding.setValueWithKeyAsync(value, key, options),
    deleteItemAsync: async (key, options = {}) => binding.deleteValueWithKeyAsync(key, options),
  };
}

/** The iOS keychain / Android keystore, including the limit that forced chunking. */
function keychain() {
  const values = new Map();
  return {
    values,
    binding: {
      async getValueWithKeyAsync(key) {
        return values.has(key) ? values.get(key) : null;
      },
      async setValueWithKeyAsync(value, key) {
        if (Buffer.byteLength(value, 'utf8') > 2048) {
          throw new Error(`Value being stored in SecureStore is too large (${value.length})`);
        }
        values.set(key, value);
      },
      async deleteValueWithKeyAsync(key) {
        values.delete(key);
      },
    },
  };
}

function webStorageArea() {
  const values = new Map();
  return {
    values,
    area: {
      getItem: (key) => (values.has(key) ? values.get(key) : null),
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    },
  };
}

const fileSystemStub = {
  Directory: class {
    get exists() {
      return true;
    }
    create() {}
  },
  File: class {
    get exists() {
      return false;
    }
  },
  Paths: { document: path.join(APP_ROOT, '.node-test-not-used') },
};

// ---------------------------------------------------------------------------
// A session, and the auth server that hands it over
// ---------------------------------------------------------------------------

const PROJECT_URL = 'https://abcdefghijklm.supabase.co';
const STORAGE_KEY = 'sb-abcdefghijklm-auth-token';

/**
 * auth-js validates every JWT segment against a base64url regex that rejects a
 * length of 4n+1, so the JSON is padded with insignificant whitespace until the
 * encoding lands on a length the regex accepts.
 */
function base64url(value) {
  let json = JSON.stringify(value);
  let encoded = Buffer.from(json).toString('base64url');
  while (encoded.length % 4 === 1) {
    json += ' ';
    encoded = Buffer.from(json).toString('base64url');
  }
  return encoded;
}

/**
 * `padding` exists to push the stored session past 2048 bytes, which is what
 * makes the native case a real test rather than a lucky small write.
 */
function jwt(padding = '') {
  const payload = {
    sub: '11111111-2222-3333-4444-555555555555',
    email: 'teacher@example.school',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
    padding,
  };
  return `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url(payload)}.c2lnbmF0dXJl`;
}

const USER = {
  id: '11111111-2222-3333-4444-555555555555',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'teacher@example.school',
  app_metadata: {},
  user_metadata: {},
  created_at: new Date().toISOString(),
};

/** Answers the two auth endpoints these tests reach; anything else is a bug in the test. */
function authServerFetch() {
  return async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/auth/v1/user')) {
      return new Response(JSON.stringify(USER), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/auth/v1/logout')) return new Response(null, { status: 204 });
    throw new Error(`unexpected request in test: ${url}`);
  };
}

// ---------------------------------------------------------------------------
// Scenario setup
// ---------------------------------------------------------------------------

/** @param {'web' | 'native'} platform */
function bootstrap(platform) {
  forgetAppModules();

  const web = platform === 'web';
  const secure = keychain();
  const session = webStorageArea();
  const local = webStorageArea();

  stubs = {
    'react-native': { Platform: { OS: web ? 'web' : 'ios' } },
    'react-native-url-polyfill/auto': {},
    'expo-secure-store': secureStoreStub(web ? {} : secure.binding),
    'expo-file-system': fileSystemStub,
  };

  if (web) {
    globalThis.window = { sessionStorage: session.area, localStorage: local.area };
  } else {
    delete globalThis.window;
  }

  process.env.EXPO_PUBLIC_SUPABASE_URL = PROJECT_URL;
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';

  const originalFetch = globalThis.fetch;
  globalThis.fetch = authServerFetch();

  const loaded = require('@/shared/api/supabase');

  return {
    ...loaded,
    sessionStorage: session.values,
    localStorage: local.values,
    keychain: secure.values,
    async cleanup() {
      try {
        await loaded.supabase?.auth.stopAutoRefresh();
      } catch {
        // A client that never initialised has nothing to stop.
      }
      globalThis.fetch = originalFetch;
      delete globalThis.window;
      forgetAppModules();
    },
  };
}

/** Signs in through supabase-js itself, so the write goes through the adapter. */
async function establishSession(supabase, padding = '') {
  const { data, error } = await supabase.auth.setSession({
    access_token: jwt(padding),
    refresh_token: 'refresh-token-for-the-test',
  });
  assert.equal(error, null, `setSession failed: ${error?.message}`);
  assert.ok(data.session, 'setSession returned no session');
  return data.session;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('web: a session written by supabase-js is read back, and accessToken() resolves', async () => {
  const app = bootstrap('web');
  try {
    assert.ok(app.supabase, 'client was not configured');

    const written = await establishSession(app.supabase);

    // supabase-js reached the adapter, and the adapter reached the browser.
    assert.ok(
      app.sessionStorage.has(STORAGE_KEY),
      `nothing under ${STORAGE_KEY}; keys: ${[...app.sessionStorage.keys()].join(', ')}`,
    );

    const { data, error } = await app.supabase.auth.getSession();
    assert.equal(error, null);
    assert.equal(data.session?.access_token, written.access_token);

    assert.equal(await app.accessToken(), written.access_token);
  } finally {
    await app.cleanup();
  }
});

test('web: the session goes to sessionStorage, never to localStorage', async () => {
  const app = bootstrap('web');
  try {
    await establishSession(app.supabase);
    assert.equal(
      app.localStorage.size,
      0,
      'a refresh token in localStorage outlives the tab on a shared school computer',
    );
  } finally {
    await app.cleanup();
  }
});

test('web: a fresh client with no stored session reports no token rather than throwing', async () => {
  const app = bootstrap('web');
  try {
    assert.equal(await app.accessToken(), null);
  } finally {
    await app.cleanup();
  }
});

test('native: a session larger than the keychain limit round-trips in chunks', async () => {
  const app = bootstrap('native');
  try {
    // Two JWTs carrying this much padding put the stored session well past the
    // 2048-byte per-value ceiling the stub enforces.
    const written = await establishSession(app.supabase, 'x'.repeat(3000));

    const chunks = [...app.keychain.keys()].filter((key) => key.startsWith(`${STORAGE_KEY}.`));
    assert.ok(chunks.length > 1, `expected the session to be split; keys: ${chunks.join(', ')}`);
    for (const value of app.keychain.values()) {
      assert.ok(Buffer.byteLength(value, 'utf8') <= 2048);
    }

    const { data, error } = await app.supabase.auth.getSession();
    assert.equal(error, null);
    assert.equal(data.session?.access_token, written.access_token);
    assert.equal(await app.accessToken(), written.access_token);
  } finally {
    await app.cleanup();
  }
});

test('native: no browser storage is touched', async () => {
  const app = bootstrap('native');
  try {
    await establishSession(app.supabase);
    assert.equal(globalThis.window, undefined);
    assert.ok(app.keychain.size > 0);
  } finally {
    await app.cleanup();
  }
});

// Not a regression test for this blocker - it passes against the pre-fix client
// on native too. It is here because `removeItem` is the third of the three
// methods the adapter renames, and an untested one is how a refresh token gets
// left in the keychain after sign-out.
for (const platform of ['web', 'native']) {
  test(`${platform}: local sign-out clears the stored session, chunks included`, async () => {
    const app = bootstrap(platform);
    try {
      await establishSession(app.supabase, 'x'.repeat(3000));
      const store = platform === 'web' ? app.sessionStorage : app.keychain;
      assert.ok(store.size > 0);

      const { error } = await app.supabase.auth.signOut({ scope: 'local' });
      assert.equal(error, null);

      assert.deepEqual([...store.keys()], [], 'a fragment of the session survived sign-out');
      assert.equal(await app.accessToken(), null);
    } finally {
      await app.cleanup();
    }
  });
}
