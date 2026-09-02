import { getAuthorizedProfile, requireRole } from "../../../../lib/authorization";
import { getSupabaseServer } from "../../../../lib/supabase-server";

/**
 * Cross-school counts for SuperAdmin. De-identified by construction — no
 * student names are selected. Reading a named student's work requires an
 * explicit support_access_grants row (see requireSchoolScope).
 */
export async function GET(request: Request) {
  const profile = await getAuthorizedProfile(request);
  const denied = requireRole(profile, "SuperAdmin");
  if (denied) return denied;

  const { data, error } = await getSupabaseServer().rpc("platform_school_summary");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ schools: data ?? [] });
}
