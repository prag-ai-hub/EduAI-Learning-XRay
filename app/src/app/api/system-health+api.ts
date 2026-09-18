import { aiProxyConfigured, health as proxyHealth } from "@/server/ai-proxy";

// Genuine live probe, with no fabricated numbers: the check below makes a real
// request right now and reports whether it succeeded and how long it took.
//
// It probes one thing, the AI proxy, because that is the only thing this app
// can reach. The route used to describe a `ProviderCheck` per provider and call
// Mistral and OpenAI itself; the keys moved to Django, so naming a provider
// here would be reporting on something this side no longer talks to.

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
    model: proxy.model ?? { checkedBy: "django", ok: false },
  });
}
