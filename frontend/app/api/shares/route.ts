import { getAuthenticatedUser, unauthorized } from "../../../lib/supabase-auth";
import { getSupabaseServer } from "../../../lib/supabase-server";
import { createShareToken } from "../../../lib/share-tokens";

export async function POST(request:Request){
  try{
    const user=await getAuthenticatedUser(request);if(!user)return unauthorized();
    const body=await request.json() as {assessmentId?:string;fileId?:string;expiresInDays?:number};
    const {data,error}=await getSupabaseServer().from("workspace_snapshots").select("state_json").eq("workspace_id",`teacher:${user.id}`).maybeSingle();
    if(error)throw error;
    const assessment=data?.state_json?.assessments?.find((item:{id?:string})=>item.id===body.assessmentId);
    const result=assessment?.gradeResults?.[String(body.fileId||"")];
    if(!assessment||!result)return Response.json({error:"The selected student analysis could not be found."},{status:404});
    const days=Math.max(1,Math.min(90,Number(body.expiresInDays)||30));
    const token=await createShareToken({u:user.id,a:assessment.id,f:result.fileId,exp:Date.now()+days*86400000});
    const origin=new URL(request.url).origin;
    return Response.json({url:`${origin}/share/${token}`,studentName:result.studentName,expiresAt:new Date(Date.now()+days*86400000).toISOString()});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Share link creation failed."},{status:500})}
}
