export async function GET() {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !publishableKey) {
    return Response.json({ error: "Teacher authentication is not configured." }, { status: 503 });
  }
  return Response.json({ url, publishableKey }, {
    headers: { "cache-control": "public, max-age=300" },
  });
}
