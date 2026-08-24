# ADR-001: Normalized immutable evaluation versions

Status: Accepted for the first evaluator increment.

## Decision

Keep the existing workspace snapshot as a compatibility read model, but make an immutable `evaluation_versions` row the authoritative record for each submitted evaluator decision. The server canonicalizes question decisions and page dispositions, recomputes totals, hashes the snapshot, and assigns the next version number. Submitted rows are never edited in place.

## Consequences

- Reports can identify the exact grading version they use.
- Regrades create another version and preserve the earlier decision.
- Aggregate scores alone are insufficient for a new evaluation.
- The initial increment records one logical page disposition because the current OCR contract returns document text rather than page images. Page records and regions are a subsequent schema/UI slice.
- `submitted` is not equivalent to moderated, finalized, or published. Those transitions require the moderation slice.
