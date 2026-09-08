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
