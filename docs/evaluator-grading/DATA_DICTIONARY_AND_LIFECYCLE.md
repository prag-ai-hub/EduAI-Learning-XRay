# Data dictionary and lifecycle

## Tables introduced

- `assessment_versions`: frozen/versioned grading package envelope and checksum.
- `evaluation_drafts`: future autosave/concurrency record; introduced additively but not yet used by the first UI slice.
- `evaluation_versions`: immutable evaluator submission with canonical JSON, total, hash, idempotency key, and lineage pointer.
- `report_versions`: report-to-evaluation lineage and staleness state; generation wiring is deferred.

Question, criterion, evidence, attempt state, and page disposition fields are stored inside the immutable canonical snapshot in this slice. They can be projected into normalized child tables when page-region and moderation workflows land without changing the version contract.

## Active lifecycle

`OCR validated -> AI proposal -> evaluator review -> server validation -> submitted -> reports generated`

Target lifecycle still to implement:

`submitted -> moderation_pending -> finalized -> published`

Only `submitted` is produced by this increment. The application must not label it moderated or finalized.
