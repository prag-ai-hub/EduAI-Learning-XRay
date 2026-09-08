# Feature slices

One directory per feature. A slice owns its own network calls, screens, hooks and
components, and takes only the sub-folders it needs:

    features/<feature>/
      api/          calls this feature makes (always via authApi)
      screens/      route-level components
      components/   presentational pieces used only by this feature
      hooks/        stateful logic used only by this feature
      cache/        local persistence for this feature

## Rules

* Something two features need moves to `@/shared`. If only one feature needs it,
  it stays in that slice.
* `shared/` must never import from `features/`. The arrow points one way.
* Every network call goes through `authFetch` from `features/auth/api/authApi.ts`.
* Server-only modules (imported by `src/app/api/**+api.ts` and nothing else) live
  in `@/server`, not here - they run on the server and must never reach a bundle.

## Slices

| Slice          | Owns                                                       |
|----------------|------------------------------------------------------------|
| `auth`         | sign-in, sign-up, OAuth, the profile gate, `authFetch`      |
| `marketing`    | the public home page and its illustrations                 |
| `workspace`    | the app shell, sidebar, topbar, sync and session            |
| `teacher`      | the teacher modules: home, work, X-Ray, reports, students   |
| `grading`      | the grading run, evaluator workspace, OCR validation, review|
| `assessments`  | create, upload, bulk analysis, delete                       |
| `documents`    | worksheets, study guides, PDF generation and downloads      |
| `admin`        | school directory, system health, school/principal/platform  |
| `parent`       | the parent portal and the parent share dialog               |
| `share`        | the public `share/[token]` report                           |
| `legal`        | privacy and terms                                           |

Slices other than `auth` land as the screens port over from the retiring
`frontend/` tree; `auth` is the one that exists today.
