import { getAuthorizedProfile } from "../../../../lib/authorization";
import { getSupabaseServer } from "../../../../lib/supabase-server";

export async function GET(request: Request) {
  const profile = await getAuthorizedProfile(request); if (profile instanceof Response) return profile;
  const learnerId = new URL(request.url).searchParams.get("learnerId") || "";
  if (!learnerId) return Response.json({ error: "Choose a learner." }, { status: 400 });
  const { data, error } = await getSupabaseServer().from("hpc_holistic_support_actions")
    .select("id,title,action_plan,review_date,status,source_type,ability_id,evidence_id,hpc_abilities(label),hpc_evidence(source_type,content)")
    .eq("school_id", profile.school_id).eq("learner_profile_id", learnerId).order("created_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ actions: data || [] });
}

export async function POST(request: Request) {
  const profile = await getAuthorizedProfile(request); if (profile instanceof Response) return profile;
  const body = await request.json() as Record<string, unknown>, learnerId = String(body.learnerId || ""), title = String(body.title || "").trim(), actionPlan = String(body.actionPlan || "").trim();
  if (title.length < 3 || actionPlan.length < 5) return Response.json({ error: "Give the support action a title and a practical plan." }, { status: 400 });
  const db = getSupabaseServer();
  const { data: learner } = await db.from("hpc_learner_profiles").select("id").eq("id", learnerId).eq("school_id", profile.school_id).maybeSingle();
  if (!learner) return Response.json({ error: "Learner not found." }, { status: 404 });
  const { data, error } = await db.from("hpc_holistic_support_actions").insert({ school_id: profile.school_id, learner_profile_id: learner.id, ability_id: String(body.abilityId || "") || null, evidence_id: String(body.evidenceId || "") || null, title, action_plan: actionPlan, review_date: String(body.reviewDate || "") || null, status: "planned", source_type: "holistic_hpc", created_by: profile.id }).select("*").single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ action: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const profile = await getAuthorizedProfile(request); if (profile instanceof Response) return profile;
  const body = await request.json() as Record<string, unknown>, id = String(body.id || ""), status = String(body.status || "");
  if (!['planned', 'active', 'completed'].includes(status)) return Response.json({ error: "Choose a valid support status." }, { status: 400 });
  const { data, error } = await getSupabaseServer().from("hpc_holistic_support_actions").update({ status }).eq("id", id).eq("school_id", profile.school_id).select("id,status").maybeSingle();
  if (error || !data) return Response.json({ error: error?.message || "Support action not found." }, { status: error ? 500 : 404 });
  return Response.json({ action: data });
}
