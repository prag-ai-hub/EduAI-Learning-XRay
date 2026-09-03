import { getAuthorizedProfile, requireAdmin, requireSchoolScope } from "../../../../lib/authorization";
import { getSupabaseServer } from "../../../../lib/supabase-server";

/**
 * Both handlers were unscoped: GET listed every user of every school together
 * with the whole platform's credit ledger, and PATCH would disable or credit
 * any user in any school given only an id. That was dormant while a single
 * school and a single hardcoded administrator existed; M7 made SchoolAdmin a
 * real multi-tenant role and made it live.
 *
 * A SchoolAdmin is now confined to their own school. A SuperAdmin must name a
 * school and hold an unexpired support grant for it (requireSchoolScope), which
 * also writes the cross-tenant audit event.
 */
async function resolveScope(request:Request){
  const profile=await getAuthorizedProfile(request);
  const denied=requireAdmin(profile);
  if(denied)return {error:denied};
  if(profile instanceof Response)return {error:profile};

  const requested=new URL(request.url).searchParams.get("schoolId");
  const schoolId=profile.role==="SuperAdmin"?requested:profile.school_id;
  if(!schoolId){
    return {error:Response.json({
      error:profile.role==="SuperAdmin"
        ? "Name a school with ?schoolId= to administer it."
        : "Your profile is not assigned to a school.",
    },{status:400})};
  }
  const scopeDenied=await requireSchoolScope(profile,schoolId);
  if(scopeDenied)return {error:scopeDenied};
  return {profile,schoolId};
}

export async function GET(request:Request){
  const scope=await resolveScope(request);
  if(scope.error)return scope.error;
  const {schoolId}=scope;
  const db=getSupabaseServer();

  // users/error are reassigned by the legacy-column fallback below; the
  // ledger pair never is, so it stays const.
  const [userResult,{data:transactions,error:transactionError}]=await Promise.all([
    db.from("users").select("id,name,email,role,status,total_credits,used_credits,disabled_at,updated_at").eq("school_id",schoolId).order("name"),
    db.from("credit_transactions").select("id,user_id,amount,transaction_type,reference,reason,admin_user_id,created_at")
      .in("user_id",(await db.from("users").select("id").eq("school_id",schoolId)).data?.map(u=>u.id)||[])
      .order("created_at",{ascending:false}).limit(200)
  ]);
  let {data:users,error}=userResult;
  if(error&&(/total_credits|used_credits|disabled_at|column .* does not exist/i.test(error.message||"")||error.code==="42703")){
    const legacy=await db.from("users").select("id,name,email,role,status,updated_at").eq("school_id",schoolId).order("name");
    users=(legacy.data||[]).map(user=>({...user,total_credits:0,used_credits:0,disabled_at:null}));error=legacy.error;
  }
  if(error)return Response.json({error:error.message},{status:500});
  const ledgerMissing=Boolean(transactionError&&(/credit_transactions|relation .* does not exist|schema cache/i.test(transactionError.message||"")||transactionError.code==="42P01"||transactionError.code==="PGRST205"));
  if(transactionError&&!ledgerMissing)return Response.json({error:transactionError.message},{status:500});
  return Response.json({users:(users||[]).map(user=>({...user,remaining_credits:Math.max(0,Number(user.total_credits||0)-Number(user.used_credits||0))})),transactions:transactions||[],creditLedgerAvailable:!ledgerMissing});
}

export async function PATCH(request:Request){
  const scope=await resolveScope(request);
  if(scope.error)return scope.error;
  const {profile,schoolId}=scope;
  const body=await request.json() as {userId?:string;credits?:number;reason?:string;status?:"Active"|"Inactive"};
  if(!body.userId)return Response.json({error:"Choose a user."},{status:400});

  const db=getSupabaseServer();
  // The target must belong to the school being administered. Without this an id
  // from any school is enough to act on that user.
  const {data:target,error:targetError}=await db.from("users").select("id,school_id,total_credits,used_credits").eq("id",body.userId).maybeSingle();
  if(targetError)return Response.json({error:targetError.message},{status:500});
  if(!target||target.school_id!==schoolId){
    return Response.json({error:"This user is not in the school you are administering."},{status:403});
  }

  if(body.status){
    const {error}=await db.from("users").update({status:body.status,disabled_at:body.status==="Inactive"?new Date().toISOString():null,updated_at:new Date().toISOString()}).eq("id",body.userId);
    if(error)return Response.json({error:error.message},{status:500});
  }
  if(Number.isInteger(body.credits)&&body.credits!==0){
    const next=Number(target.total_credits||0)+Number(body.credits);
    if(next<Number(target.used_credits||0))return Response.json({error:"Credits cannot be reduced below credits already used."},{status:400});
    const {error}=await db.from("users").update({total_credits:next,updated_at:new Date().toISOString()}).eq("id",body.userId);
    if(error)return Response.json({error:error.message},{status:500});
    await db.from("credit_transactions").insert({user_id:body.userId,amount:Number(body.credits),transaction_type:"adjustment",admin_user_id:profile.id,reason:String(body.reason||"Administrator adjustment")});
  }
  return Response.json({ok:true});
}
