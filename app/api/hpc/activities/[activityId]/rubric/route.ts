import { getAuthorizedProfile } from "../../../../../../lib/authorization";
import { getSupabaseServer } from "../../../../../../lib/supabase-server";

const levels = new Set(["beginner", "proficient", "advanced"]);
export async function POST(request: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const profile = await getAuthorizedProfile(request); if (profile instanceof Response) return profile;
  if (!profile.school_id) return Response.json({ error: "A school profile is required." }, { status: 403 });
  const { activityId } = await params, body = await request.json() as Record<string, unknown>;
  const descriptors = Array.isArray(body.descriptors) ? body.descriptors.map(item => ({ level: String((item as Record<string, unknown>).level || ""), text: String((item as Record<string, unknown>).text || "").trim() })).filter(item => levels.has(item.level) && item.text.length >= 2) : [];
  if (!descriptors.length) return Response.json({ error: "Provide at least one teacher-created descriptor." }, { status: 400 });
  const { data, error } = await getSupabaseServer().from("hpc_activities").update({ rubric_json: { teacher_created: true, descriptors } }).eq("id", activityId).eq("school_id", profile.school_id).select("id,rubric_json").maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 }); if (!data) return Response.json({ error: "Activity not found." }, { status: 404 });
  return Response.json({ activity: data });
}
