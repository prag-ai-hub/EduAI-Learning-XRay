import { Directory, File as FsFile, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { authFetch, base64FromBytes, blobToBase64 } from '@/shared/api/net';

/**
 * The answer-sheet blob store.
 *
 * This replaces the eight functions the Next.js app kept at the bottom of
 * FunctionalEduAIApp.tsx (openFileDb / saveLocalFileBlob / readLocalFileBlob /
 * removeLocalFileBlob / saveFileBlob / readFileBlob / removeFileBlob, plus the
 * seven scattered `URL.createObjectURL` pairs). Call sites in the web app, for
 * the record:
 *
 *   frontend/app/ui/FunctionalEduAIApp.tsx:1963-1976  the store itself
 *   frontend/app/ui/FunctionalEduAIApp.tsx:508        preview URL for the source pane
 *   frontend/app/ui/FunctionalEduAIApp.tsx:1243-1261  base64 for /api/grade
 *   frontend/app/ui/FunctionalEduAIApp.tsx:1857-1873  bytes for the corrected-copy PDF
 *   frontend/app/ui/FunctionalEduAIApp.tsx:1938-1951  preview / download / convert
 *
 * ---------------------------------------------------------------------------
 * The contract this must not break
 * ---------------------------------------------------------------------------
 *
 * src/app/api/files/[id]+api.ts is already ported and is the authority:
 *
 *   PUT    /api/files/{id}   body = the raw file bytes, nothing wrapping them.
 *                            The route does `await request.blob()`, rejects
 *                            anything outside 1 byte..10 MB, and stores
 *                            `await blob.arrayBuffer()` under the *request's*
 *                            Content-Type header.
 *   GET    /api/files/{id}   returns those bytes with that content type.
 *   DELETE /api/files/{id}
 *
 * So the upload body is raw bytes and the Content-Type header is load-bearing -
 * it is what the stored object is later served as. Anything that wraps the
 * bytes (multipart/form-data, a JSON envelope, expo-file-system's
 * UploadType.MULTIPART) stores multipart framing as if it were the PDF and
 * corrupts every file. Both platforms below therefore send a plain
 * `PUT` with the bytes as the body, through `authFetch` so the bearer token and
 * the 401-refresh retry are identical to every other call in the app.
 *
 * ---------------------------------------------------------------------------
 * Why one file with Platform branching rather than a .web/.native split
 * ---------------------------------------------------------------------------
 *
 * `tsc --noEmit` does not resolve React Native's platform extensions (no
 * `moduleSuffixes` is configured), so a .web.ts/.native.ts pair typechecks only
 * one of its halves. src/shared/storage/index.ts already settled this question for this
 * codebase - one module, `Platform.OS` branches, both halves compiled. The two
 * backends are:
 *
 *   web     IndexedDB, database "eduai-learning-xray-files" v1, object store
 *           "files", Blob keyed by id. Byte-for-byte the schema the Next.js app
 *           writes today, deliberately unversioned-up so an existing browser
 *           profile keeps its cache. Display URIs are `URL.createObjectURL`.
 *   native  expo-file-system. This is SDK 57: File / Directory / Paths from the
 *           package root, NOT the readAsStringAsync / documentDirectory
 *           functions removed in SDK 54. Display URIs are the `file://` URI,
 *           which <Image>, <WebView> and expo-sharing all accept.
 *
 * expo-file-system is imported unconditionally, as storage.ts does. It is a
 * direct dependency of `expo` itself so it is always installed, and its web
 * build (build/ExpoFileSystem.web.d.ts) is a stub whose File/Directory
 * constructors do nothing - which is exactly why web must use IndexedDB, and is
 * safe to import because nothing below touches it on web.
 *
 * ---------------------------------------------------------------------------
 * Why the portable type is not `Blob`
 * ---------------------------------------------------------------------------
 *
 * React Native's Blob cannot be built from bytes. BlobManager.createFromParts
 * (app/node_modules/react-native/Libraries/Blob/BlobManager.js:70) throws
 * "Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are not supported",
 * so `new Blob([bytesReadFromDisk])` is a runtime error on a phone however
 * well it typechecks. A native Blob also has no `arrayBuffer()`. The portable
 * currency here is therefore `StoredFile` - an accessor object - and callers
 * ask it for bytes, base64, text or a URI rather than for a Blob.
 *
 * ---------------------------------------------------------------------------
 * Using it
 * ---------------------------------------------------------------------------
 *
 *   await saveFile(id, pickedFile);              // upload + cache
 *   const base64 = await readFileBase64(id);     // for /api/grade, /api/ocr
 *   const bytes  = await readFileBytes(id);      // for pdf.js, the %PDF- check
 *   await deleteFile(id);
 *
 * A display URI owns a resource on web and must be handed back, which is what
 * the seven createObjectURL/revokeObjectURL pairs were doing by hand:
 *
 *   useEffect(() => {
 *     let active = true;
 *     let handle: OpenFile | null = null;
 *     openFile(id).then((opened) => {
 *       if (!active) return opened?.release();
 *       handle = opened;
 *       setUri(opened?.uri ?? '');
 *     });
 *     return () => { active = false; handle?.release(); };
 *   }, [id]);
 *
 * `release()` revokes the object URL on web and is a no-op on native.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * What can be handed to `saveFile`.
 *
 * - `Blob`             a browser `File` from an <input type="file">, or a
 *                      generated document (jsPDF's `pdf.output("blob")`).
 * - `{ uri }`          what expo-document-picker and expo-image-picker return.
 * - `{ bytes }`        anything already produced in memory - fflate output, a
 *                      PDF assembled on device.
 *
 * `type` is the MIME type to store the file as. It is optional only because a
 * Blob already carries one; supply it for the other two, or the file comes back
 * as application/octet-stream and previews cannot tell an image from a PDF.
 */
export type FileSource =
  | Blob
  | { uri: string; type?: string }
  | { bytes: Uint8Array; type?: string };

/** A URI something can actually render, and the obligation to give it back. */
export interface OpenFile {
  /** `blob:` on web, `file://` on native. */
  readonly uri: string;
  readonly type: string;
  readonly size: number;
  /** Revokes the object URL on web. A no-op on native. Safe to call twice. */
  release(): void;
}

/** A file in the store, and every shape the app reads one in. */
export interface StoredFile {
  readonly id: string;
  /** The stored MIME type, never empty - `application/octet-stream` when unknown. */
  readonly type: string;
  readonly size: number;
  bytes(): Promise<Uint8Array<ArrayBuffer>>;
  /** Base64 with no `data:` prefix - what /api/grade, /api/ocr and /api/document-to-pdf-source want. */
  base64(): Promise<string>;
  text(): Promise<string>;
  /** `data:<type>;base64,<...>` - for an <img src> or embedded HTML. */
  dataUri(): Promise<string>;
  /**
   * A renderable URI, or null when the bytes are only in memory because the
   * device could not be written to. Caller must `release()` it.
   */
  open(): OpenFile | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const isWeb = Platform.OS === 'web';

/** Unchanged from the Next.js app so an existing browser profile keeps its cache. */
const DB_NAME = 'eduai-learning-xray-files';
const DB_VERSION = 1;
const STORE = 'files';

/** Mirrors the ceiling src/app/api/files/[id]+api.ts enforces, so the check happens before a 10 MB upload. */
const MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_TYPE = 'application/octet-stream';

function apiPath(id: string): string {
  return `/api/files/${encodeURIComponent(id)}`;
}

function warn(message: string, reason?: unknown): void {
  if (process.env.NODE_ENV !== 'production') console.warn(`[files] ${message}`, reason ?? '');
}

/**
 * The route derives the id from the last path segment, so a "/" in an id would
 * silently address a different object. Length matches its own 300-char check.
 */
function requireId(id: string): void {
  if (!id) throw new Error('A file id is required.');
  if (id.length > 300) throw new Error('File ids are limited to 300 characters.');
  if (id.includes('/')) throw new Error(`File ids may not contain "/" (got "${id}").`);
}

function guardSize(size: number): void {
  if (!size) throw new Error('The file is empty; there is nothing to upload.');
  if (size > MAX_BYTES) throw new Error('Files must be between 1 byte and 10 MB.');
}

/** Content-Type may carry parameters ("text/plain; charset=utf-8"); they are kept, only emptiness is replaced. */
function normalizeType(type: string | null | undefined): string {
  return (type ?? '').trim() || DEFAULT_TYPE;
}

// ---------------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------------

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * The inverse of net.ts's `base64FromBytes`. Hermes has no `atob`, so the
 * pure-JS path is the one that runs on a phone.
 */
export function bytesFromBase64(base64: string): Uint8Array<ArrayBuffer> {
  // Translate the urlsafe alphabet before stripping: '-' and '_' are 62 and 63,
  // not padding. Dropping them decodes to different bytes with no error.
  const clean = base64.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');

  const decode = (globalThis as { atob?: (input: string) => string }).atob;
  if (decode) {
    const binary = decode(clean);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  // Padding was stripped above, so floor(length * 3 / 4) is the exact byte count.
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let offset = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = BASE64_ALPHABET.indexOf(clean[i]);
    const c1 = BASE64_ALPHABET.indexOf(clean[i + 1] ?? 'A');
    const c2 = i + 2 < clean.length ? BASE64_ALPHABET.indexOf(clean[i + 2]) : -1;
    const c3 = i + 3 < clean.length ? BASE64_ALPHABET.indexOf(clean[i + 3]) : -1;
    if (offset < out.length) out[offset++] = ((c0 & 0x3f) << 2) | ((c1 & 0x3f) >> 4);
    if (c2 >= 0 && offset < out.length) out[offset++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
    if (c3 >= 0 && offset < out.length) out[offset++] = ((c2 & 0x03) << 6) | c3;
  }
  return offset === out.length ? out : out.slice(0, offset);
}

/** UTF-8 text from bytes. Expo SDK 57 installs TextDecoder on native; the fallback covers a runtime that does not. */
function utf8Decode(bytes: Uint8Array<ArrayBuffer>): string {
  const Decoder = (globalThis as { TextDecoder?: typeof TextDecoder }).TextDecoder;
  if (Decoder) return new Decoder().decode(bytes);

  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return out;
}

/**
 * Bytes from a Blob on either platform.
 *
 * `Blob.arrayBuffer()` is the web path. React Native's Blob does not have it,
 * so native goes through FileReader - and `readAsDataURL` rather than
 * `readAsArrayBuffer`, because that is the method RN has always implemented
 * (Libraries/Blob/FileReader.js).
 */
function blobBytes(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  }
  return new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve(bytesFromBase64(result.slice(result.indexOf(',') + 1)));
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Bytes from a fetch Response.
 *
 * `Response.arrayBuffer()` works on native in this project: whatwg-fetch routes
 * it through FileReader.readAsArrayBuffer, which RN 0.86 implements by decoding
 * a data URL (Libraries/Blob/FileReader.js:74-102). Verified against
 * app/node_modules/react-native rather than assumed - in older React Native
 * that method threw.
 */
async function responseBytes(response: Response): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await response.arrayBuffer());
}

// ---------------------------------------------------------------------------
// The network side - identical on both platforms
// ---------------------------------------------------------------------------

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload?.error === 'string' && payload.error) return payload.error;
  } catch {
    // A non-JSON error body (a proxy's HTML 502) tells the user nothing useful.
  }
  return fallback;
}

/**
 * The one upload. Raw bytes as the body and the MIME type as Content-Type,
 * because that header is what the route persists the object as.
 *
 * `body` is a Blob on web and a Uint8Array on native. React Native's fetch
 * accepts a typed array: whatwg-fetch keeps it as `_bodyInit`, and
 * convertRequestBody.js base64-encodes it for the native networking module,
 * which writes the decoded bytes as the body - no framing, no wrapper.
 */
async function upload(id: string, body: Blob | Uint8Array<ArrayBuffer>, type: string): Promise<void> {
  const response = await authFetch(apiPath(id), {
    method: 'PUT',
    headers: { 'Content-Type': type },
    body,
  });
  if (!response.ok) throw new Error(await errorMessage(response, 'Cloud file upload failed'));
}

/** Null for "not there" - a 404 for a file already deleted is not an error worth throwing. */
async function download(id: string): Promise<Response | null> {
  try {
    const response = await authFetch(apiPath(id), { cache: 'no-store' });
    return response.ok ? response : null;
  } catch (reason) {
    warn(`could not download "${id}" from secure storage`, reason);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Web: IndexedDB
// ---------------------------------------------------------------------------

function openDb(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    // Another tab holding an older version open would otherwise leave this
    // promise pending forever, hanging every read behind it.
    request.onblocked = () => reject(new Error('Another tab is holding the file cache open.'));
  });
}

async function webReadLocal(id: string): Promise<Blob | null> {
  const db = await openDb();
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(id);
      request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function webWriteLocal(id: string, blob: Blob): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      // A write over the origin's quota aborts rather than erroring. The
      // Next.js app listened only for onerror, so a full cache left the promise
      // pending and the upload dialog stuck on "Saving securely" forever.
      tx.onabort = () => reject(tx.error ?? new Error('The browser refused to cache the file.'));
    });
  } finally {
    db.close();
  }
}

async function webDeleteLocal(id: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('The browser refused to update the file cache.'));
    });
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Native: expo-file-system
// ---------------------------------------------------------------------------

/**
 * Paths.cache, not Paths.document - the opposite of the choice storage.ts makes
 * for the offline workspace snapshot, and for the opposite reason. This is a
 * cache whose authority is Supabase Storage: the file was uploaded before it
 * was ever written here, so the OS evicting it under storage pressure costs a
 * re-download, not data. Keeping 10 MB answer sheets out of Documents also
 * keeps them out of the device's iCloud backup.
 */
function cacheDirectory(): Directory {
  const target = new Directory(Paths.cache, 'eduai-files');
  if (!target.exists) target.create({ intermediates: true, idempotent: true });
  return target;
}

/**
 * Ids are `f<uuid>` today but arrive from the server too. Every character
 * outside [A-Za-z0-9._-] becomes "~" plus four hex digits - fixed width, so the
 * mapping stays injective and two ids can never collide on one file. The same
 * scheme storage.ts uses. "/" is escaped by it, and a suffix is always
 * appended, so no id can escape the directory.
 */
function encodeFileName(id: string): string {
  return id.replace(
    /[^A-Za-z0-9._-]/g,
    (character) => `~${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

/** Makes each in-flight temp filename unique even within one millisecond. */
let tempSequence = 0;

/**
 * The bytes, plus a sibling holding the MIME type.
 *
 * The type has to be stored: filenames here are opaque ids, so `FsFile.type`
 * (which is derived from the extension) would report nothing useful, and a
 * preview screen has no way to tell a JPEG from a PDF without it.
 */
function nativeWriteLocal(id: string, bytes: Uint8Array<ArrayBuffer>, type: string): void {
  const parent = cacheDirectory();
  const encoded = encodeFileName(id);

  // Nulled once the move succeeds, because moveSync repoints the instance's uri
  // at the destination - deleting it after that would delete the cached file.
  let temporary: FsFile | null = null;
  try {
    // Write to a sibling and move it into place. A process killed part-way
    // through a direct 10 MB write leaves a truncated file that still passes
    // `exists`, and the app would serve half a PDF from cache in preference to
    // the intact cloud copy. moveSync swaps it in as one step.
    temporary = new FsFile(parent, `${encoded}.${Date.now()}-${tempSequence++}.tmp`);
    temporary.create({ overwrite: true, intermediates: true });
    temporary.write(bytes);
    temporary.moveSync(new FsFile(parent, `${encoded}.bin`), { overwrite: true });
    temporary = null;

    const mime = new FsFile(parent, `${encoded}.mime`);
    mime.create({ overwrite: true, intermediates: true });
    mime.write(type);
  } finally {
    // A failed write or move leaves the sibling behind; left alone these
    // accumulate at megabyte sizes on a device already short of space, which is
    // the usual reason the write failed.
    try {
      if (temporary?.exists) temporary.delete();
    } catch {
      // Nothing further to try; the file is already only wasted space.
    }
  }
}

function nativeReadLocal(id: string): { file: FsFile; type: string } | null {
  try {
    const encoded = encodeFileName(id);
    const parent = cacheDirectory();
    const file = new FsFile(parent, `${encoded}.bin`);
    if (!file.exists) return null;

    let type = DEFAULT_TYPE;
    const mime = new FsFile(parent, `${encoded}.mime`);
    // A missing sidecar means the type write failed after the bytes landed.
    // The bytes are still good, so serve them as octet-stream rather than
    // pretending the file is absent.
    if (mime.exists) type = normalizeType(mime.textSync());
    return { file, type };
  } catch (reason) {
    warn(`could not read "${id}" from the device cache`, reason);
    return null;
  }
}

function nativeDeleteLocal(id: string): void {
  const encoded = encodeFileName(id);
  const parent = cacheDirectory();
  for (const name of [`${encoded}.bin`, `${encoded}.mime`]) {
    try {
      const file = new FsFile(parent, name);
      if (file.exists) file.delete();
    } catch (reason) {
      warn(`could not delete "${name}" from the device cache`, reason);
    }
  }
}

// ---------------------------------------------------------------------------
// StoredFile, per backend
// ---------------------------------------------------------------------------

function webFile(id: string, blob: Blob): StoredFile {
  const type = normalizeType(blob.type);
  const base64 = () => blobToBase64(blob);
  return {
    id,
    type,
    size: blob.size,
    bytes: () => blobBytes(blob),
    base64,
    text: () => blob.text(),
    dataUri: async () => `data:${type};base64,${await base64()}`,
    open() {
      const uri = URL.createObjectURL(blob);
      let released = false;
      return {
        uri,
        type,
        size: blob.size,
        release() {
          if (released) return;
          released = true;
          URL.revokeObjectURL(uri);
        },
      };
    },
  };
}

function nativeFile(id: string, file: FsFile, type: string): StoredFile {
  return {
    id,
    type,
    size: file.size,
    bytes: () => file.bytes(),
    base64: () => file.base64(),
    text: () => file.text(),
    dataUri: async () => `data:${type};base64,${await file.base64()}`,
    // A file:// URI needs no revoking, so release() is a no-op - but it is
    // still called by every call site, so the same code runs on both platforms.
    open: () => ({ uri: file.uri, type, size: file.size, release: () => {} }),
  };
}

/**
 * Downloaded bytes that could not be cached to disk. Everything still works
 * except `open()`: there is no file to point a URI at, and inventing a data:
 * URI for up to 10 MB would blow past what a WebView will accept.
 */
function memoryFile(id: string, bytes: Uint8Array<ArrayBuffer>, type: string): StoredFile {
  return {
    id,
    type,
    size: bytes.byteLength,
    bytes: async () => bytes,
    base64: async () => base64FromBytes(bytes),
    text: async () => utf8Decode(bytes),
    dataUri: async () => `data:${type};base64,${base64FromBytes(bytes)}`,
    open: () => null,
  };
}

// ---------------------------------------------------------------------------
// Turning a FileSource into something uploadable
// ---------------------------------------------------------------------------

/**
 * Which arm of FileSource this is.
 *
 * NOT `'bytes' in source`: a Blob has a `bytes()` method of its own (it is in
 * TypeScript 6's DOM lib and shipping in browsers), so a property test matches
 * every Blob and routes it down the wrong branch. `instanceof` is the honest
 * check, and it holds on both platforms - React Native defines a global Blob,
 * and a browser File extends Blob.
 */
function isBlobSource(source: FileSource): source is Blob {
  return typeof Blob !== 'undefined' && source instanceof Blob;
}

/**
 * Web keeps a Blob all the way through: it is what fetch streams without
 * copying and what IndexedDB stores.
 */
async function webSource(source: FileSource): Promise<Blob> {
  if (isBlobSource(source)) return source;

  if ('uri' in source) {
    const response = await fetch(source.uri);
    if (!response.ok) throw new Error(`Could not read the selected file (HTTP ${response.status}).`);
    const blob = await response.blob();
    if (!source.type || normalizeType(blob.type) === normalizeType(source.type)) return blob;
    // slice() is the only way to restamp a Blob's type; the bytes are re-wrapped,
    // not re-encoded.
    return blob.slice(0, blob.size, source.type);
  }

  return new Blob([toBufferSource(source.bytes)], { type: normalizeType(source.type) });
}

/** Native keeps bytes: it cannot construct a Blob from them, and the disk write wants them anyway. */
async function nativeSource(
  source: FileSource,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: string }> {
  if (isBlobSource(source)) {
    return { bytes: await blobBytes(source), type: normalizeType(source.type) };
  }

  if ('uri' in source) {
    // file:// is a picked or generated document; content:// is Android's
    // Storage Access Framework, which fetch() cannot open but expo-file-system
    // can. Anything else (http, https, data, blob) goes through fetch.
    if (/^(file|content):/i.test(source.uri)) {
      const file = new FsFile(source.uri);
      return { bytes: await file.bytes(), type: normalizeType(source.type || file.type) };
    }
    const response = await fetch(source.uri);
    if (!response.ok) throw new Error(`Could not read the selected file (HTTP ${response.status}).`);
    return {
      bytes: await responseBytes(response),
      type: normalizeType(source.type || response.headers.get('content-type')),
    };
  }
  return { bytes: toBufferSource(source.bytes), type: normalizeType(source.type) };
}

/**
 * Uint8Array is generic over its buffer since TypeScript 5.7, and both
 * `BodyInit` and `BlobPart` require one backed by a plain ArrayBuffer. A view
 * over a SharedArrayBuffer cannot occur here (nothing in this app allocates
 * one), so this narrows rather than copying ten megabytes.
 */
function toBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes as Uint8Array<ArrayBuffer>;
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/**
 * Uploads the file, then caches it on the device.
 *
 * Cloud first and device second, deliberately: the cloud copy is the
 * authoritative one, so a cache that cannot be written is a warning, while an
 * upload that fails is an error the upload dialog must show. Same order, and
 * the same swallow-the-cache-failure rule, as the Next.js app.
 */
export async function saveFile(id: string, source: FileSource): Promise<StoredFile> {
  requireId(id);

  if (isWeb) {
    const blob = await webSource(source);
    guardSize(blob.size);
    await upload(id, blob, normalizeType(blob.type));
    try {
      await webWriteLocal(id, blob);
    } catch (reason) {
      warn(`"${id}" uploaded but could not be cached in IndexedDB`, reason);
    }
    return webFile(id, blob);
  }

  const { bytes, type } = await nativeSource(source);
  guardSize(bytes.byteLength);
  await upload(id, bytes, type);
  try {
    nativeWriteLocal(id, bytes, type);
    const stored = nativeReadLocal(id);
    if (stored) return nativeFile(id, stored.file, stored.type);
  } catch (reason) {
    warn(`"${id}" uploaded but could not be cached on the device`, reason);
  }
  return memoryFile(id, bytes, type);
}

/**
 * The file, from the device cache when it is there and from secure cloud
 * storage when it is not - re-caching it on the way past. Null when it exists
 * in neither, which is what the UI shows as "re-upload it".
 */
export async function readFile(id: string): Promise<StoredFile | null> {
  requireId(id);

  if (isWeb) {
    try {
      const cached = await webReadLocal(id);
      if (cached) return webFile(id, cached);
    } catch (reason) {
      warn(`could not read "${id}" from IndexedDB`, reason);
    }

    const response = await download(id);
    if (!response) return null;
    const blob = await response.blob();
    try {
      await webWriteLocal(id, blob);
    } catch (reason) {
      warn(`could not cache "${id}" in IndexedDB`, reason);
    }
    return webFile(id, blob);
  }

  const cached = nativeReadLocal(id);
  if (cached) return nativeFile(id, cached.file, cached.type);

  const response = await download(id);
  if (!response) return null;
  const type = normalizeType(response.headers.get('content-type'));
  const bytes = await responseBytes(response);
  try {
    nativeWriteLocal(id, bytes, type);
    const stored = nativeReadLocal(id);
    if (stored) return nativeFile(id, stored.file, stored.type);
  } catch (reason) {
    warn(`could not cache "${id}" on the device`, reason);
  }
  return memoryFile(id, bytes, type);
}

/**
 * Removes the file from the device and from secure cloud storage.
 *
 * The Next.js app ignored the DELETE response, so a server that refused looked
 * to the teacher exactly like a file that had been removed while the answer
 * sheet stayed in storage. This reports the failure instead. The local cache is
 * cleared first and its own failure is still swallowed - a stale cache entry is
 * harmless once the authoritative copy is gone.
 */
export async function deleteFile(id: string): Promise<void> {
  requireId(id);

  try {
    if (isWeb) await webDeleteLocal(id);
    else nativeDeleteLocal(id);
  } catch (reason) {
    warn(`could not clear "${id}" from the local cache`, reason);
  }

  const response = await authFetch(apiPath(id), { method: 'DELETE' });
  if (!response.ok) throw new Error(await errorMessage(response, 'The file could not be deleted.'));
}

// ---------------------------------------------------------------------------
// Conveniences - what the ported call sites actually reach for
// ---------------------------------------------------------------------------

/** Raw bytes, or null when the file is gone. For pdf.js and the `%PDF-` header check. */
export async function readFileBytes(id: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const file = await readFile(id);
  return file ? file.bytes() : null;
}

/** Base64 with no `data:` prefix - the shape /api/grade, /api/ocr and /api/document-to-pdf-source take. */
export async function readFileBase64(id: string): Promise<string | null> {
  const file = await readFile(id);
  return file ? file.base64() : null;
}

/** UTF-8 text, for the markdown/plain-text branch of the preview. */
export async function readFileText(id: string): Promise<string | null> {
  const file = await readFile(id);
  return file ? file.text() : null;
}

/** `data:<type>;base64,<...>` - for an <img src> or generated HTML. */
export async function readFileDataUri(id: string): Promise<string | null> {
  const file = await readFile(id);
  return file ? file.dataUri() : null;
}

/**
 * A renderable URI. The replacement for every `URL.createObjectURL(blob)` in the
 * Next.js app - and, unlike them, it also works on a phone.
 *
 * The caller owns the result and must `release()` it, normally from a useEffect
 * cleanup. Null when the file is gone, or when it could not be put on disk.
 */
export async function openFile(id: string): Promise<OpenFile | null> {
  const file = await readFile(id);
  return file ? file.open() : null;
}
