import { getAuthorizedProfile, requireAdmin } from "../../../../lib/authorization";
import { getSupabaseServer } from "../../../../lib/supabase-server";

export async function GET(request:Request){
  const profile=await getAuthorizedProfile(request);const denied=requireAdmin(profile);if(denied)return denied;
  const db=getSupabaseServer();
  const [{data:users,error},{data:transactions}]=await Promise.all([
    db.from("users").select("id,name,email,role,status,total_credits,used_credits,disabled_at,updated_at").order("name"),
    db.from("credit_transactions").select("id,user_id,amount,transaction_type,reference,reason,admin_user_id,created_at").order("created_at",{ascending:false}).limit(200)
  ]);
  if(error)return Response.json({error:error.message},{status:500});
  return Response.json({users:(users||[]).map(user=>({...user,remaining_credits:Math.max(0,user.total_credits-user.used_credits)})),transactions:transactions||[]});
}

export async function PATCH(request:Request){
  const profile=await getAuthorizedProfile(request);const denied=requireAdmin(profile);if(denied)return denied;
  const body=await request.json() as {userId?:string;credits?:number;reason?:string;status?:"Active"|"Inactive"};
  if(!body.userId)return Response.json({error:"Choose a user."},{status:400});
  const db=getSupabaseServer();
  if(body.status){const {error}=await db.from("users").update({status:body.status,disabled_at:body.status==="Inactive"?new Date().toISOString():null,updated_at:new Date().toISOString()}).eq("id",body.userId);if(error)return Response.json({error:error.message},{status:500});}
  if(Number.isInteger(body.credits)&&body.credits!==0){
    const {data:user,error:readError}=await db.from("users").select("total_credits,used_credits").eq("id",body.userId).single();if(readError)return Response.json({error:readError.message},{status:500});
    const next=user.total_credits+Number(body.credits);if(next<user.used_credits)return Response.json({error:"Credits cannot be reduced below credits already used."},{status:400});
    const {error}=await db.from("users").update({total_credits:next,updated_at:new Date().toISOString()}).eq("id",body.userId);if(error)return Response.json({error:error.message},{status:500});
    await db.from("credit_transactions").insert({user_id:body.userId,amount:Number(body.credits),transaction_type:"adjustment",admin_user_id:(profile as any).id,reason:String(body.reason||"Administrator adjustment")});
  }
  return Response.json({ok:true});
}
