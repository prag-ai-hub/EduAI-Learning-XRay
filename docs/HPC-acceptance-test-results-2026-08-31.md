# HPC acceptance test results — 31 August 2026

## Decision

**Not ready for complete acceptance sign-off.** Prompts 1–5 cannot yet be declared fully tested or complete. This is an interim test record, not a certification of all features or devices.

Scope: HPC test site and Supabase project `mncprowjqrtmuqvxrcqq` only. The original live Learning X-Ray site/database were not modified during this audit.

## Executed checks

| ID | Test procedure / expected result | Actual result | Status |
|---|---|---|---|
| AUTH-01 | Open hosted app with existing signed-in session; workspace should restore | Teacher workspace restored | PASS — smoke only |
| AUTH-02 | Inspect Google provider configuration; enabled with valid OAuth client expected | Provider disabled; Client ID contains an email address, not a Google OAuth client ID | FAIL |
| AUTH-03 | Inspect Microsoft provider availability | Azure/Microsoft provider disabled | FAIL |
| AUTH-04 | Verify fresh email/password login followed by reload and logout | Existing session tested, fresh credential submission not tested | NOT TESTED |
| SEC-01 | Request private APIs without authentication; access must be refused | Profile, workspace, HPC learners, evidence, annual reports and principal dashboard returned HTTP 401 | PASS — anonymous access only |
| P1-01 | Open Secondary learner mapping choices; correct stage catalogue expected | Domain options empty; global newest-framework selection found in code | FAIL — local fix prepared for Prompt 1 endpoint |
| P1-02 | Open Middle Stage foundation library; matching framework expected | Global framework selection could show unrelated stage | FAIL — local fix prepared |
| UI-01 | Reach all workspace sections using mobile navigation | Published mobile navigation limits items to first five | FAIL — local fix prepared |
| UI-02 | Inspect narrow layout; no document-level horizontal overflow expected | At measured 428px document width, content extended to 547px | FAIL — CSS fix prepared; visual retest pending |
| UI-03 | Inspect browser console during tested workspace navigation | No errors observed | PASS — sampled routes only |
| AUTO-01 | Run `node --test tests/*.test.mjs` | 72 passed, 0 failed; includes four added scoring boundary and perspective-separation tests | PASS — automated unit/source-contract suite |
| BUILD-01 | Run `npm run build` after local changes | Production build successful; large-chunk warning remains | PASS |

The automated suite includes source-contract assertions. Passing it does not prove live database persistence, cross-tenant isolation, Google OAuth, file handling, or complete learner journeys.

## Local changes awaiting verification and publication

- OAuth availability check with a useful message when Google/Microsoft is disabled; refreshed login error display.
- Prompt 1 framework lookup based on learner grade and active approved stage template.
- Middle Stage foundation overview selects the Middle Stage framework explicitly.
- All workspace sections included in horizontally scrollable mobile navigation.
- Narrow-screen form and metric sizing safeguards.

These changes do not enable Google authentication by themselves. No OAuth settings or credentials were saved during this audit.

## Remaining acceptance cases

| ID | Area | Required test and expected result | Current status |
|---|---|---|---|
| AUTH-05 | Google | New and returning Google user completes consent, callback, profile creation, reload and logout | BLOCKED — OAuth configuration |
| AUTH-06 | Email | New signup, verification link, login, invalid password, expired session and recovery | NOT TESTED end to end |
| P1-03 | Learner context | Link existing student; persist class, term, year, goals and stage-specific mappings | GAP FOUND — current learner creation creates a new student; full flow not verified |
| P1-04 | Stage catalogue | Test grade boundaries and correct subject/goal/competency/outcome choices across endpoints | PENDING — other endpoints still need stage-selection audit |
| P2-01 | Evidence | Save teacher rubric, self-reflection, peer and parent perspectives; moderate and reload | NOT TESTED end to end |
| P2-02 | Portfolio | Upload representative allowed files; view/download exact bytes; reject invalid and unauthorized files | NOT TESTED end to end |
| P2-03 | Sharing | Named contributor, expiry, revocation, history and unauthorized-token cases | NOT TESTED end to end |
| P3-01 | Progress | Approved evidence drives grid/wheel, details, gaps, conflicts and support actions | NOT TESTED end to end |
| P3-02 | Integration | HPC support actions connect safely to original app interventions within HPC environment | NOT TESTED end to end |
| P4-01 | Applied learning | Create/edit project, inquiry, interaction and course with context, mappings, milestones and barriers | NOT TESTED end to end |
| P4-02 | Scores and proof | Finalize rubric/official score, validate bounds and reopen course certificate | NOT TESTED end to end |
| P5-01 | Finalization | Complete representative record; checks pass; teacher approves; immutable snapshot persists | NOT TESTED — representative complete evidence needed |
| P5-02 | Outputs | Download valid complete PDF; verify parent view, permissions and finalized snapshot stability | NOT TESTED end to end |
| SEC-02 | Isolation | Two test users/tenants cannot read or modify each other's learners, evidence, files or reports | NOT TESTED |
| REG-01 | Learning X-Ray | Assessment through upload, grading, review, intervention and report in HPC copy | NOT TESTED full cycle — displayed account has zero credits |
| UI-04 | Responsive | Execute all key forms and detail views at desktop, laptop, tablet and phone widths; keyboard and touch checks | NOT VERIFIED — attempted viewport overrides did not change measured app viewport |

## Google configuration prerequisite

A Google Cloud OAuth Web Application client is required, with an actual Client ID and Client Secret. Access permission was subsequently granted, but Google account verification failed. The user has now deferred Google login. Do not share secrets in chat.

## Continued browser execution — Google deferred

The following checks used the hosted HPC teacher session and the existing synthetic learner `HPC QA Grade 10 Test Only`. No real learner's records were edited.

| ID | Procedure | Actual result | Status |
|---|---|---|---|
| P2-04 | Enter reflection, learning, practice-needed and help-needed fields; save | UI confirmed entry saved for teacher review | PASS — save response |
| P2-05 | Navigate Home and reopen HPC after reflection save | Synthetic reflection appeared in moderation queue | PASS — persistence |
| P2-06 | Approve only the newly created synthetic reflection, reopen HPC | Approved timeline showed the reflection and approved count 1 | PASS |
| P2-07 | Check sufficiency indicators for approved reflection with no mapping | Mapping gaps 1; teacher, peer and parent perspectives still missing | PASS — this scenario only |
| P4-03 | Open existing synthetic inquiry detail | Edit, term/class, schedule and barrier forms loaded | PASS — rendering only |
| P4-04 | Add a named synthetic milestone; navigate Home and reopen HPC | UI confirmed Saved; milestone reappeared with planned status | PASS — create and persistence |
| P5-03 | Run annual checks with incomplete synthetic evidence | UI confirmed refreshed checks; missing assessment, applied-learning completion, official rubric, mappings and teacher approval remained flagged | PASS — negative readiness scenario only |
| P3-03 | Inspect Grade 10 progress rule | Middle Stage six-statement rule displayed for Grade 10 | FAIL — stage/scoring mismatch remains |

Test data created: one synthetic learner reflection, explicitly approved for testing, and one planned milestone on the existing synthetic inquiry. The reflection's structured subfields were submitted, but their individual read-back has not yet been verified. These passes do not replace the remaining full perspective, file, sharing, scoring, finalization and responsive tests above.

- HPC origin: `https://eduai-learning-xray-hpc-test.accounts740459.chatgpt.site`
- Google authorized redirect URI: `https://mncprowjqrtmuqvxrcqq.supabase.co/auth/v1/callback`
- Supabase app redirect to verify: `https://eduai-learning-xray-hpc-test.accounts740459.chatgpt.site/app`

Use an HPC-only client and preserve the live site's configuration. After configuration, execute AUTH-05; an enabled toggle alone is not a passing login test.

References: [Supabase Google login](https://supabase.com/docs/guides/auth/social-login/auth-google), [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).
