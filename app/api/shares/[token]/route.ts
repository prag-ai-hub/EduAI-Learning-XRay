import { getSupabaseServer } from "../../../../lib/supabase-server";

const decode=(value:string)=>{const normalized=value.replace(/-/g,"+").replace(/_/g,"/");return Uint8Array.from(atob(normalized+"=".repeat((4-normalized.length%4)%4)),c=>c.charCodeAt(0))};
const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
async function sign(value:string){const secret=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;if(!secret)throw new Error("Sharing is unavailable.");const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return encode(new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value))))}

export async function GET(request:Request){
  try{
    const token=decodeURIComponent(new URL(request.url).pathname.split("/").pop()||"");
    const [encoded,signature]=token.split(".");if(!encoded||!signature||await sign(encoded)!==signature)return Response.json({error:"This student link is invalid."},{status:403});
    const payload=JSON.parse(new TextDecoder().decode(decode(encoded)));if(!payload.exp||Date.now()>payload.exp)return Response.json({error:"This student link has expired. Ask the teacher for a new QR code."},{status:410});
    const {data,error}=await getSupabaseServer().from("workspace_snapshots").select("state_json").eq("workspace_id",`teacher:${payload.u}`).maybeSingle();if(error)throw error;
    const state=data?.state_json||{};const assessment=(state.assessments||[]).find((item:any)=>item.id===payload.a);const result=assessment?.gradeResults?.[payload.f];if(!assessment||!result)return Response.json({error:"This student analysis is no longer available."},{status:404});
    const resources=(state.resources||[]).filter((item:any)=>item.assessmentId===assessment.id&&item.studentName===result.studentName);
    return Response.json({student:{name:result.studentName,className:`Class ${assessment.className||assessment.grade||""}${assessment.section||""}`},assessment:{id:assessment.id,title:assessment.title,subject:assessment.subject,date:assessment.date,score:result.score,maxMarks:result.maxMarks,feedback:result.feedback,gaps:result.gaps},resources:resources.map((item:any)=>({id:item.id,title:item.title,type:item.type,guide:item.guide,content:item.content,concepts:item.concepts}))},{headers:{"cache-control":"private, no-store"}});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Shared dashboard could not be loaded."},{status:500})}
}
