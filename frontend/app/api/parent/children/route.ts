import { getAuthorizedProfile, requireRole } from "../../../../lib/authorization";
import { getSupabaseServer } from "../../../../lib/supabase-server";

/**
 * Every linked child's teacher-approved reports and resources.
 *
 * The shape is decided by parent_child_reports() in the database, which selects
 * field by field: OCR transcripts, AI rationale and other students are
 * structurally absent rather than filtered out here.
 */
export async function GET(request: Request) {
  const profile = await getAuthorizedProfile(request);
  const denied = requireRole(profile, "Parent");
  if (denied) return denied;
  if (profile instanceof Response) return profile;

  const { data, error } = await getSupabaseServer().rpc("parent_child_reports", {
    p_parent_user_id: profile.id,
  });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ children: data ?? [] }, { headers: { "cache-control": "private, no-store" } });
}
