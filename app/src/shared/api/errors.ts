/**
 * The Django service answers failures as `{"error": {"code", "detail"}}`.
 * `detail` is whatever DRF produced: a string for a permission failure, or a
 * map of field to messages for a validation failure.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Field-level messages, when the failure was validation. */
  readonly fields: Record<string, string[]>;
  /**
   * The envelope's `detail`, exactly as the server sent it.
   *
   * `fields` flattens everything to strings, which is right for a form but
   * lossy for an error that is a list of objects - the roster import answers
   * `{rows: [{row: 2, detail: "..."}]}`, and a caller that wants to point at
   * line 2 needs the number. Kept raw here so nothing has to re-parse a
   * sentence to recover what the server already knew.
   */
  readonly detail: unknown;

  constructor(
    message: string,
    status: number,
    code = "error",
    fields: Record<string, string[]> = {},
    detail: unknown = undefined,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.detail = detail;
  }

  /** True when signing in again could plausibly help. */
  get isAuthProblem(): boolean {
    return this.status === 401;
  }
}

/** Flatten the envelope into one readable sentence, keeping the field map. */
export function toApiError(status: number, body: unknown): ApiError {
  const envelope = (body as { error?: { code?: string; detail?: unknown } })?.error;
  const detail = envelope?.detail;
  const code = envelope?.code || "error";

  if (typeof detail === "string") return new ApiError(detail, status, code);

  if (detail && typeof detail === "object") {
    const fields: Record<string, string[]> = {};
    for (const [field, value] of Object.entries(detail as Record<string, unknown>)) {
      fields[field] = (Array.isArray(value) ? value : [value]).map(readable);
    }
    const first = Object.values(fields)[0]?.[0];
    if (first) return new ApiError(first, status, code, fields, detail);
  }
  return new ApiError("That request could not be completed.", status, code, {}, detail);
}

/**
 * One entry of a field map, as text a person can read.
 *
 * `String(value)` was here, which is correct for the string case and produces
 * the literal "[object Object]" for every other - so an error that arrived as
 * a list of objects reached the screen as that, and the real message was lost.
 * An object carrying its own `detail` is unwrapped to it; anything else is
 * shown as JSON, which is ugly and still tells you what happened.
 */
function readable(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const nested = (value as { detail?: unknown }).detail;
    if (typeof nested === "string") {
      const row = (value as { row?: unknown }).row;
      return typeof row === "number" ? `Row ${row}: ${nested}` : nested;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
