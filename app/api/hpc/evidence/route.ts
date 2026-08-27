import { getAuthorizedProfile } from "../../../../lib/authorization";
import { getSupabaseServer } from "../../../../lib/supabase-server";

const validSources = new Set(["teacher_observation", "student_reflection", "peer_feedback", "parent_feedback", "portfolio"]);
export async function GET(request: Request) {
  const profile = await getAuthorizedProfile(request); if (profile instanceof Response) return profile;
  if (!profile.school_id) return Response.json({ error: "A school profile is required." }, { status: 403 });
  const { data, error } = await getSupabaseServer().from("hpc_evidence").select("id,learner_profile_id,activity_id,source_type,content,review_status,sufficiency_status,observed_at").eq("school_id", profile.school_id).order("observed_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 }); return Response.json({ evidence: data || [] });
}
export async function POST(request: Request) {
  const profile = await getAuthorizedProfile(request); if (profile instanceof Response) return profile;
  if (!profile.school_id) return Response.json({ error: "A school profile is required." }, { status: 403 });
  const body = await request.json() as Record<string, unknown>, sourceType = String(body.sourceType || ""), content = String(body.content || "").trim(), learnerProfileId = String(body.learnerProfileId || "");
  if (!validSources.has(sourceType) || !learnerProfileId || content.length < 2) return Response.json({ error: "Choose a learner, evidence perspective, and note." }, { status: 400 });
  const db = getSupabaseServer(); const [{ data: learner }, { data: framework }] = await Promise.all([db.from("hpc_learner_profiles").select("id,academic_year").eq("id", learnerProfileId).eq("school_id", profile.school_id).maybeSingle(), db.from("hpc_framework_versions").select("id").eq("status", "approved").order("source_published_at", { ascending: false }).limit(1).maybeSingle()]);
  if (!learner || !framework) return Response.json({ error: "The selected learner or framework is unavailable." }, { status: 400 });
  const contributor = sourceType === "teacher_observation" ? "teacher" : sourceType === "student_reflection" ? "student" : sourceType === "peer_feedback" ? "peer" : sourceType === "parent_feedback" ? "parent" : "teacher";
  const { data, error } = await db.from("hpc_evidence").insert({ school_id: profile.school_id, learner_profile_id: learner.id, activity_id: String(body.activityId || "") || null, academic_year: learner.academic_year, framework_version_id: framework.id, source_type: sourceType, contributor_type: contributor, contributor_user_id: profile.id, content, review_status: "teacher_review_required", sufficiency_status: "teacher_review_required" }).select("id,source_type,content,review_status").single();
  if (error) return Response.json({ error: error.message }, { status: 500 }); return Response.json({ evidence: data }, { status: 201 });
}
