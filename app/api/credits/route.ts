import { getAuthorizedProfile } from "../../../lib/authorization";
import { getSupabaseServer } from "../../../lib/supabase-server";

export async function GET(request:Request){
  const profile=await getAuthorizedProfile(request);if(profile instanceof Response)return profile;
  const {data}=await getSupabaseServer().from("credit_transactions").select("id,amount,transaction_type,reference,reason,created_at").eq("user_id",profile.id).order("created_at",{ascending:false}).limit(50);
  return Response.json({credits:{total:profile.total_credits,used:profile.used_credits,remaining:Math.max(0,profile.total_credits-profile.used_credits)},transactions:data||[]});
}
