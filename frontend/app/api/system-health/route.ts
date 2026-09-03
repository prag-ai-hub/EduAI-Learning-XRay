import { aiProxyConfigured, health as proxyHealth } from "../../../lib/ai-proxy";

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

/**
 * Provider reachability now belongs to the Django service: it holds the keys,
 * so it is the only side that can verify them. This app can honestly report
 * two things - whether the proxy is configured here, and whether it answers.
 */
async function checkAiProxy(request: Request) {
  const startedAt = Date.now();
  if (!aiProxyConfigured()) {
    return {
      provider: "ai-proxy" as const, ok: false, ms: 0,
      error: "DJANGO_API_URL is not set: AI features are unavailable in this environment.",
      model: { model: null, ok: false, error: "No analysis service configured." },
    };
  }
  try {
    // One metadata lookup, not a completion: it proves the proxy is reachable
    // and that the configured model exists, without spending tokens.
    const report = await proxyHealth(request);
    return {
      provider: "ai-proxy" as const,
      ok: report.model.ok,
      ms: Date.now() - startedAt,
      ...(report.model.ok ? {} : { error: report.model.error || "Model check failed." }),
      model: report.model,
    };
  } catch (cause) {
    return {
      provider: "ai-proxy" as const, ok: false, ms: Date.now() - startedAt,
      error: cause instanceof Error ? cause.message : "The analysis service did not respond.",
      model: { model: null, ok: false, error: "Model could not be verified." },
    };
  }
}

export async function GET(request: Request) {
  const proxy = await checkAiProxy(request);
  return Response.json({
    checkedAt: new Date().toISOString(),
    providers: [proxy],
    // The model id is the Django service's to know and verify - it is the side
    // holding the key. Reporting a guess here would be worse than reporting
    // nothing, because a wrong model fails every grading run while this page
    // still looks healthy.
    // The model id is the analysis service's to know and verify - it is the
    // side holding the key.
    model: proxy.model ?? { checkedBy: "django", ok: false },
  });
}
