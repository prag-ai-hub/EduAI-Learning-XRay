import { getAuthorizedProfile, requireAdmin } from "../../../../lib/authorization";
import { getSupabaseServer } from "../../../../lib/supabase-server";

export async function POST(request:Request){
  const profile=await getAuthorizedProfile(request);const denied=requireAdmin(profile);if(denied)return denied;
  const body=await request.json() as {name?:string;email?:string;role?:"Teacher"|"SchoolAdmin";credits?:number;resend?:boolean};
  const name=String(body.name||"").trim(),email=String(body.email||"").trim().toLowerCase(),credits=Math.max(0,Math.floor(Number(body.credits)||0));
  if(name.length<2||!/^\S+@\S+\.\S+$/.test(email))return Response.json({error:"Enter a valid name and email address."},{status:400});
  const db=getSupabaseServer();
  const {data,error}=await db.auth.admin.inviteUserByEmail(email,{data:{name,role:body.role==="SchoolAdmin"?"SchoolAdmin":"Teacher",credits,school_id:(profile as any).school_id},redirectTo:new URL("/app",request.url).toString()});
  if(error)return Response.json({error:error.message},{status:400});
  await db.from("invitations").insert({email,name,role:body.role==="SchoolAdmin"?"SchoolAdmin":"Teacher",credits,school_id:(profile as any).school_id,invited_by:(profile as any).id});
  if(data.user)await db.from("users").upsert({id:data.user.id,email,name,role:body.role==="SchoolAdmin"?"SchoolAdmin":"Teacher",status:"Invited",school_id:(profile as any).school_id,total_credits:credits,used_credits:0,updated_at:new Date().toISOString()});
  return Response.json({ok:true});
}
