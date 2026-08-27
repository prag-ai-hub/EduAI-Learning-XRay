import { getAuthorizedProfile } from "../../../../../../lib/authorization";
import { getSupabaseServer } from "../../../../../../lib/supabase-server";

export async function POST(request: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const profile = await getAuthorizedProfile(request); if (profile instanceof Response) return profile;
  if (!profile.school_id) return Response.json({ error: "A school profile is required." }, { status: 403 });
  const { activityId } = await params; const body = await request.json() as Record<string, unknown>, db = getSupabaseServer();
  const { data: activity } = await db.from("hpc_activities").select("id,school_id,framework_version_id").eq("id", activityId).eq("school_id", profile.school_id).maybeSingle();
  if (!activity) return Response.json({ error: "Activity not found." }, { status: 404 });
  const competencyId = String(body.competencyId || ""), domainId = String(body.domainId || "");
  const { data: competency } = await db.from("hpc_competencies").select("id,curricular_goal_id,hpc_curricular_goals!inner(domain_id)").eq("id", competencyId).maybeSingle();
  if (!competency || (competency.hpc_curricular_goals as { domain_id?: string }).domain_id !== domainId) return Response.json({ error: "Select a competency from the chosen domain." }, { status: 400 });
  const { data, error } = await db.from("hpc_activity_mappings").insert({ activity_id: activity.id, domain_id: domainId, competency_id: competencyId, learning_outcome_id: String(body.learningOutcomeId || "") || null, ability_id: String(body.abilityId || "") || null }).select("id").single();
  if (error) return Response.json({ error: error.message }, { status: 500 }); return Response.json({ mapping: data }, { status: 201 });
}
