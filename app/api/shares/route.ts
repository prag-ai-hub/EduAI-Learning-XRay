import { getAuthenticatedUser, unauthorized } from "../../../lib/supabase-auth";
import { getSupabaseServer } from "../../../lib/supabase-server";

const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");

async function sign(value:string){
  const secret=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!secret)throw new Error("Secure sharing is not configured.");
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return encode(new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value))));
}

export async function POST(request:Request){
  try{
    const user=await getAuthenticatedUser(request);if(!user)return unauthorized();
    const body=await request.json() as {assessmentId?:string;fileId?:string;expiresInDays?:number};
    const {data,error}=await getSupabaseServer().from("workspace_snapshots").select("state_json").eq("workspace_id",`teacher:${user.id}`).maybeSingle();
    if(error)throw error;
    const assessment=data?.state_json?.assessments?.find((item:any)=>item.id===body.assessmentId);
    const result=assessment?.gradeResults?.[String(body.fileId||"")];
    if(!assessment||!result)return Response.json({error:"The selected student analysis could not be found."},{status:404});
    const days=Math.max(1,Math.min(90,Number(body.expiresInDays)||30));
    const payload=encode(new TextEncoder().encode(JSON.stringify({u:user.id,a:assessment.id,f:result.fileId,exp:Date.now()+days*86400000})));
    const token=`${payload}.${await sign(payload)}`;
    const origin=new URL(request.url).origin;
    return Response.json({url:`${origin}/share/${token}`,studentName:result.studentName,expiresAt:new Date(Date.now()+days*86400000).toISOString()});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Share link creation failed."},{status:500})}
}
