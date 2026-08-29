# HPC Prompt 5 acceptance matrix

Scope: isolated HPC branch, HPC Supabase project, and HPC test site only. Academic X-Ray remains unchanged.

| ID | Acceptance area | Automated evidence | Status before hosted E2E |
|---|---|---|---|
| MH-01 | Stage-aware annual summary | Active stage template and required-section validation | Pass |
| MH-02 | Official domains and performance descriptors | Framework/scoring IDs and labels captured | Pass |
| MH-03 | Approved evidence only | API filters `review_status=approved` | Pass |
| MH-04 | Teacher-controlled narrative | Draft/edit/attest/finalize workflow | Pass |
| MH-05 | Mandatory perspective validation | Teacher, self, peer and parent checks | Pass |
| MH-06 | Applied-learning validation | Secondary completion check | Pass |
| MH-07 | Conflict and mapping validation | Ability conflict and evidence-mapping checks | Pass |
| MH-08 | Immutable version and snapshot | Database mutation triggers and SHA-256 digest | Pass |
| MH-09 | Stage-appropriate PDF | Framework, approval, results and evidence metadata; `%PDF-` check | Pass |
| MH-10 | Secure parent sharing | Expiring/revocable learner-specific read-only final-HPC link | Pass |
| MH-11 | Parent/peer privacy | No peer identity or restricted teacher notes in final share payload | Pass |
| MH-12 | Principal aggregate dashboard | Grade/section/year aggregates with sample size; no rankings | Pass |
| MH-13 | Tenant isolation and RLS | School filters, admin authorization and RLS-enabled final tables | Pass |
| MH-14 | Academic non-disruption | Additive routes/tables; no blended score or Academic schema mutation | Pass |
| MH-15 | Hosted end-to-end and responsive UI | Requires post-deployment browser verification | Pending |

Prompt 5 must not be labelled pilot-ready until MH-15 passes on the published HPC test site.
