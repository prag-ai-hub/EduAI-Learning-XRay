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

## Published follow-up (version 37)

Published successfully to the existing HPC test site, source `a7faf0a7a0e76a45feb96f3c7d608dd5e72105ac`. No live Learning X-Ray deployment or database was modified.

- Application typecheck: PASS. Production build: PASS. Automated tests: 78 passed, zero failed.
- Existing teacher session restoration: PASS (not a fresh password-login test).
- Existing-student duplicate academic-year guard: PASS; UI displayed the expected rejection.
- Existing-student reuse: PASS in browser. Created a clearly labelled synthetic Grade 8 / 2027–28 profile for the same QA student; student selector retained four roster entries while learner profiles increased from four to five.
- Immediate learner refresh: PASS in browser. New profile appeared in Choose HPC learner without reopening; previous selection remained selected.
- Wrong-stage scoring guard: PASS in browser. Grade 10 displayed the Secondary rubric guidance and no Middle count form.
- Sample narrow layout: client width 428, scroll width 428 (no horizontal overflow in that state). Not a full device matrix.
- Browser error log: no errors in sampled post-publication interactions.

Test fixtures were retained. Full 55-case acceptance, provider OAuth setup, rubric persistence/reporting and remaining workflow/security coverage are not signed off by this update. Google remains deferred and the eight previously blocked cases are skipped as requested.

## Version 38 follow-up

Published `476d73027e19d3a9a74f5857970979dddc08cb23`. Typecheck/build pass; 90 automated tests pass, including 12 database/storage-double route tests. Published rubric descriptor reload and annual blank draft generation passed. Grade 10 draft retained exactly its approved reflection after reopening; Grade 7 draft did not invent approved evidence.

Security tests cover role/flag denial, foreign learner shares and downloads, malformed/expired/revoked contribution tokens, and exclusion from final snapshot writes. They do not replace live cross-account tests. Microsoft remains disabled; credentials are not available. Support state transitions passed, but the Interventions UI reads workspace snapshots and did not show the HPC database record. No dedicated HPC bulk-observation workflow was found.

Updated DOCX: 23 PASS, 8 PARTIAL, 3 FAIL, 12 NOT TESTED, 8 BLOCKED (skipped), 1 DEFERRED. Structural QA passed; LibreOffice is missing, so document visual QA is unavailable. Remaining cases are not signed off.

## Version 39 follow-up

Published successfully to the same HPC-only site, source `4919998141c2643d7c6ea718bbc55ecceef5d94d`. Original Learning X-Ray site and database were not modified.

- Typecheck and production build passed; 93 automated tests passed, including 15 mocked database/storage route-handler regressions. These are not 93 end-to-end acceptance cases.
- Bulk teacher observations: two synthetic year-specific learner profiles saved distinct notes and confidence levels. Both records remained after reopening Holistic Progress and awaited moderation. Saved rows were disabled against accidental resubmission. Stable IDs and retries passed mocked route tests; actual connection interruption and 50-learner testing remain open.
- Interventions: both existing synthetic HPC support actions displayed. The planned action changed to active and retained that status after leaving and returning. The other completed action and review date displayed correctly. Full follow-up evidence lifecycle remains open.
- Sampled published page had no horizontal overflow (502px client and scroll widths) and no browser error logs. This is not real-device or full accessibility certification.
- Updated 55-case register: **23 PASS, 10 PARTIAL, 1 FAIL, 12 NOT TESTED, 8 BLOCKED (skipped), 1 DEFERRED**. Two FAIL cases moved to PARTIAL, not PASS, because broader coverage is still incomplete. Remaining failure is Microsoft provider configuration; Google stays deferred.
- Updated DOCX regenerated and structurally checked: 55 unique case IDs, valid ZIP/package. Visual rendering remains unavailable because LibreOffice/soffice is not installed.

No full acceptance sign-off. Remaining tests include uploaded-file journeys, contributor sharing/revocation, evidence-detail/mapping, full applied-learning lifecycle, broader accessibility and interrupted-connection behavior. Retained TEST ONLY records are deliberate test fixtures.

## Continued published-v39 acceptance testing

No application source or deployment changed in this pass. Used only synthetic HPC records.

- TC-041 approved-evidence draft: PASS for draft scope. Teacher-edited Grade 10 narrative, strengths, next steps and notes survived reopening with exact QA40 text. No finalization attempted.
- TC-025 evidence mapping: PARTIAL. Grade 7 BULK39 observation mapped to Science/SCCG1/SCC1.1/Awareness, approved as test evidence and visible after reopen in View mappings. No outcome option available for that competency; Academic X-Ray reference journey remains.
- TC-030 wheel/detail: PARTIAL. Teacher count 3 produced Awareness 3/6 Proficient in the profile; evidence click-through displayed correct text and mapping. Full perspectives and accessibility remain.
- TC-037 context/barrier/score: PARTIAL. Inquiry term/class and structured Monitoring barrier persisted after confirmed save and reopen. Initial rapid sequential saves did not retain term/class; second save awaited visible Saved confirmation and persisted. No claim of concurrent-save reliability. Existing barrier/milestone rows have no edit controls in the sampled UI; lifecycle remains incomplete. Official-score workflow was not finalized.
- Narrow screenshot inspected: form labels and fields readable; horizontal navigation scroll is visible. Not a full device matrix or complete keyboard test.

Current 55-case counts: **24 PASS, 12 PARTIAL, 1 FAIL, 9 NOT TESTED, 8 BLOCKED (skipped), 1 DEFERRED**. Three formerly untested cases are now partial; one draft case is now passed. Microsoft remains the failed provider configuration; missing Entra access was not bypassed. Remaining partial/unexecuted work is not finished.

## Published version 40 — implemented lifecycle repairs

Source `afd90963b964452f67c1b1ce6de3708561b9778f`, deployment succeeded on HPC only.

- Added milestone and barrier status controls with disabled saving state and recoverable error messages.
- PATCH endpoints validate status and constrain item updates to the authorized same-school parent record. Mocked route tests cover successful changes, invalid status, unrelated item and foreign-school record.
- Applied-learning creation/edit reject negative/nonfinite hours and credits and invalid stages/statuses; creation retains zero hours. Secondary membership requires integer Grade 9–12.
- Typecheck, production build and all 98 automated tests passed. Build includes nonfatal bundle-size warnings; this is not performance certification.
- Published browser check: existing teacher session restored. Synthetic milestone updated to completed and barrier to resolved; both persisted after Home → HPC reopening, with term/class unchanged. Sampled browser error log was empty.
- No original Learning X-Ray source, site or database modified. No database migration applied. Retained test records remain synthetic.

Whole-site acceptance remains open. This repair does not certify file-transfer, external contribution, full group-project/final-score, load/interruption or full device journeys. Report remains an interim register, not a final bug-free certificate.

## Version 41 — record-switching defect discovered and repaired

Published source `85e415b2aceef5f11b44a0b6ea6d4734eaa8d897`; 99 automated tests, typecheck and build pass.

During v40 browser testing, five TEST ONLY completed classroom records were saved: Discussion (0h), Debate (1h), Simulation/role play (1.5h), Laboratory activity (2h), Digital learning (0.5h). Their list values matched. Switching from the old inquiry to digital learning changed the heading but left old form values: a real stale-editor defect. No save was attempted with those incorrect values.

v41 keys the edit form to the record and hides it until the loaded ID matches the selection, preventing stale-record editing. This is separate from full inquiry, group-project, final rubric and file-proof acceptance.

Published v41 browser retest passed for switching Digital learning → original inquiry → Discussion: title, interaction type, hours and status matched each distinct record; digital reflection/teacher assessment also matched. Discussion retained 0 hours. Browser error log empty in this sampled retest. TC-036 moves from untested to partial, not full pass, because inquiry/final-rubric coverage remains incomplete. No claim of complete site acceptance.

## Versions 42-45 — sharing safeguards and responsive repairs

Published to the HPC-only test site through source `df8fb51db59b4011a2a00d5b7e2594434681beda`. The original Learning X-Ray source, database and site were not modified.

- Public contribution now rechecks the school feature flag and resolves the active framework from the learner's actual grade/stage. Route tests cover disabled-school denial and Grade 7 Middle-framework selection.
- Generated peer/parent contribution URLs remain visibly selectable when browser clipboard access fails. A new live share and revocation were not executed because those actions create and revoke externally usable access; existing link history rendered correctly.
- Bulk observation filters no longer expose a database `null` grade as a class. Ungraded learners are labelled `Grade not set` and cannot be selected. The sampled Grade 10 learner cannot choose Middle performance levels; the Grade 7 learner can.
- Mobile testing found and repaired a real 36px horizontal overflow caused by intrinsic select width. Published retest measured client width equal to document width at phone (375px), tablet (753px) and desktop (1425px). Tablet header clutter was also repaired.
- Scoped accessibility checks found 121 labelled form controls, 80 nonempty button names, and one H1. The sampled published browser log contained no warnings or errors. This is not keyboard-only, screen-reader, zoom-200%, cross-browser or physical-device certification.
- TypeScript check, production build and all 103 automated tests pass. The build still reports a nonfatal large-chunk warning; this is not performance certification.

The acceptance register remains an interim report. Fresh controlled authentication, Microsoft provider configuration, two-school RLS, live contributor identity/revocation, representative file round-trips, full group-project/final-score workflows, positive immutable finalization, and physical assistive-technology/device tests remain outside demonstrated sign-off.
