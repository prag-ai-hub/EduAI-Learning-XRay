/**
 * Server-side client for the Django AI proxy.
 *
 * The provider keys used to live in this app; they now live in the Django
 * service alone. These routes send the prompt and get the completion back,
 * having never held the credential.
 *
 * This runs in the Worker, never in the browser. The caller's Supabase token is
 * forwarded so Django can resolve who is asking and apply their capabilities -
 * the proxy is not an open relay, and a Parent or SchoolAdmin token is refused
 * there rather than here.
 */

const DJANGO_API_URL = () => process.env.DJANGO_API_URL?.trim().replace(/\/$/, "") || "";

export class AiProxyError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AiProxyError";
    this.status = status;
  }
}

/** The bearer token this request arrived with, to forward onward. */
function bearer(request: Request): string {
  const header = request.headers.get("authorization") || "";
  if (!header.toLowerCase().startsWith("bearer ")) {
    throw new AiProxyError("Sign in again to continue.", 401);
  }
  return header;
}

async function call<T>(request: Request, path: string, payload: unknown): Promise<T> {
  const base = DJANGO_API_URL();
  if (!base) {
    // Explicit rather than silent: without the service there is no key to fall
    // back to, because this app no longer holds one.
    throw new AiProxyError(
      "AI features are unavailable: the analysis service is not configured for this environment.",
      503,
    );
  }

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Authorization: bearer(request) },
      body: JSON.stringify(payload),
    });
  } catch (cause) {
    throw new AiProxyError(
      `The analysis service could not be reached: ${cause instanceof Error ? cause.message : "network error"}`,
      502,
    );
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = (body as { error?: { detail?: unknown } })?.error?.detail;
    const message =
      typeof detail === "string" ? detail : "The analysis service rejected the request.";
    throw new AiProxyError(message, response.status);
  }
  return body as T;
}

export type Completion = {
  content: string;
  model: string;
  usage: { prompt_tokens: number | null; completion_tokens: number | null };
};

/**
 * One chat completion through the proxy.
 *
 * `redact` names values that must not reach the provider - a student's name
 * above all. Django replaces each with a placeholder before the call and maps
 * it back on the response, and refuses to send at all if the replacement
 * failed. Passing the name here is what fixes the leak in the grading prompt.
 */
export async function complete(
  request: Request,
  options: {
    messages: { role: "system" | "user" | "assistant"; content: string }[];
    redact?: Record<string, string>;
    response_format?: Record<string, unknown>;
    temperature?: number;
  },
): Promise<Completion> {
  const redact = Object.fromEntries(
    Object.entries(options.redact || {}).filter(([, value]) => (value || "").trim().length > 1),
  );
  return call<Completion>(request, "/api/v1/ai/completions", { ...options, redact });
}

export type OcrResult = { text: string; pages: number };

/** OCR one document or image, sent as a base64 data URL. */
export async function ocr(
  request: Request,
  options: { kind: "document" | "image"; dataUrl: string },
): Promise<OcrResult> {
  return call<OcrResult>(request, "/api/v1/ai/ocr", {
    kind: options.kind,
    data_url: options.dataUrl,
  });
}

export type AiHealth = {
  openai_configured: boolean;
  mistral_configured: boolean;
  model: { model: string | null; ok: boolean; ms?: number; error?: string };
};

/**
 * Provider health, answered by the side that holds the keys.
 *
 * Includes whether the configured model actually exists for that key: a
 * reachable provider with a wrong model id fails every grading run while the
 * service looks healthy.
 */
export async function health(request: Request): Promise<AiHealth> {
  const base = DJANGO_API_URL();
  if (!base) throw new AiProxyError("The analysis service is not configured.", 503);
  const response = await fetch(`${base}/api/v1/ai/health`, {
    cache: "no-store",
    headers: { Authorization: bearer(request) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new AiProxyError("The analysis service did not respond.", response.status);
  return body as AiHealth;
}

/** Whether the analysis service is configured here at all. */
export function aiProxyConfigured(): boolean {
  return Boolean(DJANGO_API_URL());
}
