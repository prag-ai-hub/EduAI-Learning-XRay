# HPC remediation and retest — 31 August 2026

Scope: HPC only. Original Learning X-Ray site/database unchanged. Google deferred; the eight previously blocked cases remain outside this pass.

## Local fixes (not published or browser-accepted yet)

- Existing same-school active student can be linked to an HPC profile without inserting a duplicate student. Duplicate academic-year profile returns 409.
- Learner creation refreshes downstream learner options through a shared event, without remounting forms or discarding their drafts.
- Six-statement scoring rejects non-Middle grades; perspective/count/override inputs and framework-matched abilities are validated.
- Progress clears old learner data while loading and ignores stale requests.
- Corrected attendance request type to reflect the string values submitted by HTML forms.

## Executed checks

| Check | Actual result | Qualification |
|---|---|---|
| Automated suite | 78 passed, 0 failed | Includes source-contract tests; not 78 browser journeys |
| Production build | Passed | Before attendance type-only change |
| Application TypeScript check | Passed (`npm run typecheck`) | Fixed UI/attendance/worker types. Unused, standalone `examples/d1` is excluded from the application config; its optional Drizzle example is not certified. |
| Published session restoration | Passed | Existing teacher session restored; fresh credential login not tested |
| Attendance 0% | Saved and returned as 0 | Synthetic Grade 7 learner |
| Attendance 100% | Saved and persisted after module reopen | Context/resources also persisted |
| Attendance -1 and 101 | Browser rejected with range underflow/overflow | Direct API negative requests not executed |
| Peer exclusion persistence | Entry absent from moderation queue and approved learner timeline after reopen | Full final-report exclusion still not tested |
| Activity creation | Synthetic dated activity saved and available after reopen | Term/mapping/full lifecycle not completed |
| Rubric capture | Three descriptors submitted; UI reported success | Persisted descriptor inspection still pending |
| Teacher observation | Synthetic activity-linked observation submitted with Proficient/High | Bulk entry and full attribution inspection still pending |

Do not treat locally fixed cases as acceptance passes until the changed build is exercised. The original 55-case document remains an earlier baseline, not a sign-off of these new changes.
