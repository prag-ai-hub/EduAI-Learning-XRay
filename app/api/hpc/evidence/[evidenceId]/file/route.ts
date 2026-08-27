import { getAuthorizedProfile } from "../../../../../../lib/authorization";
import { getSupabaseServer, SUPABASE_FILES_BUCKET } from "../../../../../../lib/supabase-server";

export async function GET(request:Request,{params}:{params:Promise<{evidenceId:string}>}){
  const profile=await getAuthorizedProfile(request);if(profile instanceof Response)return profile;const {evidenceId}=await params;
  const {data}=await getSupabaseServer().from("hpc_evidence").select("attachment_reference").eq("id",evidenceId).eq("school_id",profile.school_id).maybeSingle();if(!data?.attachment_reference)return Response.json({error:"No portfolio file is attached."},{status:404});
  try{const reference=JSON.parse(data.attachment_reference);const {data:file,error}=await getSupabaseServer().storage.from(SUPABASE_FILES_BUCKET).download(`${profile.id}/uploads/${reference.fileId}`);if(error||!file)return Response.json({error:"Portfolio file is unavailable."},{status:404});return new Response(file,{headers:{"content-type":file.type||"application/octet-stream","content-disposition":`attachment; filename="${String(reference.fileName||"portfolio-file").replaceAll('"','')}"`}})}catch{return Response.json({error:"Portfolio reference is invalid."},{status:500})}
}
