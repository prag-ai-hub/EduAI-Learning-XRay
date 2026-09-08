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

  constructor(
    message: string,
    status: number,
    code = "error",
    fields: Record<string, string[]> = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
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
      fields[field] = Array.isArray(value) ? value.map(String) : [String(value)];
    }
    const first = Object.values(fields)[0]?.[0];
    if (first) return new ApiError(first, status, code, fields);
  }
  return new ApiError("That request could not be completed.", status, code);
}
