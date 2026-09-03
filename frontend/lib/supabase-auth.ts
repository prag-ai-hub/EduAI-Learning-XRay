import { getSupabaseServer } from "./supabase-server";

export async function getAuthenticatedUser(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return null;
  const { data, error } = await getSupabaseServer().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

export function unauthorized() {
  return Response.json({ error: "Please sign in to continue." }, { status: 401 });
}
