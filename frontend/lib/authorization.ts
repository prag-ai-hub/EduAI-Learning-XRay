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

// Shape of a supabase-js error, narrowed to the two fields this check reads.
type DatabaseError = { message?:string|null; code?:string|null } | null;

function legacyCreditSchema(error:DatabaseError){return Boolean(error&&(/total_credits|used_credits|disabled_at|column .* does not exist/i.test(error.message||"")||error.code==="42703"))}

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

/**
 * Tenant isolation. A SchoolAdmin or Teacher may only touch their own school.
 *
 * A SuperAdmin is NOT granted implicit cross-tenant access: they need an
 * unexpired row in support_access_grants for that school, and the read is
 * recorded in audit_events. This is the rule from the role matrix §4 — without
 * it "SuperAdmin" quietly becomes "can read every school's student data".
 */
export async function requireSchoolScope(profile:AuthorizedProfile|Response, schoolId:string|null|undefined){
  if(profile instanceof Response)return profile;
  if(!schoolId)return Response.json({error:"A school is required for this action."},{status:400});
  if(profile.school_id===schoolId)return null;

  if(profile.role!=="SuperAdmin"){
    return Response.json({error:"This record belongs to another school."},{status:403});
  }

  const db=getSupabaseServer();
  const {data,error}=await db.from("support_access_grants")
    .select("id,reason,expires_at")
    .eq("granted_to",profile.id).eq("school_id",schoolId)
    .is("revoked_at",null).gt("expires_at",new Date().toISOString())
    .limit(1).maybeSingle();
  if(error&&error.code!=="PGRST116")return Response.json({error:error.message},{status:500});
  if(!data){
    return Response.json({error:"Cross-tenant access requires an active support grant."},{status:403});
  }

  // Best effort: the grant is what authorises the read, so a failure to write
  // the audit row must not silently deny an authorised action. It is logged.
  try{
    await db.from("audit_events").insert({
      id:crypto.randomUUID(), school_id:schoolId, actor_id:profile.id,
      action:"support.cross_tenant_read", entity_type:"school", entity_id:schoolId,
      detail_json:{grantId:data.id,reason:data.reason,expiresAt:data.expires_at},
    });
  }catch(cause){ console.error("support.cross_tenant_read audit write failed",cause) }
  return null;
}

/**
 * Parent scoping. There is no other path from a parent to a student: access
 * exists only where parent_student_links says it does.
 */
export async function requireLinkedChild(profile:AuthorizedProfile|Response, studentId:string|null|undefined){
  if(profile instanceof Response)return profile;
  if(!studentId)return Response.json({error:"A student is required for this action."},{status:400});
  if(profile.role!=="Parent")return Response.json({error:"This area is for parent accounts."},{status:403});

  const {data,error}=await getSupabaseServer().from("parent_student_links")
    .select("id").eq("parent_user_id",profile.id).eq("student_id",studentId)
    .eq("status","active").limit(1).maybeSingle();
  if(error&&error.code!=="PGRST116")return Response.json({error:error.message},{status:500});
  return data?null:Response.json({error:"You do not have access to this student."},{status:403});
}

/**
 * School lifecycle gate. Blocks new billable work while a school is Pending,
 * Suspended or Closed — but never blocks reads, so a school can always see its
 * own history and the invoice it needs to pay.
 */
export async function requireActiveSchool(profile:AuthorizedProfile|Response){
  if(profile instanceof Response)return profile;
  if(profile.role==="SuperAdmin")return null;
  if(!profile.school_id)return Response.json({error:"Your profile is not assigned to a school."},{status:403});

  const {data,error}=await getSupabaseServer().from("schools")
    .select("status").eq("id",profile.school_id).maybeSingle();
  // schools.status arrives in M7. Before that every school is implicitly active.
  if(error){
    if(/status|column .* does not exist/i.test(error.message||"")||error.code==="42703")return null;
    return Response.json({error:error.message},{status:500});
  }
  if(!data||data.status==="Active")return null;
  const message=data.status==="Suspended"
    ? "This school's account is suspended. Existing work stays available; contact your administrator to resume new analysis."
    : data.status==="Pending"
      ? "This school is awaiting approval. New analysis becomes available once it is approved."
      : "This school's account is closed.";
  return Response.json({error:message,schoolStatus:data.status},{status:403});
}

export type Entitlement = {
  hasEntitlement:boolean; status:string; planCode:string|null; planName:string|null;
  features:Record<string,unknown>; creditsIncluded:number;
  periodEnd:string|null; graceUntil:string|null;
};

/** Resolves a school's live subscription. subscriptions is authoritative — never schools.plan_id. */
export async function getEntitlement(schoolId:string):Promise<Entitlement>{
  const {data,error}=await getSupabaseServer().rpc("resolve_entitlement",{p_school_id:schoolId});
  if(error)throw new Error(error.message);
  const row=Array.isArray(data)?data[0]:data;
  return {
    hasEntitlement:Boolean(row?.out_has_entitlement),
    status:String(row?.out_status||"none"),
    planCode:row?.out_plan_code??null,
    planName:row?.out_plan_name??null,
    features:(row?.out_features||{}) as Record<string,unknown>,
    creditsIncluded:Number(row?.out_credits_included||0),
    periodEnd:row?.out_period_end??null,
    graceUntil:row?.out_grace_until??null,
  };
}

/**
 * Billing gate. Answers 402 with a machine-readable reason so the client can
 * route to checkout rather than showing a generic failure.
 *
 * Deliberately does NOT block reads — a school must always be able to see its
 * own history and the invoice it needs to pay. Callers apply this to new
 * billable work only.
 *
 * A named `feature` must be present and truthy in the plan's features object.
 * An absent feature is a denial: a plan that has not been given a capability
 * does not have it. Failing open here would make every future feature free.
 */
export async function requireEntitlement(profile:AuthorizedProfile|Response, feature?:string){
  if(profile instanceof Response)return profile;
  if(profile.role==="SuperAdmin")return null;
  if(!profile.school_id)return Response.json({error:"Your profile is not assigned to a school."},{status:403});

  let entitlement:Entitlement;
  try{
    entitlement=await getEntitlement(profile.school_id);
  }catch(cause){
    // Before M9 reaches a database the function does not exist. Treating that
    // as "not entitled" would lock out every existing pilot school, so it is
    // treated as unmetered and logged.
    const message=cause instanceof Error?cause.message:"";
    if(/resolve_entitlement|schema cache|could not find the function/i.test(message)){
      console.warn("Entitlement checks are unavailable: the M9 migration has not reached the schema cache.");
      return null;
    }
    return Response.json({error:message||"Entitlement could not be resolved."},{status:500});
  }

  if(!entitlement.hasEntitlement){
    return Response.json({
      error:entitlement.status==="none"
        ? "This school does not have an active subscription."
        : `This school's subscription is ${entitlement.status}. Renew it to continue.`,
      reason:"subscription_required", subscriptionStatus:entitlement.status,
    },{status:402});
  }

  if(feature && !entitlement.features?.[feature]){
    return Response.json({
      error:`Your ${entitlement.planName||"current"} plan does not include this feature.`,
      reason:"upgrade_required", feature, planCode:entitlement.planCode,
    },{status:402});
  }
  return null;
}
