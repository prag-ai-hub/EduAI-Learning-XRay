import { getSupabaseServer } from "../../../../lib/supabase-server";
import { readShareToken, isExpiredToken } from "../../../../lib/share-tokens";

export async function GET(request:Request){
  try{
    const token=decodeURIComponent(new URL(request.url).pathname.split("/").pop()||"");
    const payload=await readShareToken(token);
    if(!payload){
      // Expiry is distinguished from an invalid signature only because a parent
      // needs to know to ask for a new link. A forged token still says nothing.
      return isExpiredToken(token)
        ? Response.json({error:"This student link has expired. Ask the teacher for a new QR code."},{status:410})
        : Response.json({error:"This student link is invalid."},{status:403});
    }

    // Extraction happens inside Postgres: this public endpoint must never pull a
    // whole teacher workspace into the worker to serve one child's report.
    const {data,error}=await getSupabaseServer().rpc("get_shared_student_report",{
      p_workspace_id:`teacher:${payload.u}`,
      p_assessment_id:payload.a,
      p_file_id:payload.f,
    });
    if(error)throw error;
    if(!data)return Response.json({error:"This student analysis is no longer available."},{status:404});

    return Response.json(data,{headers:{"cache-control":"private, no-store"}});
  }catch(error){
    return Response.json({error:error instanceof Error?error.message:"Shared dashboard could not be loaded."},{status:500});
  }
}
