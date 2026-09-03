export async function GET() {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !publishableKey) {
    return Response.json({ error: "Teacher authentication is not configured." }, { status: 503 });
  }
  // Base URL of the Django service. The browser calls it directly with the
  // Supabase access token, so Django's CORS allowlist must name this origin.
  // Empty when the service is not deployed yet: the client treats that as
  // "the new surfaces are unavailable" rather than guessing a URL.
  const djangoApiUrl = process.env.DJANGO_API_URL || "";
  return Response.json({ url, publishableKey, djangoApiUrl }, {
    headers: { "cache-control": "public, max-age=300" },
  });
}
