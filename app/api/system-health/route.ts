import { OPENAI_MODEL, verifyModel } from "../../../lib/openai";
// Genuine live probe of the two AI providers this app depends on.
// No fabricated numbers: each check makes a real, cheap request to the provider
// right now and reports whether it succeeded and how long it took.

type ProviderCheck = {
  provider: "mistral" | "openai";
  ok: boolean;
  ms: number;
  status?: number;
  error?: string;
};

async function checkMistral(apiKey: string | undefined): Promise<ProviderCheck> {
  if (!apiKey) return { provider: "mistral", ok: false, ms: 0, error: "MISTRAL_API_KEY is not set" };
  const startedAt = Date.now();
  try {
    const res = await fetch("https://api.mistral.ai/v1/models", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return { provider: "mistral", ok: res.ok, ms: Date.now() - startedAt, status: res.status };
  } catch (error) {
    return {
      provider: "mistral",
      ok: false,
      ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Request failed",
    };
  }
}

async function checkOpenAI(apiKey: string | undefined): Promise<ProviderCheck> {
  if (!apiKey) return { provider: "openai", ok: false, ms: 0, error: "Learning-analysis service is not configured" };
  const startedAt = Date.now();
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return { provider: "openai", ok: res.ok, ms: Date.now() - startedAt, status: res.status };
  } catch (error) {
    return {
      provider: "openai",
      ok: false,
      ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Request failed",
    };
  }
}

export async function GET() {
  const apiKey = process.env.OPENAI_API_KEY;
  const [mistral, openai, model] = await Promise.all([
    checkMistral(process.env.MISTRAL_API_KEY),
    checkOpenAI(apiKey),
    // Reaching the API is not the same as the configured model existing. A
    // wrong model id fails every grading run while the provider looks healthy,
    // so it is checked explicitly rather than discovered in production.
    apiKey
      ? verifyModel(apiKey)
      : Promise.resolve({ model: OPENAI_MODEL, ok: false as const, ms: 0, error: "OPENAI_API_KEY is not set" }),
  ]);
  return Response.json({
    checkedAt: new Date().toISOString(),
    providers: [mistral, openai],
    model,
  });
}
