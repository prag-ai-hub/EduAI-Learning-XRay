/**
 * Signed, expiring links for a single student's report.
 *
 * The token is `base64url(payload).base64url(hmac)`. Anyone holding it can read
 * that one report until it expires, so two properties matter: the signature
 * must not be forgeable, and comparing it must not leak timing information.
 */

export type SharePayload = { u:string; a:string; f:string; exp:number };

const encodeBytes = (bytes:Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");

const decodeBytes = (value:string) => {
  const normalized = value.replace(/-/g,"+").replace(/_/g,"/");
  return Uint8Array.from(atob(normalized + "=".repeat((4 - normalized.length % 4) % 4)), c => c.charCodeAt(0));
};

/**
 * The signing key, and nothing else may stand in for it.
 *
 * This used to fall back to the Supabase service-role key. That made one leaked
 * value both sign a parent's share link and grant full database access — two
 * very different blast radii behind one secret, reached by simply not setting a
 * variable that was documented nowhere.
 *
 * Failing here is deliberate. A missing signing key is a deployment that is not
 * finished, and the alternative is minting links that look fine and quietly
 * widen what the service-role key is worth.
 *
 * Cutover note: `frontend/` mints its own links with its own copy of this file,
 * which still accepts the fallback. If links issued there must keep resolving
 * after this app replaces it, set SHARE_TOKEN_SECRET to the value that instance
 * used. Otherwise they simply expire — a token lives 1-90 days, 30 by default.
 */
function shareSecret(){
  const secret = process.env.SHARE_TOKEN_SECRET;
  if (!secret) {
    throw new Error(
      "SHARE_TOKEN_SECRET is not set. Parent share links are signed with it; " +
      "it must not be the Supabase service-role key. See app/.env.example."
    );
  }
  return secret;
}

async function hmac(value:string){
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(shareSecret()),
    { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

/** Length-independent, data-independent comparison. */
function timingSafeEqual(a:Uint8Array, b:Uint8Array){
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function createShareToken(payload:SharePayload){
  const encoded = encodeBytes(new TextEncoder().encode(JSON.stringify(payload)));
  return `${encoded}.${encodeBytes(await hmac(encoded))}`;
}

/**
 * Returns the payload only for a token whose signature verifies and which has
 * not expired. Every failure returns null: a caller cannot distinguish a forged
 * signature from a malformed token, so the endpoint reveals nothing.
 */
export async function readShareToken(token:string):Promise<SharePayload|null>{
  const [encoded, signature] = String(token || "").split(".");
  if (!encoded || !signature) return null;

  let provided:Uint8Array;
  try { provided = decodeBytes(signature); } catch { return null; }
  if (!timingSafeEqual(await hmac(encoded), provided)) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(decodeBytes(encoded))) as SharePayload;
    if (!payload?.exp || !payload.u || !payload.a || !payload.f) return null;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}

export function isExpiredToken(token:string){
  const [encoded] = String(token || "").split(".");
  if (!encoded) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(decodeBytes(encoded))) as SharePayload;
    return Boolean(payload?.exp && Date.now() > payload.exp);
  } catch { return false; }
}
