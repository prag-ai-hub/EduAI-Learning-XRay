import { getAuthorizedProfile } from "../../../../../../lib/authorization";
import { getSupabaseServer } from "../../../../../../lib/supabase-server";

export async function PATCH(request:Request,{params}:{params:Promise<{recordId:string}>}){
  const {recordId}=await params,found=await recordFor(request,recordId);
  if(found instanceof Response)return found;
  const body=await request.json().catch(()=>null);
  if(!body||typeof body.id!=="string"||!["open","monitoring","resolved"].includes(body.status))
    return Response.json({error:"Choose an existing item and a valid status."},{status:400});
  const {data,error}=await getSupabaseServer().from("hpc_applied_learning_barriers")
    .update({status:body.status}).eq("id",body.id).eq("applied_learning_record_id",recordId).select("*").maybeSingle();
  if(error)return Response.json({error:error.message},{status:500});
  if(!data)return Response.json({error:"Item not found in this record."},{status:404});
  return Response.json({item:data});
}

async function recordFor(request:Request,recordId:string){const profile=await getAuthorizedProfile(request);if(profile instanceof Response)return profile;const {data}=await getSupabaseServer().from("hpc_applied_learning_records").select("id").eq("id",recordId).eq("school_id",profile.school_id).maybeSingle();return data?{profile,record:data}:Response.json({error:"Applied-learning record not found."},{status:404})}
export async function POST(request:Request,{params}:{params:Promise<{recordId:string}>}){const {recordId}=await params,found=await recordFor(request,recordId);if(found instanceof Response)return found;const body=await request.json() as Record<string,unknown>,barrier=String(body.barrierText||"").trim(),status=String(body.status||"open");if(barrier.length<2||!["open","monitoring","resolved"].includes(status))return Response.json({error:"Enter a barrier and valid tracking status."},{status:400});const {data,error}=await getSupabaseServer().from("hpc_applied_learning_barriers").insert({applied_learning_record_id:recordId,barrier_text:barrier,support_action:String(body.supportAction||"").trim()||null,status,owner_label:String(body.ownerLabel||"").trim()||null,created_by:found.profile.id}).select("*").single();if(error)return Response.json({error:error.message},{status:500});return Response.json({barrier:data},{status:201})}
