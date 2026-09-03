import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const authz        = read("lib/authorization.ts");
const shareTokens  = read("lib/share-tokens.ts");
const djangoSettings = read("../backend/config/settings/base.py");
const aiService      = read("../backend/apps/aiproxy/services.py");
const shareRead    = read("app/api/shares/[token]/route.ts");
const workspace    = read("app/api/workspace/route.ts");
const health       = read("app/api/system-health/route.ts");
const appUi        = read("app/ui/FunctionalEduAIApp.tsx");
const concurrency  = read("../supabase/migrations/20260903000200_share_extraction_and_concurrency.sql");

// ---------------------------------------------------------------- H3

test("H3: a stale workspace write is rejected instead of silently winning", () => {
  assert.match(concurrency, /workspace_revision_conflict/);
  assert.match(concurrency, /p_expected_revision bigint default null/);
  // A caller that omits the revision keeps working, so an older client is not broken.
  assert.match(concurrency, /if p_expected_revision is not null/);
  assert.match(workspace, /conflict: true/);
  assert.match(workspace, /status: 409/);
});

test("H3: the client sends the revision it read and surfaces a conflict", () => {
  assert.match(appUi, /revisionRef\s*=\s*useRef<number\|null>\(null\)/);
  assert.match(appUi, /body:JSON\.stringify\(\{state,revision:revisionRef\.current\}\)/);
  assert.match(appUi, /response\.status===409/);
  assert.match(appUi, /Changed elsewhere/);
});

// ---------------------------------------------------------------- H5

test("H5: share signatures are compared in constant time", () => {
  assert.match(shareTokens, /function timingSafeEqual/);
  assert.match(shareTokens, /diff \|= a\[i\] \^ b\[i\]/);
  // The old code compared the signature with !== , which short-circuits.
  assert.doesNotMatch(shareRead, /await sign\(encoded\)\s*!==\s*signature/);
});

test("H5: a dedicated signing secret is preferred over the database key", () => {
  assert.match(shareTokens, /process\.env\.SHARE_TOKEN_SECRET/);
  // Falls back so existing links keep working.
  assert.match(shareTokens, /process\.env\.SUPABASE_SECRET_KEY/);
});

test("H5: forged and malformed tokens are indistinguishable to a caller", () => {
  // readShareToken returns null for every failure mode; only expiry is
  // reported separately, because a parent needs to know to ask for a new link.
  assert.match(shareTokens, /export async function readShareToken[\s\S]*?return null;[\s\S]*?\}/);
  assert.match(shareRead, /This student link is invalid/);
});

// ---------------------------------------------------------------- H6

test("H6: a public share link no longer reads an entire teacher workspace", () => {
  assert.match(shareRead, /rpc\("get_shared_student_report"/);
  assert.doesNotMatch(shareRead, /from\("workspace_snapshots"\)/);
  assert.doesNotMatch(shareRead, /select\("state_json"\)/);
});

test("H6: the extraction withholds OCR text and AI rationale", () => {
  // The returned object is built field by field; ocrText and questionDecisions
  // are deliberately absent.
  assert.match(concurrency, /jsonb_build_object/);
  assert.doesNotMatch(concurrency, /'ocrText'/);
  assert.doesNotMatch(concurrency, /'questionDecisions'/);
  assert.match(concurrency, /grant execute on function public\.get_shared_student_report\(text, text, text\) to service_role/);
});

// ---------------------------------------------------------------- M1

test("M1: the model id lives in one place - now the analysis service", () => {
  // Originally hardcoded in four route files; then one frontend constant; now
  // a backend setting, because the model belongs with the key that must be
  // able to use it. A caller cannot name a model at all.
  assert.match(djangoSettings, /OPENAI_MODEL = env\("OPENAI_MODEL"/);
  assert.match(aiService, /model = settings\.OPENAI_MODEL/);
  for (const route of ["app/api/grade/route.ts","app/api/generate-assessment/route.ts",
                       "app/api/generate-worksheet/route.ts","app/api/generate-study-guide/route.ts"]) {
    const src = read(route);
    assert.doesNotMatch(src, /model:/, `${route} must not name a model - the proxy chooses it`);
    assert.doesNotMatch(src, /gpt-5\.6-sol/, `${route} still hardcodes the model`);
  }
});

test("M1: system health verifies the model exists, not just that the API answers", () => {
  // A reachable provider with a wrong model id fails every grading run while
  // looking healthy.
  assert.match(aiService, /def verify_model/);
  assert.match(aiService, /is not available to this API key/);
  // The frontend asks the service rather than probing the provider itself: it
  // no longer holds a key to probe with.
  assert.match(health, /proxyHealth\(request\)/);
  assert.match(health, /model/);
});

// ---------------------------------------------------------------- M3

test("M3: worksheet grading extracts text before grading", () => {
  // It used to post fileBase64 to /api/grade, which ignores it and requires
  // ocrText - so every run failed with a validation error.
  assert.match(appUi, /authFetch\("\/api\/ocr"[\s\S]{0,400}?id:"answerSheet"/);
  assert.match(appUi, /ocrText:ocrPayload\.documents\?\.answerSheet\?\.text/);
  assert.match(appUi, /questionPaperText:ocrPayload\.documents\?\.questionPaper\?\.text/);
});

test("M3: the worksheet supplies its own question paper and marking scheme", () => {
  assert.match(appUi, /function worksheetQuestionPaperText/);
  assert.match(appUi, /function worksheetMarkingSchemeText/);
  // Sent as text/plain so it is parsed locally rather than costing an OCR call.
  assert.match(appUi, /mimeType:"text\/plain"/);
  assert.match(appUi, /operationKey:`worksheet:/);
});

// ---------------------------------------------------------------- authorization

test("the role matrix's scoping helpers exist", () => {
  for (const fn of ["requireRole","requireSchoolScope","requireLinkedChild","requireActiveSchool"]) {
    assert.match(authz, new RegExp(`export (async )?function ${fn}`), `missing ${fn}`);
  }
});

test("SuperAdmin gets no implicit cross-tenant access", () => {
  assert.match(authz, /support_access_grants/);
  assert.match(authz, /Cross-tenant access requires an active support grant/);
  assert.match(authz, /support\.cross_tenant_read/);
});

test("parent access exists only where a link says so", () => {
  assert.match(authz, /from\("parent_student_links"\)/);
  assert.match(authz, /eq\("status","active"\)/);
});

test("a suspended school blocks new work but never blocks reads", () => {
  assert.match(authz, /Existing work stays available/);
  assert.match(authz, /schoolStatus:data\.status/);
});

test("requireEntitlement refuses to be a gate that permits everything", () => {
  // It was deliberately left throwing until M9 gave it subscriptions to resolve
  // through, because a stub returning null is a check that silently passes.
  // Now implemented, the same intent holds: an absent feature is a denial.
  assert.match(authz, /export async function requireEntitlement/);
  assert.match(authz, /if\(feature && !entitlement\.features\?\.\[feature\]\)/);
  assert.match(authz, /reason:"upgrade_required"/);
  assert.doesNotMatch(authz, /return null;\s*\/\/ TODO/);
});
