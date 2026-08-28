const ALLOWED_AUTH_PATHS = new Set([
  "authorize",
  "callback",
  "logout",
  "otp",
  "recover",
  "resend",
  "settings",
  "signup",
  "token",
  "user",
  "verify",
]);

async function proxyAuth(request: Request) {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const publishableKey = (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY)?.trim();
  if (!supabaseUrl || !publishableKey) {
    return Response.json({ error: "Teacher authentication is not configured." }, { status: 503 });
  }

  const incomingUrl = new URL(request.url);
  const path = (incomingUrl.searchParams.get("path") || "").replace(/^\/+|\/+$/g, "");
  const rootPath = path.split("/")[0];
  if (!path || !ALLOWED_AUTH_PATHS.has(rootPath)) {
    return Response.json({ error: "Unsupported authentication operation." }, { status: 400 });
  }

  const target = new URL(`${supabaseUrl}/auth/v1/${path}`);
  incomingUrl.searchParams.forEach((value, key) => {
    if (key !== "path") target.searchParams.append(key, value);
  });

  const headers = new Headers();
  headers.set("apikey", publishableKey);
  const authorization = request.headers.get("authorization");
  const contentType = request.headers.get("content-type");
  const clientInfo = request.headers.get("x-client-info");
  if (authorization) headers.set("authorization", authorization);
  if (contentType) headers.set("content-type", contentType);
  if (clientInfo) headers.set("x-client-info", clientInfo);

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
      redirect: "manual",
      signal: AbortSignal.timeout(25000),
    });
    const responseHeaders = new Headers({
      "cache-control": "no-store",
      "content-type": upstream.headers.get("content-type") || "application/json",
    });
    const location = upstream.headers.get("location");
    if (location) responseHeaders.set("location", location);
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError"
      ? "The authentication service did not respond in time. Please try again."
      : "The authentication service is temporarily unavailable.";
    return Response.json({ error: message, message }, { status: 504, headers: { "cache-control": "no-store" } });
  }
}

export const GET = proxyAuth;
export const POST = proxyAuth;
export const PUT = proxyAuth;
export const DELETE = proxyAuth;
