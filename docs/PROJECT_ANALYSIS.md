# EduAI Learning X-Ray — End-to-End Project Analysis

> Baseline snapshot taken 2026-09-01 from the working tree at
> `/home/hp/Desktop/EduAI-Learning-XRay-EduAI-Learning-XRay`.
> Purpose: a single reference for planning further development.
> ~4,900 lines of first-party source across 62 files. Not a git repository.

---

## 1. What the product is

A **teacher-facing assessment intelligence platform** for Indian K-12 schools (CBSE-oriented).
The core promise from the marketing page: *"Marks tell you who scored. Learning X-Ray tells you why."*

The end-to-end loop it implements:

```
Create/generate assessment (question paper + marking scheme + model answer)
  → upload student answer sheets
  → Mistral OCR extraction
  → teacher validates/corrects OCR text          ← hard gate, cannot be skipped
  → OpenAI question-level grading + CBSE learning-gap diagnosis
  → evaluator (teacher) reviews every question   ← hard gate
  → immutable evaluation version submitted server-side
  → auto-generates 4 artefacts per student (gap report, study guide, worksheet, answer key)
  → class heatmap / performance matrix / interventions / follow-up evidence
  → signed QR share link to parent/student
```

Product guardrails baked into copy and logic: no student or teacher rankings, AI output is
always a *draft* until a teacher approves, every insight must cite evidence from validated OCR.

---

## 2. Tech stack and runtime

| Layer | Choice |
|---|---|
| Framework | Next.js 16.2.6 App Router, React 19.2.6 |
| Build/runtime | **vinext 0.0.50** (Cloudflare's Next-on-Workers), Vite 8, `@cloudflare/vite-plugin` |
| Deploy target | Cloudflare Workers via `worker/index.ts`; OpenAI "Sites" hosting (`.openai/hosting.json`) |
| Styling | Tailwind 4 (`@tailwindcss/postcss`) + three hand-written CSS files |
| Database/auth/storage | **Supabase** (Postgres + Auth + private Storage bucket `eduai-files`) |
| OCR | **Mistral** `mistral-ocr-latest` (`/v1/ocr`) |
| Generation & grading | **OpenAI** chat completions, model string `gpt-5.6-sol` |
| Client libs | `jspdf`, `html2canvas`, `fflate` (zip/unzip), `xlsx`, `dompurify` (declared, unused) |
| Runtime PDF render | pdf.js 4.10.38 loaded from cdnjs at runtime (dynamic import) |

Node `>=22.13.0`. Scripts: `dev`/`build`/`start` via vinext, `lint`, `db:push` (supabase CLI).

**Env vars** (`.env.example` is incomplete):
- `MISTRAL_API_KEY` — OCR
- `OPENAI_API_KEY` — grading + all generation
- `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) — server client + HMAC share signing
- `SUPABASE_PUBLISHABLE_KEY` or `SUPABASE_ANON_KEY` — **required by `/api/auth/config` but missing from `.env.example`**
- `ANALYSIS_CREDIT_COST` — optional, defaults to 1

---

## 3. Repository map

```
app/
  layout.tsx              metadata, OG tags, brand favicon
  page.tsx                → ui/MarketingHome (public landing)
  app/page.tsx            → ui/FunctionalEduAIApp (the product; force-dynamic)
  signin/page.tsx         static marketing sign-in shell (links to /app)
  privacy/, terms/        one-line legal pages
  share/[token]/page.tsx  public parent/student dashboard (client, no auth)
  health/route.ts         {status:"ok"}
  chatgpt-auth.ts         SIWC helpers from the starter template — UNUSED
  api/                    17 route handlers (see §7)
  ui/
    FunctionalEduAIApp.tsx  1,654 lines — the entire application
    MarketingHome.tsx       70 lines — landing page
    ParentShareDialog.tsx   13 lines — QR share modal
    EduAIApp.tsx            128 lines — DEAD legacy prototype, imported nowhere
lib/
  supabase-server.ts      service-role client factory + bucket name
  supabase-auth.ts        Bearer-token → Supabase user
  authorization.ts        profile + role + status + credit gate
  document-text.ts        format-aware text extraction (local + Mistral fallback)
  evaluator-grading.ts    canonicalization + deterministic submission validation
supabase/migrations/      4 SQL migrations (see §6)
docs/evaluator-grading/   4 short ADR/lifecycle/rollout docs for the evaluator slice
tests/                    4 node:test files (only 1 is wired into `npm test`)
worker/index.ts           Cloudflare Worker entry + image optimization
build/sites-vite-plugin.ts  copies .openai/ + drizzle/ into dist after build
examples/d1/              starter template leftovers — UNUSED
public/brand/             logo.png, shield.png
EduAI-Learning-X-Ray-source-2e015b1.zip   1.9 MB source snapshot committed in repo root
```

---

## 4. Architecture and data flow

### The central architectural fact

**All application state lives in one JSON blob.** The client holds a single `DemoState` object
and debounce-syncs it (700 ms) to `workspace_snapshots.state_json` keyed by `teacher:{user.id}`,
capped at 4 MB. The normalized tables from migration 1 (`assessments`, `grade_results`,
`students`, `interventions`, `resources`, …) **exist but are never written by the app.**

```
DemoState = {
  assessments[]   ← each embeds files[], gradeResults{fileId→GradeResult}, answerKey, rubric
  users[] classes[] schools[] students[] resources[] interventions[]
  academicYears[] events[] apiLog[]
}
```

Three storage tiers, by purpose:

| Tier | Holds | Notes |
|---|---|---|
| `workspace_snapshots` (Postgres JSONB) | all structured state | authoritative, 4 MB cap, revision counter |
| `localStorage` `eduai-xray-offline-cache-v1:{userId}` | full state mirror | offline fallback on load |
| Supabase Storage `eduai-files/{userId}/uploads/{fileId}` | raw uploads ≤10 MB | authoritative bytes |
| IndexedDB `eduai-learning-xray-files` | file blob cache | read-through cache in front of Storage |
| `sessionStorage` | access token, bulk-analysis queue | ephemeral |

Sync indicator in the topbar surfaces `Loading / Syncing / Synced / Offline`.

### Component tree

```
FunctionalEduAIApp        auth bootstrap: /api/auth/config → Supabase client → session → /api/profile
 ├─ TeacherAuth           email+password, Google, Azure OAuth; first-login profile form
 └─ WorkspaceApp          state, sync, theme, credits, nav, toast, dialog router
     ├─ TeacherApp        Home Work Review X-Ray Interventions Students Resources Achievements Reports Settings
     ├─ SchoolAdminApp    Overview Users Schools&Classes Students AcademicYears Branding&Privacy Reports
     ├─ PrincipalApp      metrics + SchoolPerformanceMatrix + trend
     ├─ PlatformApp       tenant/config surfaces + SystemHealthPanel (only real one)
     └─ AppDialog         ~45 modal types dispatched by a `type:id` string
```

Roles: `Teacher | Admin | Principal | School admin | Platform admin`.
Only `Teacher` and `Admin` are reachable from real auth — `/api/profile` maps everything to
`Teacher` unless the email matches a hardcoded regex for `priyadarshini.adap@eduaihub(.in)`.
Principal and Platform admin views are unreachable in production today.

---

## 5. The AI pipeline in detail

### 5.1 OCR — `POST /api/ocr` → `lib/document-text.ts`

Format-aware extraction, Mistral only when necessary:
- text/*, md, txt, csv, tsv, json, xml, yaml, html, rtf → decoded locally (RTF de-marked-up)
- docx / odt → `fflate.unzipSync` + XML→text on `word/document.xml` / `content.xml`
- xlsx / xls → `xlsx` sheet_to_csv per sheet
- everything else (PDF, images) → Mistral `/v1/ocr`, output joined as `--- Page n ---\n{markdown}`

Requires both an `answerSheet` and a `questionPaper` document or it 400s.
The `--- Page n ---` dividers are load-bearing: question→page mapping and the corrected-answer-sheet
PDF both parse them.

### 5.2 Grading — `POST /api/grade`

The heart of the product. ~40-line CBSE diagnostician system prompt that instructs the model to:
- analyse **only** wrong/partial/unanswered/mark-losing responses (never mine gaps from correct work)
- treat a visible teacher-awarded total as ground truth when the sheet is classified teacher-graded
- trace two chains: *observed error → immediate gap → misconception → prerequisite gap → consequence*
  and *current concept → prerequisite → earlier-class foundation → root gap*
- derive `maxMarks` dynamically from the question paper, not the declared fallback
- return strict JSON with `questions[]` (id, label, pageNumber, attemptState, awardedMarks,
  maxMarks, allowedIncrement, evidence, rationale, confidence, criteria[]) and `gaps[]`
  (concept, mastery, finding, misconception, evidence, prerequisiteConcept, foundationGap,
  recommendedLevel, remediationSequence[], rework, severity)

Server-side hardening after the model returns:
- `maxMarks` must be finite, >0, ≤10000
- **question maxMarks must sum exactly to maxMarks** (±0.001) or the whole call throws
- at least one question decision required
- gaps with mastery ≥100 dropped; mastery clamped 0–99
- allowedIncrement coerced into {0.25, 0.5, 1}

Credits are charged **before** the OpenAI call via `consume_credit` RPC with an `operationKey`
(`analysis:{assessmentId}:{fileId}:{ocrHash}`) for idempotency, and refunded via `refund_credit`
in the catch block. If the credit migration hasn't reached the schema cache, charging is skipped
with a console warning rather than failing.

### 5.3 Content generation

| Route | Produces |
|---|---|
| `/api/generate-assessment` | `{questionPaperText, markingSchemeText, modelAnswerText, questionCount}` from title/class/subject/marks + optional uploaded blueprint. Client then renders all three into branded PDFs and attaches them as assessment files. |
| `/api/generate-study-guide` | `{title, overview, topics[{concept, mastery, diagnosis, learningObjective, explanation, workedExample, practiceSteps[3], checkForUnderstanding[3]}]}` — one topic per diagnosed gap, ordered weakest-first, Class 9–10 reading level. |
| `/api/generate-worksheet` | `{mcqQuestions[], subjectiveQuestions[]}` with `cognitiveLevel` ∈ recall/application/analysis and a `concept` tag per question. Client **rejects and asks for regeneration if any target concept is uncovered**. |

All three use `response_format: json_object` and the same `gpt-5.6-sol` model string.

### 5.4 Evaluator submission — `POST /api/evaluations/submit`

The one genuinely rigorous server contract in the codebase (`lib/evaluator-grading.ts`):

- **Canonicalization**: questions sorted by id, criteria sorted by id, pages sorted by number,
  evidence/rationale trimmed → deterministic JSON string → SHA-256 `content_hash`
- **Validation**: every question reviewed; valid attempt state; awarded ∈ [0, max];
  awarded must land on the allowed increment; not_attempted/excluded must award 0;
  attempted requires evidence; edited/rejected requires a rationale; unique page numbers;
  recomputed total maximum must equal `expectedMaxMarks`
- **Server owns the total** — client aggregates are ignored
- **Immutability**: new `evaluation_versions` row per submission, `version_number` incremented per
  (school, assessment, file); rows never updated in place
- **Idempotency**: unique `(school_id, evaluator_id, idempotency_key)`; a replay returns the
  existing row with `replayed: true`
- **Optimistic concurrency**: assessment `version` mismatch → 409
- **Compatibility bridge**: if `evaluation_versions` doesn't exist yet, it writes the same
  immutable record into `audit_events` and returns `compatibilityStore: true`
- Always writes an append-only `evaluation.submitted` audit event

Documented as a deliberate first slice. Deferred (per `docs/evaluator-grading/`): page-image
viewer, answer-region boxes, autosaved drafts, scan rejection, integrity queues, assignment leases,
job queue/retries, moderator comparison, and the `moderation_pending → finalized → published`
lifecycle. Nothing in the app may treat `submitted` as board-approved.

---

## 6. Data model

### Migration 1 — `20260727000000_eduai_learning_xray.sql`
12 tables: `schools users classes students assessments uploaded_files grade_results
interventions resources followup_evidence audit_events workspace_snapshots`.
All keys are `text`. RLS enabled on every table with **no policies** → service_role only.
Creates the private `eduai-files` bucket (10 MB limit) and the `save_workspace_snapshot`
security-definer RPC (upsert + revision increment), granted to service_role only.

**Only `workspace_snapshots`, `users`, `schools`, and `audit_events` are actually used.**
The other 8 tables are a designed-but-unwired normalized model.

### Migration 2 — `20260729000000_class_master_and_assessment_references.sql`
Renames `classes.grade` → `class_name`, constrains it to `^([1-9]|1[0-2])$`, adds
`question_paper_file_id / marking_scheme_file_id / model_answer_file_id` to `assessments`,
and **rewrites existing JSONB snapshots** (`grade` → `className`) — a real data migration
inside the JSON blob. The API layer keeps a bidirectional `grade`↔`className` shim in
`/api/workspace`.

### Migration 3 — `20260812000000_credits_rbac_invitations.sql`
Adds `total_credits / used_credits / disabled_at` to users; creates `credit_transactions`
(allocation/adjustment/consumption/refund, unique per user+operation_key) and `invitations`;
defines `consume_credit(operation_key, reference, cost)` and `refund_credit(operation_key, reason)`
as security-definer functions granted to `authenticated`; promotes a hardcoded admin email.

### Migration 4 — `20260819000000_evaluator_grading_foundation.sql`
Additive, immutable: `assessment_versions`, `evaluation_drafts` (defined, not yet used),
`evaluation_versions`, `report_versions` (defined, generation not wired). RLS on, service_role only.

---

## 7. API surface (17 routes)

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `/api/auth/config` | GET | public | Returns Supabase URL + publishable key, cached 300 s |
| `/api/profile` | GET, PUT | Bearer | Read/upsert user + school; assigns Admin by hardcoded email regex |
| `/api/workspace` | GET, PUT | Bearer | Whole-state snapshot read/write, 4 MB cap, `grade`↔`className` shim |
| `/api/files/[id]` | PUT, GET, DELETE | Bearer | Blob store at `{userId}/uploads/{id}`, 1 byte–10 MB |
| `/api/ocr` | POST | Bearer | Batch extraction; requires answerSheet + questionPaper |
| `/api/document-to-pdf-source` | POST | Bearer | Single-doc text extraction for PDF conversion |
| `/api/grade` | POST | Bearer + credits | OCR text → question decisions + learning gaps |
| `/api/generate-assessment` | POST | Bearer | Paper + marking scheme + model answer |
| `/api/generate-study-guide` | POST | Bearer | Per-gap remedial guide |
| `/api/generate-worksheet` | POST | Bearer | MCQ + subjective practice, concept-tagged |
| `/api/evaluations/submit` | POST | Bearer + profile | Immutable versioned evaluator submission |
| `/api/credits` | GET | Bearer + profile | Balance + last 50 ledger rows |
| `/api/admin/users` | GET, PATCH | Admin | List users + ledger; adjust credits / toggle status |
| `/api/admin/invitations` | POST | Admin | `auth.admin.inviteUserByEmail` + invitation + user rows |
| `/api/shares` | POST | Bearer | Mint HMAC-signed share token (1–90 days) |
| `/api/shares/[token]` | GET | **public** | Resolve token → student report payload |
| `/api/system-health` | GET | **public** | Live reachability probe of Mistral + OpenAI |

Auth pattern throughout: `Authorization: Bearer {supabase access_token}` →
`supabase.auth.getUser(token)`. The token is held in a module-level `activeAccessToken`
variable and mirrored to sessionStorage for `ParentShareDialog`.

Two routes have **defensive schema-drift handling** (`/api/credits`, `/api/admin/users`,
`lib/authorization.ts`): they detect `42P01 / 42703 / PGRST205` and fall back to a legacy
column set, so the app keeps working before migrations land.

---

## 8. Feature inventory, module by module

### Teacher

**Home** — 5 metrics (assessments, answers to review, priority gaps, interventions, follow-ups due),
assessment pipeline table, next-action card. All metrics derive from real graded evidence.

**Work** — assessment grid filtered by stage, 10-step journey strip (`draft → uploaded → setup →
grading → review → approved → xray → intervention → followup → published`), decision card, and the
uploaded-evidence panel with per-file preview / download (non-PDF converted to branded PDF) / remove.

**Create assessment** — two modes:
- *Upload*: required question paper + optional marking scheme + model answer
- *Generate*: optional blueprint → AI produces all three → client renders each to a branded PDF
  via html2canvas+jsPDF and attaches them as real files

**Upload (v2)** — drag-drop, per-file `DocumentRole` classifier
(`Question paper | Marking scheme | Model answer | Ungraded answer sheet | Teacher-graded answer sheet
| Supporting reference`), pause/resume, retry-failed, 10 MB cap, simulated progress bar over real
uploads. Contains an odd heuristic that renames the assessment to "Economics …" if filenames match
economics keywords.

**Grade / diagnose dialog (`PerFileGradeDialog`)** — the most complex component:
1. pick question paper (required) / marking scheme / model answer
2. student name auto-guessed from filename
3. class+section and subject bound to the Class master
4. Mistral OCR → **four editable textareas** for teacher correction — analysis cannot start until this
5. evidence fingerprint (file ids + rubric + subject + class + OCR hash + reanalysis reason) →
   unchanged evidence reuses the previous result instead of re-charging credits
6. reanalysis requires a written reason
7. OpenAI grading → optional evaluator workspace → submission → background generation of all reports
8. `diagnosisOnly` path for teacher-graded sheets: preserves teacher marks, skips grading review
9. auto-advances the bulk-analysis queue from sessionStorage

**Review** — the five-stage per-question review screen, grouped by OCR page:
1. Question → 2. original handwritten answer (image or PDF `#page=n` object) → 3. OCR excerpt (copyable)
→ 4. AI marks + rationale + confidence → 5. teacher marks + comments + "mark as reviewed".
Sticky question navigator, 650 ms autosave, score recomputed from question decisions (excluding
`excluded`), student pager, "Submit Review & Generate Resource", "Bulk Approval", and
**"Create Corrected Answer Sheet"** — a per-question PDF that renders the actual source page
(pdf.js) beside AI feedback and the teacher comment.

**X-Ray** — hierarchy selector Class&Section → Subject → Assessment, then:
concept×student mastery heatmap (weak ≤35 / average 36–79 / excellent ≥80 / not assessed),
executive summary, dynamic intervention clusters by shared gap signature, priority-gap card,
teacher diagnosis approval, class learning-gap report download.

**Interventions** — create (concept prefilled with the weakest gap), format/duration/group/follow-up
date, mark complete, record follow-up evidence (students completed, avg mastery, outcome, note),
review group membership, concept-mastery bars.

**Students** — roster search, per-student mastery from aggregated gaps, evidence profile dialog,
CSV **and** XLSX roster import with header detection (name/roll/class).

**Resources** — filter by class/subject/assessment; per student row exposes learning-gap report,
study guide, worksheet, answer key, **"Download All (ZIP)"** (generates missing artefacts first,
then zips 4 PDFs via fflate), and **"Share with parent"** (signed QR).

**Achievements** — 5 badges computed from real counts; explicitly no leaderboard.

**Reports** — 6 tabs; `Performance matrix report` renders the class×subject band matrix with
drill-down; others render concept bars or a monthly mastery trend. Secure-share panel is a
non-functional demo (generates a fake `eduai.demo/report/XXXX-XXXX` string).

**Settings** — 6 preference panels, all `SimpleSettings` stubs that only toast.

### School admin
Users list with credit balances, invite (real Supabase email invitation), assign credits
(real ledger write), enable/disable (real), resend invite (stub), edit user (local only),
classes/schools/academic years (local state only), branding & privacy (stubs).

### Principal / Platform admin
Unreachable via real auth. Principal shows aggregate metrics + the performance matrix.
Platform admin shows configuration surfaces that all open the same stub dialog, except
**System Health**, which does a genuine live probe of both providers plus per-session
success-rate/latency stats from the in-state `apiLog`, and is explicit about what it can't
measure without a monitoring backend.

### Parent / student share
`POST /api/shares` → base64url payload `{u,a,f,exp}` + HMAC-SHA256 signature using the Supabase
secret. `ParentShareDialog` renders a QR (via `api.qrserver.com`), copy-link with execCommand
fallback, email and WhatsApp share. `/share/[token]` is a public page rendering score, percentage,
gap cards and any generated study guide / worksheet, with a print button.

---

## 9. PDF and document engine (client-side, ~200 lines)

Shared pipeline: build HTML → inject `PDF_DOCUMENT_STYLES` into an off-screen 780 px host →
`html2canvas` at scale 1.5 → slice the canvas into A4 pages → `jsPDF.addImage` per page →
footer with logo, brand line and "Page n of m" → validate the `%PDF-` magic bytes before download.

Documents produced: student learning-gap report (paired executive-summary tables + per-gap
sections with inline mastery bars), class learning-gap report, study guide, worksheet,
answer key, generated question paper / marking scheme / model answer, converted uploads,
CSV-as-table results, corrected answer sheet (vector jsPDF, not html2canvas), and the 4-file ZIP.

---

## 10. Tests, build, deploy

- `tests/rendered-html.test.mjs` — asserts the build output contains the worker and persistence
  routes, and that migration 1 declares all 12 tables + bucket + RLS
- `tests/functional-contract.test.mjs` — 483 lines, ~25 tests; a **source-text contract suite**
  that greps `FunctionalEduAIApp.tsx` for required strings and regexes. Encodes product
  requirements (safeguard copy, upload controls, hierarchy labels, Class terminology, QR sharing…)
- `tests/evaluator-grading.test.mjs` — real unit tests of `validateEvaluationSubmission`
- `tests/pdf-encoding.test.mjs` — PDF text-encoding assertions

`npm test` = `npm run build && node --test tests/rendered-html.test.mjs`.
**The other three test files are never executed by any script.**

Deployment: `vinext build` → `dist/`; `build/sites-vite-plugin.ts` copies `.openai/hosting.json`
(and `drizzle/` if present) into `dist/.openai`. `hosting.json` declares `d1: null, r2: null` —
Cloudflare bindings are simulated locally but unused; Supabase is the real backend.

---

## 11. Findings — bugs and risks, ranked

### Blocking

**B1. `consume_credit` cannot work as written — grading is blocked wherever migration 3 is applied.**
`app/api/grade/route.ts` calls the RPC through `getSupabaseServer()`, which authenticates with the
**service-role key**, so `auth.uid()` is `NULL` inside the function and it raises
`Authentication required`. The route's catch only tolerates `PGRST202` (function missing); anything
else returns 400/402, so every analysis fails. Compounding this, `public.users.id` is `text`
(migration 1) while `auth.uid()` returns `uuid` — `where id = auth.uid()` has no operator and would
error even with a user JWT. Same two defects in `refund_credit`.
*Fix direction:* pass the user id as an explicit RPC parameter and cast, or run the RPC on a
per-request client carrying the user's JWT.

**B2. `credit_transactions.user_id uuid references auth.users(id)` vs `public.users.id text`.**
The credits schema straddles two identity types. Same for `invitations.invited_by`. Any join or
constraint across them is fragile.

### High

**H2. The 4 MB workspace snapshot is the scaling ceiling.** Every assessment, every file record,
every `GradeResult` (including full `ocrText` and all `questionDecisions`), every generated study
guide and worksheet body lives in one JSONB row, rewritten in full every 700 ms after any state
change. A teacher with ~30 students × a few assessments will approach the cap; OCR text alone is
kilobytes per sheet. There is no partial write, no conflict resolution, and no server-side
validation of the blob's shape. The normalized tables to fix this already exist and are unused.

**H3. Last-write-wins across devices.** `save_workspace_snapshot` increments a revision but the
client never sends or checks it. Two tabs will silently clobber each other.

**H4. Role model is effectively hardcoded.** `/api/profile` PUT assigns `Admin` only to
`priyadarshini.adap@eduaihub(.in)` via regex, and migration 3 promotes the same address. Principal
and Platform admin UIs are dead code in production.

**H5. Share-token signature comparison is not constant-time** (`await sign(encoded)!==signature`),
and the HMAC key is the Supabase service-role secret — one secret doing two unrelated jobs. Token
revocation is impossible; only expiry (max 90 days) limits exposure.

**H6. `/api/shares/[token]` reads the entire teacher workspace snapshot** to serve one student's
report. Correct data is returned, but the whole blob is loaded on a public endpoint.

### Medium

- **M1. Model string `gpt-5.6-sol`** appears in all four AI routes and does not correspond to a
  published OpenAI model. Verify against the account's model list before any release.
- **M2. `import` statements at the bottom of the file** in `generate-worksheet/route.ts` and
  `generate-study-guide/route.ts`. Legal (hoisted) but a strong sign of a bad merge.
- **M3. `WorksheetGradingDialog` posts `fileBase64`/`mimeType` to `/api/grade`,** which ignores both
  and requires `ocrText` + `questionPaperText`. **Worksheet answer grading is broken** — it will
  always 400 with "Validate the answer-sheet OCR text before analysis."
- **M4. Dead code**: `app/ui/EduAIApp.tsx` (128 lines, unreferenced), `LegacyReview`, `DemoAccess`,
  `UploadDialog` v1, `assessmentHasGrades`, `worksheetContent`, `app/chatgpt-auth.ts`,
  `examples/d1/`, `next.config.ts`. Plus a 1.9 MB source ZIP in the repo root.
- **M5. README is still the vinext starter's README** — nothing about EduAI.
- **M6. `.env.example` omits `SUPABASE_PUBLISHABLE_KEY`**, without which the app cannot boot.
- **M7. Three of four test files never run.** `npm test` also requires a full build first.
- **M8. `dompurify` is a dependency but never imported**, while raw text is interpolated into
  PDF HTML — `htmlEscape` handles it, but the unused dep suggests an abandoned sanitizer plan.
- **M9. pdf.js loads from cdnjs at runtime.** Offline or CSP-restricted deployments break the
  corrected-answer-sheet feature silently.
- **M10. Simulated progress everywhere** — upload bars, OCR percentages and generation progress are
  timers, not real progress. Honest in copy, but misleading in UI.
- **M11. Economics-keyword filename heuristic** in `UploadDialogV2` silently rewrites the assessment
  title and subject.
- **M12. `gapConceptsFor()`** builds hardcoded per-subject concept lists; it is computed in the
  grade flow but the result is never sent anywhere.

### Low

- Stubs that only toast: all six teacher Settings panels, Branding & Privacy, most Platform admin
  surfaces, `ShareDialog` (fake link), `UserEdit` (local only), classes/schools/academic years.
- `criteria` validation in `evaluator-grading.ts` is an empty `if` block with three stacked
  comments explaining why it does nothing.
- `initialState` demo data (Mira Bose, Sunrise Academy) still loads as the base for every new
  workspace before being overridden.
- Not a git repository — no history, no branching, no diff-based review.

---

## 12. What is genuinely strong

Worth preserving through any refactor:

1. **The teacher-authority gates are real, not cosmetic.** OCR validation and per-question review
   are enforced in code, not just in copy.
2. **The evaluator submission contract** — canonicalization, SHA-256 hashing, server-recomputed
   totals, immutable versions, idempotency keys, optimistic concurrency, audit events — is
   production-grade and well documented, including its explicit deferrals.
3. **The CBSE diagnostic prompt** is unusually disciplined: gaps only from mark-losing work,
   dual root-cause chains, evidence citation requirements, dynamic total-marks derivation.
4. **The mark-total invariant** (question maxima must sum exactly to the assessment total) catches
   the most common class of model error before it reaches a teacher.
5. **Evidence fingerprinting** prevents duplicate credit charges on unchanged inputs.
6. **Schema-drift tolerance** across three modules keeps the pilot running while migrations lag.
7. **`SystemHealthPanel` refuses to fabricate metrics** and says exactly what it cannot measure.
8. **The document/PDF engine** produces genuinely branded, multi-page, byte-verified output with a
   consistent visual system.
9. **Real format coverage** in `document-text.ts` — docx/odt/xlsx handled locally, Mistral reserved
   for scans and PDFs.

---

## 13. Open questions to resolve before the next build

1. **Persistence** — migrate off the JSON snapshot to the normalized tables that already exist, or
   raise the cap and keep the snapshot? This decision gates almost everything else.
2. **Multi-user** — is the target a single teacher's private workspace, or a school tenant with
   shared classes, moderation and co-teaching? Current code is single-teacher; the schema is
   school-shaped.
3. **Evaluator lifecycle** — does `moderation_pending → finalized → published` land next? The
   tables and docs are ready.
4. **Roles** — real RBAC for Principal / Platform admin, or delete those UIs?
5. **Credits** — fix and keep the ledger, or defer monetization? B1 must be resolved either way.
6. **Model** — confirm the correct OpenAI model id and pin it in one shared constant.
7. **Testing** — keep the source-grep contract suite, or move to behavioural tests?
8. **Git** — initialize a repository before further development.
