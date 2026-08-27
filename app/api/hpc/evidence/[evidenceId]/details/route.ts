import { getAuthorizedProfile } from "../../../../../../lib/authorization";
import { getSupabaseServer } from "../../../../../../lib/supabase-server";

export async function POST(request: Request, { params }: { params: Promise<{ evidenceId: string }> }) {
  const profile = await getAuthorizedProfile(request); if (profile instanceof Response) return profile;
  if (!profile.school_id) return Response.json({ error: "A school profile is required." }, { status: 403 });
  const { evidenceId } = await params, body = await request.json() as Record<string, unknown>, db = getSupabaseServer();
  const { data: evidence } = await db.from("hpc_evidence").select("id,source_type,school_id").eq("id", evidenceId).eq("school_id", profile.school_id).maybeSingle();
  if (!evidence) return Response.json({ error: "Evidence not found." }, { status: 404 });
  if (evidence.source_type === "teacher_observation") { const confidence=String(body.confidence||""); if (!["low","medium","high"].includes(confidence)) return Response.json({error:"Choose confidence."},{status:400}); const {error}=await db.from("hpc_teacher_observations").upsert({evidence_id:evidence.id,performance_level_id:String(body.performanceLevelId||"")||null,confidence,observation_notes:String(body.notes||"").trim(),approval_status:"draft"},{onConflict:"evidence_id"}); if(error)return Response.json({error:error.message},{status:500}); }
  if (evidence.source_type === "student_reflection") { const {error}=await db.from("hpc_student_reflections").upsert({evidence_id:evidence.id,reflection:String(body.reflection||"").trim(),learning_text:String(body.learning||"").trim(),practice_needed:String(body.practiceNeeded||"").trim(),help_needed:String(body.helpNeeded||"").trim()},{onConflict:"evidence_id"}); if(error)return Response.json({error:error.message},{status:500}); }
  if (evidence.source_type === "peer_feedback") { const feedback=String(body.feedback||"").trim(); if(feedback.length<2)return Response.json({error:"Enter peer feedback."},{status:400}); const {error}=await db.from("hpc_peer_feedback").upsert({evidence_id:evidence.id,reviewer_learner_profile_id:String(body.reviewerLearnerProfileId||"")||null,feedback,moderation_status:"pending"},{onConflict:"evidence_id"}); if(error)return Response.json({error:error.message},{status:500}); }
  if (evidence.source_type === "parent_feedback") { const feedback=String(body.feedback||"").trim(); if(feedback.length<2)return Response.json({error:"Enter parent or caregiver feedback."},{status:400}); const {error}=await db.from("hpc_parent_feedback").upsert({evidence_id:evidence.id,feedback,support_commitment:String(body.supportCommitment||"").trim()||null,partnership_status:"teacher_review_required"},{onConflict:"evidence_id"}); if(error)return Response.json({error:error.message},{status:500}); }
  return Response.json({ok:true});
}
