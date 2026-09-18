# Screen port — target paths

The dependency-ordered wave plan for porting `frontend/app/ui/` into `app/` was
computed against the old flat layout (`app/src/components/…`, `app/src/lib/…`).
The repository has since moved to the feature-sliced layout described in
[PROJECT_ARCHITECTURE_GUIDE.md](../../PROJECT_ARCHITECTURE_GUIDE.md). The wave
*order* and the *content* of each file are unchanged; only the destination is.

## The rule

| Planned path | Lands at |
|---|---|
| `src/types/<x>.ts` | `src/shared/types/<x>.ts` |
| `src/hooks/<x>.ts` | `src/shared/hooks/<x>.ts` |
| `src/lib/<domain>/<x>.ts` | `src/features/<slice>/lib/<x>.ts` |
| `src/components/<domain>/<x>.tsx` | `src/features/<slice>/components/<x>.tsx` |
| a route-level screen | `src/features/<slice>/screens/<x>.tsx` |
| `src/app/<route>.tsx` | unchanged — stays a thin route file |

A file used by **three or more slices** goes to `src/shared/` instead. That is
the only exception, and it covers exactly the generic UI kit.

## Domain → slice

| Planned domain | Slice |
|---|---|
| `marketing/` | `features/marketing` |
| `auth/` | `features/auth` |
| `workspace/` (shell, sidebar, sync, demo-state, analytics, read-model) | `features/workspace` |
| `teacher/` (home, work, X-Ray, heatmap, interventions, reports, students, resources, achievements, settings) | `features/teacher` |
| `teacher/review/`, `dialogs/grading/` | `features/grading` |
| `dialogs/create-assessment/`, `upload`, `bulk-analysis`, `delete-assessment`, `grade-selection`, `student-gaps`, `roster`, `bulk-queue` | `features/assessments` |
| `documents/`, `worksheet*`, `study-guide` | `features/documents` |
| `admin/` | `features/admin` |
| `parent-share`, the parent route | `features/parent` |
| `share/[token]` | `features/share` |
| `legal/` | `features/legal` |
| `dialogs/registry.tsx` | `features/workspace/components` — it is the shell's switchboard |

## Hoisted to `src/shared/components/`

These were planned under `components/workspace/` but every slice uses them, so
they are the generic UI kit, not workspace-owned:

`buttons.tsx` · `brand.tsx` · `primitives.tsx` · `status.tsx` · `table.tsx` ·
`modal.tsx` · `file-picker.tsx` · `performance-matrix.tsx`

`form.tsx` is already there.

## Already landed

The foundation the waves depend on exists and typechecks:

| File | Role |
|---|---|
| `src/shared/api/net.ts` | base-URL resolution + the authed transport; the fix for the 29 relative URLs that worked on Expo web and resolved to nothing on a device |
| `src/features/auth/api/authApi.ts` | what feature code imports — `authFetch` and the token lifecycle |
| `src/shared/storage/index.ts` | keychain on native, async storage on web |
| `src/shared/files/index.ts` | IndexedDB on web, `expo-file-system` on native |
| `src/shared/components/form.tsx` | covers the 16 `<form>` blocks in the monolith |
| `src/shared/theme/styles.ts` | 249 CSS classes as a React Native StyleSheet |

## Constraints that hold for every wave

* `shared/` must never import `features/`.
* No bare `fetch`, no relative URL. `authFetch` or `apiUrl()`, always.
* The visual language is fixed: reuse `src/shared/theme/`, do not restyle.
* Anything placed under `src/app/` becomes a route. Providers go in
  `src/providers/`, screens go in their slice.
* `src/shared/api/{index,client,errors,types}.ts` keep **relative** internal
  imports — `frontend/` bundles that directory with a different `@/` alias.

## Corrections the critics found — apply these before dispatching the port

Three review agents checked the foundation and the plan. The foundation defects
are fixed; these are the plan-level ones, and each would have hit several
porting agents at once.

### Blockers

1. **`Field` does not mean what the plan says.** The monolith's `Field` is a
   label wrapper — `{label, children}` — used at 34 call sites around
   `<select>`, `<input>`, `<textarea>` and `<input type="file">`.
   `form.tsx`'s `Field` has **no `children`**; it renders its own `TextInput`.
   The mapping is:
   * `<Field><select>` → `Select` (it takes `label`)
   * `<Field><input>` / `<textarea>` → `Field` with `type` / `inputProps`
   * a disabled input → `Field` with `editable={false}`
   * `<Field><input type="file">` → a labelled `FilePickerButton`, owned by
     `file-picker.tsx` in wave 2
2. **A same-wave peer import.** `Work` renders `UploadedFiles`; the plan puts
   both in wave 3. Move `work.tsx` to **wave 4**. (Checked across the whole JSX
   graph — this is the only backwards edge.)
3. **`SCHOOL_STATUS_TONE` has two owners** — `status.tsx` (w1) and
   `school-directory.tsx` (w3). Give it to `status.tsx` alone.

### Contract corrections

* **Colours** come from `useAppPalette()`, or `Colors` in
  `@/shared/theme/tokens` for the rare static case. There is no
  `@/constants/theme`. `styles.ts` exposes **830** style keys, not 249 — grep it
  before concluding a class is missing.
* **`@/shared/api/net` exports far more than the plan lists**: `apiUrl`,
  `apiFetch`, `authHeaders`, `currentAccessToken`, `refreshAccessToken`,
  `utf8Encode`, `base64FromBytes`, `base64FromText`, `blobToBase64`. Four files
  (`use-create-assessment`, `use-grade-run`, `uploaded-files`,
  `worksheet-grading`) need the base64 helpers and would otherwise each write
  their own `FileReader` path, which is wrong on native.
* **`types/workspace.ts` is under-sized** at 250 lines; the real source is
  ~450–600. Split it into `workspace.ts` (domain model) and
  `workspace-props.ts` (`WorkspaceProps`, `W<K>`, the six callback aliases,
  `DialogType`, `ToastKind`). Both wave 0, independent — it is the file every
  other wave blocks on.
* **`jspdf` and `html2canvas` are not installed**, and a static import breaks
  the Metro *native* build: `html2canvas` dereferences `document` at module
  load. They must be dynamically imported behind a web-only branch.
* **`useFormField` must be called from a component *inside* `<Form>`**, not from
  the one that renders `<Form>` — outside the provider it silently never
  registers. It now warns in dev.

### Known gaps left in the foundation

* `OpenFile` carries no filename, so a native share or save presents the file as
  `<id>.bin`. The web path names it (`a.download = …`). Add a `.name` sidecar
  beside the existing `.mime` one when the documents wave needs it.
* `appStore` and `bulkStore` share one `localStorage` namespace on web but are
  separate directories on native. A key written through one and read through the
  other works in the browser and returns `null` on a device.
* `styles.ts` still has no `healthGrid`; `.user-row` is approximated.
* `form.tsx` has no `focusField(name)`, which `signin` uses for its
  "Use email and password" button.

## Fixed in the foundation

* `storage/index.ts` held a **literal NUL byte**, which made the module binary
  to git (`Bin 0 -> 18867 bytes`, no diff) and invisible to `grep`. Replaced
  with a `\0` escape — same value at runtime, plain text on disk.
* `bytesFromBase64` silently corrupted base64url input: it stripped `-` and `_`
  as if they were padding instead of decoding them as 62 and 63.
* The access token had two documented homes. `net.ts` owns it; the
  `StorageKeys.accessToken` entry is gone.
* `EXPO_PUBLIC_API_ORIGIN` was read by `net.ts` and set nowhere, so every
  `/api/*` call throws in a release native build. Documented in
  `app/.env.example`; a build still needs it set.
* `expo-file-system` was imported but undeclared, resolving only through a
  transitive hoist from `expo`. Now pinned in `app/package.json`.
* `form.tsx` wrote to refs during render in four places. React Compiler is on,
  so it may skip a render and take the assignment with it. Now refreshed in a
  layout effect.

## Carried into wave 3 (from the waves 0-2 review)

Everything the reviewer raised was fixed in place except these, which are not
defects in waves 0-2 but obligations on the waves that consume them.

* **`gapSeverity`, not `masteryTone`, on a gap card.** `masteryTone` has three
  bands because a report does; the diagnostic gap list has two and never says
  "secure" - a closed gap is not listed. `analytics.gapSeverity` is the
  two-way form. Using the wrong one captions an 85%-mastery gap
  "secure learning gap".
* **`useThemePreference` has to be wired by the shell.** The hook now exists
  (`@/shared/hooks/use-theme-preference`) and owns `StorageKeys.theme`, but
  nothing renders a toggle yet. `IconButton` is already there for the sun/moon
  control; wave 6's shell is where `choice`/`setChoice` land. React Native has
  no `data-theme`, so the resolved value has to reach `useAppStyles` rather
  than being written onto a root element.
* **`PageHead` cannot reproduce the mobile FAB.** The web floats the PRIMARY
  button only, below 760px, out of the `.button-row` and into a fixed corner
  (`right:15px; bottom:78px`). There is no RN equivalent of `position:fixed`
  inside a row - it has to be an absolutely positioned sibling of the page
  ScrollView. Two of the fifteen `PageHead` sites carry a secondary button
  alongside; those stay in the row.
* **`signOut` does not navigate.** The web did `location.replace("/signin")`.
  `useSession().signOut` clears the session and stops; the caller routes.
  `LegalPage` takes `onBack`/`onAction` callbacks for the same reason.
* **`OAuthButtonRow`'s `login` variant takes `onEmail`** because `form.tsx` has
  no `focusField`. The web focused the email input directly
  (`frontend/app/signin/page.tsx:126`). Either `form.tsx` gains `focusField`,
  or the screen holds its own ref.
* **`PickedDocument` and `PickedFile` are two structurally identical types** in
  two modules, kept apart so `shared/` does not import `features/`. A caller
  holding both should convert explicitly rather than assume they are assignable.

## Waves 4-7: the workspace shell landed (2026-09-15)

`/app` exists. Before this, every teacher and school administrator who signed in
reached a 404: all the pages and dialogs had been ported, and nothing assembled
them. Driven in Chrome against the local stack - teacher and SchoolAdmin sign-in,
every module visited, no page errors, no failed API calls.

| New file | Ported from |
|---|---|
| `src/app/app.tsx` | `FunctionalEduAIApp` - the gate: splash, /signin, profile completion, Parent -> /parent |
| `src/features/workspace/screens/workspace.tsx` | `WorkspaceApp` + `TeacherApp` |
| `src/features/workspace/components/dialog-registry.tsx` | `AppDialog` - all 52 dialog names, `never`-checked |
| `src/features/admin/components/admin-apps.tsx` | `SchoolAdminApp`, `PrincipalApp`, `PlatformApp` |
| `src/features/teacher/components/{work,xray}.tsx` | `Work`, `AssessmentDecision`, `AssessmentJourney`, `XRay` |
| `src/features/grading/components/{review,per-file-grade}.tsx` | `Review`, `PerFileGradeDialog` |
| `src/features/documents/components/worksheet-dialog.tsx` | `WorksheetDialog` |

Fixed in the foundation on the way, because the shell was the first thing to
exercise them together:

* **`Grid.span` / `cardSpan2` set `flexBasis: 100%`.** Correct in a wrapping row,
  wrong on a page: `flexBasis` follows the parent's main axis, so a span card
  placed directly in a screen's vertical stack grew to the scroll view's height.
  Width only now.
* **The appearance toggle restyled nothing.** Every style reads
  `useColorScheme`, which only knew the device. `@/shared/hooks/scheme-override`
  is the in-app choice; `useThemePreference` publishes to it. Not
  `Appearance.setColorScheme`, which react-native-web does not implement.
* **The web export could not build** once a route reached `lib/pdf.ts`: jspdf's
  `node` build calls AMD `require([...])`, which Metro cannot transform, and
  static rendering resolves under the `node` condition. `metro.config.js`
  resolves jspdf to its ES build on every platform.
* **Django's dev CORS allowed only :3000**, the retiring Next.js app. The Expo web
  app on :8081 had every Django response refused by the browser.
* A brand-new teacher has no assessments, so `selected` is undefined. The web's
  `Review` crashed on it; the shell shows an empty state, and the registry
  guards the 18 dialogs that read it.

Known follow-ups, none blocking - each was reported by the agent that ported the
file, and each is either web parity or needs a shared-kit change:

* **Review:** on a device, "jump to question" only expands it - the shell needs to
  hand down a scroll handle. `reviewSummaryCompact` lacks the web's
  `margin-bottom:-148px` above 1050px, so the question navigator sits ~160px low
  on wide screens. No clipboard module: "Copy" opens the share sheet on native.
* **Per-file grade:** `Select` has no option groups, so the question-paper picker
  is one flat list. The evaluator review panel is unreachable, exactly as on the
  web - `useGradeRun` never sets `pendingAnalysis`.
* **Worksheet:** Language and the two "Include..." checkboxes are shown and never
  sent - web parity.
* **X-Ray:** its class/subject scope is chosen once per visit - web parity.
* **SchoolAdmin:** Students and Reports carry two page headings - web parity.
  In dark mode `listItemAction` (navy) is low-contrast on the dark surface.
* **Billing** (plan row 14.1) is web-only at the payment sheet; see
  `features/billing/lib/razorpay.ts`.

## The modal bug the port carried (found 2026-09-17)

`ModalShell` rendered the panel *inside* the backdrop's `Pressable` and stopped
outside-press dismissal with `onStartShouldSetResponder` on the panel. That is
the documented React Native way and it does not hold on react-native-web: a
click on a `TextInput` inside the panel still reached the backdrop's `onPress`,
so **clicking any field closed the dialog**. Every form in the workspace - add a
class, add a student, invite a user, every settings dialog - was unusable in a
browser, and nothing caught it because the port's checks were typecheck, lint
and rendering, none of which click anything.

The fix is structural: the backdrop is now an absolutely positioned sibling
behind the panel, so "outside" is a different element rather than an ancestor
whose handler has to be suppressed. Verified in Chrome that a field click,
select-all and typing all leave the dialog open, and that pressing outside still
closes it.

The general lesson for the remaining waves: a ported screen that typechecks and
renders has not been shown to *work*. Drive the interaction.

## Deleting `frontend/`: one blocker down

The Supabase CLI used to be a devDependency of `frontend/`, so every `make db-*`
target would have broken the day that directory went. It now lives in
`supabase/package.json`, beside the migrations it applies, depending on neither
client workspace.

What still has to move first: the 12 contract suites in `frontend/tests/`. Only
three of them guard frontend UI (`auth-ux`, `read-model`, `school-onboarding`);
the other nine - 129 of the 182 tests - guard `supabase/migrations`, `backend/`
or are pure logic, and have to survive.
