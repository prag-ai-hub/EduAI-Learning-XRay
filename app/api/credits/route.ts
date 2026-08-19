import { getAuthorizedProfile } from "../../../lib/authorization";
import { getSupabaseServer } from "../../../lib/supabase-server";

export async function GET(request:Request){
  const profile=await getAuthorizedProfile(request);if(profile instanceof Response)return profile;
  const {data,error}=await getSupabaseServer().from("credit_transactions").select("id,amount,transaction_type,reference,reason,created_at").eq("user_id",profile.id).order("created_at",{ascending:false}).limit(50);
  const migrationPending=Boolean(error&&(/credit_transactions|relation .* does not exist|schema cache/i.test(error.message||"")||error.code==="42P01"||error.code==="PGRST205"));
  if(error&&!migrationPending)return Response.json({error:error.message},{status:500});
  return Response.json({credits:{total:profile.total_credits,used:profile.used_credits,remaining:Math.max(0,profile.total_credits-profile.used_credits)},transactions:data||[],creditLedgerAvailable:!migrationPending});
}
