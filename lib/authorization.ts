import { getAuthenticatedUser, unauthorized } from "./supabase-auth";
import { getSupabaseServer } from "./supabase-server";

export type Role = "SuperAdmin" | "SchoolAdmin" | "Teacher" | "Parent";
const ROLES: Role[] = ["SuperAdmin", "SchoolAdmin", "Teacher", "Parent"];

export type AuthorizedProfile = { id:string; email:string; role:Role; status:string; school_id:string|null; total_credits:number; used_credits:number };

// 'Admin' is the pre-M7 value for what is now SchoolAdmin. Kept so a profile
// read during a partial rollout does not fall through to Teacher and silently
// drop an administrator's access.
function normalizeRole(value:unknown):Role{
  const role = String(value || "");
  if (role === "Admin") return "SchoolAdmin";
  return (ROLES as string[]).includes(role) ? role as Role : "Teacher";
}

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
  return {...data,total_credits:Number(data.total_credits||0),used_credits:Number(data.used_credits||0),role:normalizeRole(data.role)} as AuthorizedProfile;
}

export function requireRole(profile:AuthorizedProfile|Response, ...roles:Role[]){
  if(profile instanceof Response)return profile;
  return roles.includes(profile.role)?null:Response.json({error:"You do not have access to this area."},{status:403});
}

// School administration is reachable by a SchoolAdmin for their own school, and
// by a SuperAdmin operating across tenants.
export function requireAdmin(profile:AuthorizedProfile|Response){
  if(profile instanceof Response)return profile;
  return requireRole(profile,"SchoolAdmin","SuperAdmin")
    ? Response.json({error:"Administrator access is required."},{status:403})
    : null;
}
