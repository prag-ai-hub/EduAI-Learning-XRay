import {getAuthorizedProfile} from "../../../../../lib/authorization";
import {getSupabaseServer} from "../../../../../lib/supabase-server";
type Entry={learnerId:string;note:string;confidence:string;performanceLevelId?:string};
export async function POST(request:Request){
 const profile=await getAuthorizedProfile(request);if(profile instanceof Response)return profile;
 const body=await request.json(),entries:Entry[]=Array.isArray(body.entries)?body.entries:[];
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(body.batchId||""))||!entries.length||entries.length>50||entries.some(e=>!e||typeof e!=="object"))return Response.json({error:"Choose 1–50 learners and a valid batch ID."},{status:400});
 if(new Set(entries.map(e=>e.learnerId)).size!==entries.length||entries.some(e=>!e.learnerId||String(e.note||"").trim().length<2||!["low","medium","high"].includes(e.confidence)))return Response.json({error:"Each learner needs an observation and valid confidence."},{status:400});
 const db=getSupabaseServer(),ids=entries.map(e=>e.learnerId);
 const {data:learners,error:learnerError}=await db.from("hpc_learner_profiles").select("id,academic_year,grade").eq("school_id",profile.school_id).in("id",ids);
 if(learnerError)return Response.json({error:"Unable to verify learners."},{status:503});
 if(learners?.length!==entries.length)return Response.json({error:"All learners must belong to your school."},{status:403});
 const activityId=String(body.activityId||"");
 if(activityId){const {data}=await db.from("hpc_activities").select("id").eq("id",activityId).eq("school_id",profile.school_id).maybeSingle();if(!data)return Response.json({error:"Activity not found."},{status:404})}
 const results=[];
 for(const entry of entries){
  try{
   const learner=learners.find(l=>l.id===entry.learnerId)!;
   const {data:template,error:templateError}=await db.from("hpc_stage_templates").select("framework_version_id,hpc_framework_versions!inner(status)").eq("is_active",true).eq("hpc_framework_versions.status","approved").lte("grade_from",learner.grade).gte("grade_to",learner.grade).order("created_at",{ascending:false}).limit(1).maybeSingle();
   if(templateError||!template||learner.grade===null)throw Error("Approved stage framework unavailable.");
   if(entry.performanceLevelId){const {data}=await db.from("hpc_performance_levels").select("id").eq("id",entry.performanceLevelId).eq("framework_version_id",template.framework_version_id).maybeSingle();if(!data)throw Error("Performance level does not belong to this learner's framework.")}
   const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(`${profile.id}:${body.batchId}:${entry.learnerId}`));const hex=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,"0")).join("");const id=`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
   const {data:existing}=await db.from("hpc_evidence").select("id,review_status,contributor_user_id").eq("id",id).eq("school_id",profile.school_id).maybeSingle();
   if(existing&&existing.review_status!=="teacher_review_required")throw Error("This observation has already been moderated; start a new batch to record more evidence.");
   const {error}=await db.from("hpc_evidence").upsert({id,school_id:profile.school_id,learner_profile_id:learner.id,academic_year:learner.academic_year,framework_version_id:template.framework_version_id,activity_id:activityId||null,source_type:"teacher_observation",contributor_type:"teacher",contributor_user_id:profile.id,content:entry.note.trim(),review_status:"teacher_review_required",sufficiency_status:"teacher_review_required"},{onConflict:"id"});if(error)throw Error(error.message);
   const {error:detailError}=await db.from("hpc_teacher_observations").upsert({evidence_id:id,performance_level_id:entry.performanceLevelId||null,confidence:entry.confidence,observation_notes:entry.note.trim(),approval_status:"draft"},{onConflict:"evidence_id"});if(detailError)throw Error(detailError.message);
   results.push({learnerId:entry.learnerId,ok:true,evidenceId:id});
  }catch(e){results.push({learnerId:entry.learnerId,ok:false,error:e instanceof Error?e.message:"Unable to save observation."})}
 }
 return Response.json({results},{status:results.every(r=>r.ok)?200:207});
}
