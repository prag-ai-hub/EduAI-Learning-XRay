import { getAuthenticatedUser, unauthorized } from "./supabase-auth";
import { getSupabaseServer } from "./supabase-server";

export type AuthorizedProfile = { id:string; email:string; role:"Teacher"|"Admin"; status:string; school_id:string|null; total_credits:number; used_credits:number };

function legacyCreditSchema(error:any){return Boolean(error&&(/total_credits|used_credits|disabled_at|column .* does not exist/i.test(error.message||"")||error.code==="42703"))}

export async function getAuthorizedProfile(request:Request):Promise<AuthorizedProfile|Response>{
  const authUser=await getAuthenticatedUser(request);
  if(!authUser)return unauthorized();
  const db=getSupabaseServer();
  let {data,error}=await db.from("users").select("id,email,role,status,school_id,total_credits,used_credits,disabled_at").eq("id",authUser.id).maybeSingle();
  if(error&&legacyCreditSchema(error)){
    const legacy=await db.from("users").select("id,email,role,status,school_id").eq("id",authUser.id).maybeSingle();
    data=legacy.data?{...legacy.data,total_credits:0,used_credits:0,disabled_at:null}:null;error=legacy.error;
  }
  if(error)return Response.json({error:error.message},{status:500});
  if(!data)return Response.json({error:"Complete your profile before continuing."},{status:403});
  if(data.status!=="Active"||data.disabled_at)return Response.json({error:"This account is disabled. Contact your administrator."},{status:403});
  const path=new URL(request.url).pathname;
  if(path.startsWith("/api/hpc/")){
    if(!["Teacher","Admin"].includes(data.role))return Response.json({error:"Teacher or administrator access is required for HPC."},{status:403});
    if(!data.school_id)return Response.json({error:"A school profile is required."},{status:403});
    if(path!=="/api/hpc/foundation"){
      const {data:settings,error:settingsError}=await db.from("hpc_school_settings").select("enabled").eq("school_id",data.school_id).maybeSingle();
      if(settingsError)return Response.json({error:"Unable to verify HPC access."},{status:503});
      if(settings?.enabled!==true)return Response.json({error:"HPC is disabled for this school."},{status:403});
    }
  }
  return {...data,total_credits:Number(data.total_credits||0),used_credits:Number(data.used_credits||0),role:data.role==="Admin"?"Admin":"Teacher"} as AuthorizedProfile;
}

export function requireAdmin(profile:AuthorizedProfile|Response){
  if(profile instanceof Response)return profile;
  return profile.role==="Admin"?null:Response.json({error:"Administrator access is required."},{status:403});
}
