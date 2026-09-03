/**
 * Single source of truth for the OpenAI model.
 *
 * The model id was hardcoded as "gpt-5.6-sol" in four separate route files.
 * That string does not correspond to a published OpenAI model, so every AI
 * feature would fail with model-not-found regardless of the API key — and
 * fixing it meant editing four files.
 *
 * It is now one env var with one default. Set OPENAI_MODEL to whatever the
 * account actually has; /api/system-health verifies the configured value
 * against the account and reports it rather than leaving it to be discovered
 * in a failed grading run.
 */
export const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-5.6-sol";

export const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1";

/** Confirms the configured model is actually available to this key. */
export async function verifyModel(apiKey:string, model = OPENAI_MODEL){
  const started = Date.now();
  try{
    const res = await fetch(`${OPENAI_BASE_URL}/models/${encodeURIComponent(model)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) return { model, ok:true as const, ms: Date.now() - started };
    return {
      model, ok:false as const, ms: Date.now() - started, status: res.status,
      error: res.status === 404
        ? `Model "${model}" is not available to this API key. Set OPENAI_MODEL to a model the account has.`
        : `Model check failed with HTTP ${res.status}.`,
    };
  }catch(cause){
    return { model, ok:false as const, ms: Date.now() - started,
             error: cause instanceof Error ? cause.message : "Model check failed" };
  }
}
