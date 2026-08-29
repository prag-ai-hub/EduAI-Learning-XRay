import { getAuthorizedProfile, requireAdmin } from "../../../../lib/authorization";
import { getSupabaseServer } from "../../../../lib/supabase-server";

export async function GET(request:Request){
  const profile=await getAuthorizedProfile(request);if(profile instanceof Response)return profile;const denied=requireAdmin(profile);if(denied)return denied;
  const db=getSupabaseServer(),schoolId=String(profile.school_id);
  const [{data:learners},{data:evidence},{data:assessments},{data:actions},{data:applied},{data:reports}]=await Promise.all([
    db.from("hpc_learner_profiles").select("id,grade,academic_year,context_json").eq("school_id",schoolId),
    db.from("hpc_evidence").select("id,learner_profile_id,source_type,review_status,sufficiency_status").eq("school_id",schoolId),
    db.from("hpc_ability_assessments").select("learner_profile_id,ability_id,perspective,calculated_level,teacher_override_level,hpc_abilities(code,label)").eq("school_id",schoolId),
    db.from("hpc_holistic_support_actions").select("learner_profile_id,status").eq("school_id",schoolId),
    db.from("hpc_applied_learning_records").select("learner_profile_id,completion_status").eq("school_id",schoolId),
    db.from("hpc_annual_summaries").select("learner_profile_id,status").eq("school_id",schoolId)
  ]);
  const groups=new Map<string,any>();
  for(const learner of learners||[]){
    const section=String((learner.context_json as any)?.section||"Not set"),key=`Grade ${learner.grade||"—"} · ${section} · ${learner.academic_year}`;
    const group=groups.get(key)||{grade:learner.grade,section,academicYear:learner.academic_year,learners:0,finalized:0,evidenceApproved:0,evidencePending:0,insufficient:0,appliedComplete:0,appliedTotal:0,supportActive:0,perspectives:new Set<string>(),levels:new Map<string,Record<string,number>>()};
    group.learners++;
    const le=(evidence||[]).filter(x=>x.learner_profile_id===learner.id);group.evidenceApproved+=le.filter(x=>x.review_status==="approved").length;group.evidencePending+=le.filter(x=>x.review_status!=="approved").length;group.insufficient+=le.filter(x=>x.sufficiency_status&&x.sufficiency_status!=="sufficient").length;le.filter(x=>x.review_status==="approved").forEach(x=>group.perspectives.add(x.source_type));
    const la=(assessments||[]).filter(x=>x.learner_profile_id===learner.id);for(const a of la){const label=(a.hpc_abilities as any)?.label||"Ability",bands=group.levels.get(label)||{beginner:0,proficient:0,advanced:0},level=a.teacher_override_level||a.calculated_level;bands[level]=(bands[level]||0)+1;group.levels.set(label,bands)}
    const lap=(applied||[]).filter(x=>x.learner_profile_id===learner.id);group.appliedTotal+=lap.length;group.appliedComplete+=lap.filter(x=>x.completion_status==="completed").length;group.supportActive+=(actions||[]).filter(x=>x.learner_profile_id===learner.id&&x.status!=="completed").length;group.finalized+=(reports||[]).some(x=>x.learner_profile_id===learner.id&&x.status==="finalized")?1:0;groups.set(key,group);
  }
  const rows=[...groups.values()].map(g=>({...g,completionRate:g.learners?Math.round(g.finalized/g.learners*100):0,participationRate:g.learners?Math.round(g.perspectives.size/4*100):0,perspectives:[...g.perspectives],dimensionPatterns:[...g.levels.entries()].map(([ability,bands])=>({ability,bands}))}));
  return Response.json({context:"Aggregate, non-ranked HPC operational view. Small samples require local context.",sampleSize:(learners||[]).length,rows});
}
