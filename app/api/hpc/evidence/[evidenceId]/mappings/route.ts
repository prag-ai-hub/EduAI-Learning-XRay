import { getAuthorizedProfile } from "../../../../../../lib/authorization";
import { getSupabaseServer } from "../../../../../../lib/supabase-server";

export async function POST(request: Request, { params }: { params: Promise<{ evidenceId: string }> }) {
  const profile = await getAuthorizedProfile(request); if (profile instanceof Response) return profile;
  if (!profile.school_id) return Response.json({ error: "A school profile is required." }, { status: 403 });
  const { evidenceId } = await params, body = await request.json() as Record<string, unknown>, db = getSupabaseServer();
  const domainId=String(body.domainId||""), competencyId=String(body.competencyId||""), learningOutcomeId=String(body.learningOutcomeId||""), abilityId=String(body.abilityId||"");
  const {data:evidence}=await db.from("hpc_evidence").select("id,framework_version_id").eq("id",evidenceId).eq("school_id",profile.school_id).maybeSingle();
  if(!evidence)return Response.json({error:"Evidence not found."},{status:404});
  const {data:competency}=await db.from("hpc_competencies").select("id,curricular_goal_id,hpc_curricular_goals!inner(domain_id)").eq("id",competencyId).maybeSingle();
  if(!domainId||!competency||(competency.hpc_curricular_goals as {domain_id?:string}).domain_id!==domainId)return Response.json({error:"Choose a competency from the selected domain."},{status:400});
  if(learningOutcomeId){const {data}=await db.from("hpc_learning_outcomes").select("id,competency_id").eq("id",learningOutcomeId).maybeSingle();if(!data||data.competency_id!==competency.id)return Response.json({error:"Choose a learning outcome from the selected competency."},{status:400});}
  if(abilityId){const {data}=await db.from("hpc_abilities").select("id").eq("id",abilityId).eq("framework_version_id",evidence.framework_version_id).maybeSingle();if(!data)return Response.json({error:"Choose an ability from the approved framework."},{status:400});}
  const {data,error}=await db.from("hpc_evidence_mappings").insert({evidence_id:evidence.id,domain_id:domainId,competency_id:competencyId,learning_outcome_id:learningOutcomeId||null,ability_id:abilityId||null}).select("id").single();
  if(error)return Response.json({error:error.message},{status:500}); return Response.json({mapping:data},{status:201});
}
