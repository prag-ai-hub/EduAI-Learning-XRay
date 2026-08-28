import { getAuthorizedProfile } from "../../../../../../../lib/authorization";
import { getSupabaseServer, SUPABASE_FILES_BUCKET } from "../../../../../../../lib/supabase-server";

export async function GET(request:Request,{params}:{params:Promise<{recordId:string}>}){
  const profile=await getAuthorizedProfile(request);if(profile instanceof Response)return profile;const {recordId}=await params,db=getSupabaseServer();
  const {data:record}=await db.from("hpc_applied_learning_records").select("id").eq("id",recordId).eq("school_id",profile.school_id).maybeSingle();if(!record)return Response.json({error:"Applied-learning record not found."},{status:404});
  const {data:proof}=await db.from("hpc_applied_learning_course_proofs").select("proof_reference,uploaded_by").eq("applied_learning_record_id",recordId).maybeSingle();if(!proof)return Response.json({error:"No course proof is attached."},{status:404});
  let reference:any;try{reference=JSON.parse(proof.proof_reference)}catch{return Response.json({error:"The stored proof reference is invalid."},{status:422})}const fileId=String(reference.fileId||""),owner=String(proof.uploaded_by||profile.id);if(!fileId)return Response.json({error:"No proof file is attached."},{status:404});
  const {data,error}=await db.storage.from(SUPABASE_FILES_BUCKET).download(`${owner}/uploads/${fileId}`);if(error||!data)return Response.json({error:"Proof file was not found."},{status:404});
  return new Response(data,{headers:{"content-type":data.type||reference.fileType||"application/octet-stream","content-disposition":`attachment; filename="${String(reference.fileName||"course-proof").replace(/[\r\n"]/g,"-")}"`,"cache-control":"private, max-age=60"}});
}
