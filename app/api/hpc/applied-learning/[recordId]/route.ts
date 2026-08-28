import { getAuthorizedProfile } from "../../../../../lib/authorization";
import { getSupabaseServer } from "../../../../../lib/supabase-server";

const allowedTypes=["group_project","problem_inquiry","classroom_interaction","online_course","community_skill"];
const allowedStatuses=["planned","in_progress","completed"];

async function ownedRecord(request:Request,recordId:string){
  const profile=await getAuthorizedProfile(request); if(profile instanceof Response)return profile;
  const {data}=await getSupabaseServer().from("hpc_applied_learning_records").select("*").eq("id",recordId).eq("school_id",profile.school_id).maybeSingle();
  return data?{profile,record:data}:Response.json({error:"Applied-learning record not found."},{status:404});
}

export async function GET(request:Request,{params}:{params:Promise<{recordId:string}>}){
  const {recordId}=await params,found=await ownedRecord(request,recordId); if(found instanceof Response)return found;
  const db=getSupabaseServer();
  const [members,stages,milestones,barriers,proof]=await Promise.all([
    db.from("hpc_applied_learning_members").select("*,hpc_learner_profiles(id,students(name))").eq("applied_learning_record_id",recordId),
    db.from("hpc_applied_learning_stage_reviews").select("*").eq("applied_learning_record_id",recordId).order("stage_number"),
    db.from("hpc_applied_learning_milestones").select("*").eq("applied_learning_record_id",recordId).order("due_date"),
    db.from("hpc_applied_learning_barriers").select("*").eq("applied_learning_record_id",recordId).order("created_at",{ascending:false}),
    db.from("hpc_applied_learning_course_proofs").select("*").eq("applied_learning_record_id",recordId).maybeSingle(),
  ]);
  return Response.json({record:found.record,members:members.data||[],stages:stages.data||[],milestones:milestones.data||[],barriers:barriers.data||[],courseProof:proof.data||null});
}

export async function PATCH(request:Request,{params}:{params:Promise<{recordId:string}>}){
  const {recordId}=await params,found=await ownedRecord(request,recordId); if(found instanceof Response)return found;
  const body=await request.json() as Record<string,unknown>,type=String(body.recordType||found.record.record_type),status=String(body.completionStatus||found.record.completion_status),title=String(body.title||"").trim();
  if(!allowedTypes.includes(type)||title.length<3||!allowedStatuses.includes(status))return Response.json({error:"Enter a valid title, record type, and completion status."},{status:400});
  const number=(value:unknown)=>value===""||value===null||value===undefined?null:Number(value);
  const {data,error}=await getSupabaseServer().from("hpc_applied_learning_records").update({
    record_type:type,title,prompt_text:String(body.promptText||"").trim()||null,interaction_type:String(body.interactionType||"").trim()||null,
    stage_number:number(body.stageNumber),hours_spent:number(body.hoursSpent),completion_status:status,term_label:String(body.termLabel||"").trim()||null,
    class_context:String(body.classContext||"").trim()||null,learner_reflection:String(body.learnerReflection||"").trim()||null,
    teacher_assessment:String(body.teacherAssessment||"").trim()||null,peer_feedback:String(body.peerFeedback||"").trim()||null,
    teacher_comments:String(body.teacherComments||"").trim()||null,barriers_text:String(body.barriersText||"").trim()||null,
    schedule_json:{guiding_questions:String(body.guidingQuestions||"").trim()},rubric_json:{final_rubric:String(body.finalRubric||"").trim()},
    credits_json:{credits:number(body.credits)||0},updated_by:found.profile.id,updated_at:new Date().toISOString()
  }).eq("id",recordId).select("*").single();
  if(error)return Response.json({error:error.message},{status:500}); return Response.json({record:data});
}
