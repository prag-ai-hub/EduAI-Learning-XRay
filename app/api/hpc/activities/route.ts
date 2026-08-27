import { getAuthorizedProfile } from "../../../../lib/authorization";
import { getSupabaseServer } from "../../../../lib/supabase-server";

export async function GET(request: Request) {
  const profile = await getAuthorizedProfile(request);
  if (profile instanceof Response) return profile;
  if (!profile.school_id) return Response.json({ error: "A school profile is required." }, { status: 403 });
  const { data, error } = await getSupabaseServer().from("hpc_activities")
    .select("id,title,activity_prompt,assessment_method,pedagogies_json,rubric_json,activity_date,status,academic_year")
    .eq("school_id", profile.school_id).order("activity_date", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ activities: data || [] });
}

export async function POST(request: Request) {
  const profile = await getAuthorizedProfile(request);
  if (profile instanceof Response) return profile;
  if (!profile.school_id) return Response.json({ error: "A school profile is required." }, { status: 403 });
  const body = await request.json() as Record<string, unknown>;
  const title = String(body.title || "").trim(), prompt = String(body.activityPrompt || "").trim();
  if (title.length < 2 || prompt.length < 2) return Response.json({ error: "Enter an activity title and prompt." }, { status: 400 });
  const db = getSupabaseServer();
  const { data: framework, error: frameworkError } = await db.from("hpc_framework_versions").select("id").eq("status", "approved").order("source_published_at", { ascending: false }).limit(1).maybeSingle();
  if (frameworkError || !framework) return Response.json({ error: "No approved HPC framework is available." }, { status: 400 });
  const pedagogies = Array.isArray(body.pedagogies) ? body.pedagogies.map(String).filter(Boolean) : [];
  const { data, error } = await db.from("hpc_activities").insert({ school_id: profile.school_id, academic_year: String(body.academicYear || "2026-27"), framework_version_id: framework.id, title, activity_prompt: prompt, assessment_method: String(body.assessmentMethod || "").trim() || null, pedagogies_json: pedagogies, rubric_json: { teacher_created: true, descriptors: [] }, activity_date: String(body.activityDate || "") || null, status: "draft", created_by: profile.id }).select("id,title,activity_prompt,status").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ activity: data }, { status: 201 });
}
