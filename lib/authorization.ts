import { getAuthenticatedUser, unauthorized } from "./supabase-auth";
import { getSupabaseServer } from "./supabase-server";

export type AuthorizedProfile = { id:string; email:string; role:"Teacher"|"Admin"; status:string; school_id:string|null; total_credits:number; used_credits:number };

export async function getAuthorizedProfile(request:Request):Promise<AuthorizedProfile|Response>{
  const authUser=await getAuthenticatedUser(request);
  if(!authUser)return unauthorized();
  const {data,error}=await getSupabaseServer().from("users").select("id,email,role,status,school_id,total_credits,used_credits,disabled_at").eq("id",authUser.id).maybeSingle();
  if(error)return Response.json({error:error.message},{status:500});
  if(!data)return Response.json({error:"Complete your profile before continuing."},{status:403});
  if(data.status!=="Active"||data.disabled_at)return Response.json({error:"This account is disabled. Contact your administrator."},{status:403});
  return {...data,role:data.role==="Admin"?"Admin":"Teacher"} as AuthorizedProfile;
}

export function requireAdmin(profile:AuthorizedProfile|Response){
  if(profile instanceof Response)return profile;
  return profile.role==="Admin"?null:Response.json({error:"Administrator access is required."},{status:403});
}
