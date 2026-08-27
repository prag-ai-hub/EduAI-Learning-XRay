import { getAuthorizedProfile } from "../../../../lib/authorization";
import { getSupabaseServer } from "../../../../lib/supabase-server";

export async function GET(request: Request) {
  const profile=await getAuthorizedProfile(request); if(profile instanceof Response)return profile;
  const learnerId=new URL(request.url).searchParams.get("learnerId")||""; if(!learnerId)return Response.json({error:"Choose a learner."},{status:400});
  const db=getSupabaseServer(); const {data:learner}=await db.from("hpc_learner_profiles").select("id,students(name),academic_year").eq("id",learnerId).eq("school_id",profile.school_id).maybeSingle(); if(!learner)return Response.json({error:"Learner not found."},{status:404});
  const {data:evidence,error}=await db.from("hpc_evidence").select("id,source_type,content,attachment_reference,review_status,sufficiency_status,observed_at").eq("school_id",profile.school_id).eq("learner_profile_id",learnerId).order("observed_at",{ascending:false}); if(error)return Response.json({error:error.message},{status:500});
  const approved=(evidence||[]).filter(item=>item.review_status==="approved"), ids=approved.map(item=>item.id);
  const [{data:mappings},{data:observations}]=ids.length?await Promise.all([db.from("hpc_evidence_mappings").select("evidence_id,competency_id,learning_outcome_id,ability_id,hpc_competencies(code,label),hpc_learning_outcomes(code,label),hpc_abilities(label)").in("evidence_id",ids),db.from("hpc_teacher_observations").select("evidence_id,performance_level_id,hpc_performance_levels(label)").in("evidence_id",ids)]):[{data:[]},{data:[]}];
  const mapped=new Set((mappings||[]).map(item=>item.evidence_id)), unmapped=approved.filter(item=>!mapped.has(item.id)); const sources=new Set(approved.map(item=>item.source_type));
  const levelByEvidence=new Map((observations||[]).map((item:any)=>[item.evidence_id,item.hpc_performance_levels?.label||item.performance_level_id])); const competencyLevels=new Map<string,Set<string>>();
  for(const item of mappings||[]){const level=levelByEvidence.get(item.evidence_id);if(level&&item.competency_id){const set=competencyLevels.get(item.competency_id)||new Set<string>();set.add(level);competencyLevels.set(item.competency_id,set)}}
  const conflicts=[...competencyLevels.entries()].filter(([,levels])=>levels.size>1).map(([competencyId,levels])=>({competencyId,levels:[...levels]}));
  return Response.json({learner,approved,evidence:evidence||[],mappings:mappings||[],summary:{approvedCount:approved.length,pendingCount:(evidence||[]).filter(item=>item.review_status==="teacher_review_required").length,unmappedCount:unmapped.length,missingPerspectives:["teacher_observation","student_reflection","peer_feedback","parent_feedback"].filter(source=>!sources.has(source)),conflicts}});
}
