import { getAuthorizedProfile } from "../../../../lib/authorization";
import { getSupabaseServer } from "../../../../lib/supabase-server";

type Check={code:string;label:string;passed:boolean;detail:string};
const sourceLabels:Record<string,string>={teacher_observation:"teacher observation",student_reflection:"learner self-assessment",peer_feedback:"peer input",parent_feedback:"parent/caregiver input"};

async function context(schoolId:string,learnerId:string){
  const db=getSupabaseServer();
  const {data:learner}=await db.from("hpc_learner_profiles").select("id,academic_year,grade,attendance_percentage,interests_json,context_json,students(id,name,roll_number),school_id").eq("id",learnerId).eq("school_id",schoolId).maybeSingle();
  if(!learner)return null;
  const stageCode=Number(learner.grade)<=5?(Number(learner.grade)<=2?"foundational":"preparatory"):(Number(learner.grade)<=8?"middle":"secondary");
  const {data:template}=await db.from("hpc_stage_templates").select("id,title,framework_version_id,hpc_template_sections(section_code,title,required,configuration_json,sort_order)").eq("stage_code",stageCode).eq("is_active",true).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if(!template)return {learner,stageCode,error:"No active approved HPC stage template is available."};
  const {data:framework}=await db.from("hpc_framework_versions").select("id,version_label,source_name,source_reference").eq("id",template.framework_version_id).eq("status","approved").maybeSingle();
  if(!framework)return {learner,stageCode,error:"No approved HPC framework version is available."};
  const [{data:evidence},{data:assessments},{data:feedback},{data:applied},{data:rule},{data:summary}]=await Promise.all([
    db.from("hpc_evidence").select("id,source_type,content,observed_at,sufficiency_status,contributor_name,attachment_reference").eq("school_id",schoolId).eq("learner_profile_id",learnerId).eq("review_status","approved").order("observed_at"),
    db.from("hpc_ability_assessments").select("id,ability_id,perspective,statement_count,calculated_level,teacher_override_level,evidence_note,hpc_abilities(code,label)").eq("school_id",schoolId).eq("learner_profile_id",learnerId),
    db.from("hpc_teacher_feedback").select("*").eq("school_id",schoolId).eq("learner_profile_id",learnerId).maybeSingle(),
    db.from("hpc_applied_learning_records").select("id,record_type,title,completion_status,teacher_assessment,hpc_applied_learning_final_assessments(assessment_status,scoring_basis,total_score,maximum_score,official_level_text)").eq("school_id",schoolId).eq("learner_profile_id",learnerId),
    db.from("hpc_scoring_rules").select("id,rule_code,source_name").eq("framework_version_id",framework.id).eq("stage_code",stageCode).eq("status","approved").maybeSingle(),
    db.from("hpc_annual_summaries").select("*,hpc_report_versions(id,version_number,created_at,content_sha256)").eq("school_id",schoolId).eq("learner_profile_id",learnerId).eq("academic_year",learner.academic_year).maybeSingle()
  ]);
  const evidenceIds=(evidence||[]).map(x=>x.id);
  const {data:mappings}=evidenceIds.length?await db.from("hpc_evidence_mappings").select("evidence_id,competency_id,learning_outcome_id,ability_id,hpc_competencies(code,label),hpc_learning_outcomes(code,label),hpc_abilities(code,label)").in("evidence_id",evidenceIds):{data:[]};
  return {learner,stageCode,framework,template,evidence:evidence||[],mappings:mappings||[],assessments:assessments||[],feedback,applied:applied||[],rule,summary};
}

function validate(c:any,teacherApproval:boolean){
  const sources=new Set(c.evidence.map((x:any)=>x.source_type));
  const levelMap=new Map<string,Set<string>>();
  for(const assessment of c.assessments){if(assessment.ability_id){const levels=levelMap.get(assessment.ability_id)||new Set<string>();levels.add(assessment.teacher_override_level||assessment.calculated_level);levelMap.set(assessment.ability_id,levels)}}
  const conflicts=[...levelMap.values()].filter(levels=>levels.size>1).length;
  const requiredSections=(c.template?.hpc_template_sections||[]).filter((x:any)=>x.required);
  const requiredPerspective=(key:string)=>requiredSections.some((s:any)=>s.configuration_json?.required_perspectives?.includes?.(key))||c.stageCode==="middle";
  const completedApplied=c.applied.filter((x:any)=>x.completion_status==="completed");
  const finalizedApplied=completedApplied.filter((x:any)=>{
    const reviews=Array.isArray(x.hpc_applied_learning_final_assessments)?x.hpc_applied_learning_final_assessments:[];
    return reviews.some((review:any)=>review.assessment_status==="finalized"&&Boolean(review.scoring_basis)&&Number(review.maximum_score)>0);
  });
  const teacherAssessmentPassed=c.stageCode==="secondary"
    ? finalizedApplied.some((x:any)=>Boolean(String(x.teacher_assessment||"").trim()))
    : sources.has("teacher_observation")&&c.assessments.some((x:any)=>x.perspective==="teacher");
  const officialScoringPassed=c.stageCode==="secondary"?finalizedApplied.length>0:Boolean(c.rule)&&c.assessments.length>0;
  const checks:Check[]=[
    {code:"stage_sections",label:"Mandatory stage sections",passed:Boolean(c.template)&&requiredSections.length>0,detail:c.template?`${requiredSections.length} required section(s) resolved from ${c.template.title}.`:"No active stage template."},
    {code:"teacher_assessment",label:"Teacher assessment",passed:teacherAssessmentPassed,detail:c.stageCode==="secondary"?"A completed applied-learning record needs a teacher assessment and finalized rubric.":"Approved observation and official ability assessment required."},
    ...["student_reflection","peer_feedback","parent_feedback"].map(source=>({code:source,label:sourceLabels[source],passed:!requiredPerspective(source)||sources.has(source),detail:requiredPerspective(source)?"Required for this stage.":"Not mandatory for this stage."})),
    {code:"applied_learning",label:"Mandatory applied learning",passed:c.stageCode!=="secondary"||completedApplied.length>0,detail:c.stageCode==="secondary"?"At least one completed applied-learning record is required.":"Not mandatory for this stage."},
    {code:"official_scoring",label:"Official scoring",passed:officialScoringPassed,detail:c.stageCode==="secondary"?(officialScoringPassed?`${finalizedApplied.length} finalized applied-learning rubric(s) resolved.`:"Finalize the official rubric for a completed project or inquiry."):(c.rule?`Approved rule: ${c.rule.rule_code}.`:"No approved scoring rule.")},
    {code:"evidence_mapping",label:"Evidence mappings",passed:c.evidence.length>0&&c.evidence.every((x:any)=>c.mappings.some((m:any)=>m.evidence_id===x.id)),detail:"Every approved evidence item must be mapped."},
    {code:"conflicts",label:"Unresolved conflicts",passed:conflicts===0,detail:conflicts?`${conflicts} ability conflict(s) require resolution.`:"No unresolved ability-level conflicts."},
    {code:"teacher_approval",label:"Teacher approval",passed:teacherApproval,detail:teacherApproval?"Teacher attestation recorded.":"Teacher must attest before finalization."}
  ];
  return {checks,passed:checks.every(x=>x.passed),checkedAt:new Date().toISOString()};
}

function narrative(c:any){
  const learner=c.learner.students?.name||"The learner";
  const evidence=c.evidence.slice(0,8).map((x:any)=>String(x.content).trim()).filter(Boolean);
  const levels=c.assessments.filter((x:any)=>x.perspective==="teacher").map((x:any)=>`${x.hpc_abilities?.label||"ability"}: ${x.teacher_override_level||x.calculated_level}`);
  return `${learner}'s draft annual holistic narrative is grounded in ${c.evidence.length} teacher-approved evidence item(s). ${levels.length?`Recorded holistic progress includes ${levels.join(", ")}. `:""}${evidence.length?`Evidence notes include: ${evidence.join("; ")}.`:"No approved evidence narrative is available yet."}`;
}

export async function GET(request:Request){
  const profile=await getAuthorizedProfile(request);if(profile instanceof Response)return profile;
  const learnerId=new URL(request.url).searchParams.get("learnerId")||"";
  const c=await context(String(profile.school_id),learnerId);if(!c)return Response.json({error:"Learner not found."},{status:404});
  if("error" in c)return Response.json({error:c.error},{status:409});
  return Response.json({...c,validation:validate(c,false)});
}

export async function POST(request:Request){
  const profile=await getAuthorizedProfile(request);if(profile instanceof Response)return profile;
  const body=await request.json() as Record<string,unknown>,learnerId=String(body.learnerId||""),action=String(body.action||"draft");
  const c=await context(String(profile.school_id),learnerId);if(!c)return Response.json({error:"Learner not found."},{status:404});if("error" in c)return Response.json({error:c.error},{status:409});
  if(c.summary?.status==="finalized")return Response.json({error:"This annual HPC is final and immutable."},{status:409});
  const generated=narrative(c),narrativeText=String(body.narrativeText||generated).trim(),validation=validate(c,body.teacherApproval===true);
  if(action==="validate")return Response.json({validation,generatedNarrative:generated});
  if(narrativeText.length<20)return Response.json({error:"A meaningful evidence-grounded narrative is required."},{status:400});
  if(action==="finalize"&&!validation.passed)return Response.json({error:"Finalization checks are incomplete.",validation},{status:422});
  const db=getSupabaseServer();
  const record={school_id:profile.school_id,learner_profile_id:learnerId,academic_year:c.learner.academic_year,stage_template_id:c.template!.id,framework_version_id:c.framework.id,scoring_rule_id:c.rule?.id||null,narrative_text:narrativeText,teacher_notes:String(body.teacherNotes||"").trim()||null,strengths_text:String(body.strengthsText||"").trim()||null,support_text:String(body.supportText||"").trim()||null,status:action==="finalize"?"finalized":"draft",validation_json:validation,finalized_by:action==="finalize"?profile.id:null,finalized_at:action==="finalize"?new Date().toISOString():null,created_by:profile.id,updated_at:new Date().toISOString()};
  const {data:summary,error}=await db.from("hpc_annual_summaries").upsert(record,{onConflict:"learner_profile_id,academic_year"}).select("*").single();if(error)return Response.json({error:error.message},{status:500});
  if(action!=="finalize")return Response.json({summary,validation,generatedNarrative:generated});
  const reportPayload={learner:c.learner,stage:{code:c.stageCode,title:c.template!.title,sections:c.template!.hpc_template_sections},framework:c.framework,scoringRule:c.rule,summary:record,assessments:c.assessments,feedback:c.feedback,appliedLearning:c.applied,evidenceCount:c.evidence.length};
  const encoded=new TextEncoder().encode(JSON.stringify(reportPayload));const digest=await crypto.subtle.digest("SHA-256",encoded);const hash=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
  const {data:version,error:versionError}=await db.from("hpc_report_versions").insert({annual_summary_id:summary.id,school_id:profile.school_id,version_number:1,report_payload:reportPayload,framework_version_label:c.framework.version_label,scoring_version_label:c.rule?.rule_code||null,approval_metadata:{approvedBy:profile.id,approvedAt:record.finalized_at,teacherAttestation:true},content_sha256:hash,created_by:profile.id}).select("*").single();if(versionError)return Response.json({error:versionError.message},{status:500});
  if(c.evidence.length){const snapshots=c.evidence.map((item:any)=>({report_version_id:version.id,school_id:profile.school_id,evidence_id:item.id,evidence_payload:item,mapping_payload:c.mappings.filter((m:any)=>m.evidence_id===item.id)}));const {error:snapshotError}=await db.from("hpc_report_evidence_snapshot").insert(snapshots);if(snapshotError)return Response.json({error:snapshotError.message},{status:500})}
  await db.from("audit_events").insert({school_id:profile.school_id,actor_id:profile.id,action:"hpc.annual_report.finalized",entity_type:"hpc_annual_summary",entity_id:summary.id,detail_json:{learnerProfileId:learnerId,academicYear:c.learner.academic_year,reportVersionId:version.id,contentSha256:hash,validation}});
  return Response.json({summary,version,validation,reportPayload});
}
