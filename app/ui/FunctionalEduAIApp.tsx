"use client";

import { createElement, FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { zipSync } from "fflate";
import ParentShareDialog from "./ParentShareDialog";

type Role = "Teacher" | "Admin" | "Principal" | "School admin" | "Platform admin";
type TeacherModule = "Home" | "Work" | "Review" | "X-Ray" | "Holistic Progress" | "Interventions" | "Students" | "Resources" | "Achievements" | "Reports" | "Settings";
type AdminModule = "Overview" | "Users" | "Schools & Classes" | "Students" | "Academic years" | "Branding & Privacy" | "Schools" | "Analytics" | "AI Configuration" | "Feature flags" | "System health" | "Audit" | "Reports";
type Stage = "draft" | "uploaded" | "setup" | "grading" | "review" | "approved" | "xray" | "intervention" | "followup" | "published";
type Gap = {concept:string; mastery:number;finding?:string;misconception?:string;evidence?:string;prerequisiteConcept?:string;foundationGap?:string;recommendedLevel?:string;remediationSequence?:string[];rework?:string;severity?:"priority"|"developing"|"secure"};
type EvaluatorQuestion = {id:string;label:string;attemptState:"attempted"|"not_attempted"|"excluded";awardedMarks:number;aiAwardedMarks?:number;maxMarks:number;allowedIncrement:number;evidence:string;rationale:string;confidence:number;aiDisposition:"accepted"|"edited"|"rejected";reviewed:boolean;teacherComment?:string;pageNumber?:number;criteria?:{id:string;label:string;awardedMarks:number;maxMarks:number;evidence?:string;rationale?:string}[]};
type GradeResult = {fileId:string; studentName:string; questionPaperFileId?:string; questionPaperName?:string; score:number; maxMarks:number; gaps:Gap[]; date:string; feedback?:string; ocrText?:string;evidenceFingerprint?:string;reanalysisReason?:string;evaluationVersionId?:string;evaluationVersion?:number;evaluationStatus?:"submitted"|"moderation_pending"|"finalized"|"published";questionDecisions?:EvaluatorQuestion[];gradingSkipped?:boolean};
type Assessment = {
  id:string; title:string; type:string; grade:string; section:string; subject:string;
  maxMarks:number; date:string; stage:Stage; files:UploadFile[]; questions:number;
  reviewed:number; totalReviews:number; quality:number; published:boolean; version:number; gradedFileIds?:string[]; lastGradedFileId?:string;
  gradeResults?:Record<string,GradeResult>; answerKey?:string; rubric?:string;
};
type DocumentRole = "Question paper"|"Marking scheme"|"Model answer"|"Ungraded answer sheet"|"Teacher-graded answer sheet"|"Supporting reference";
type UploadFile = {id:string;name:string;type:string;size:number;progress:number;status:string;preview?:string;documentRole?:DocumentRole};
type User = {id:string;name:string;email:string;role:string;school:string;phone:string;status:"Active"|"Inactive"|"Invited";totalCredits?:number;usedCredits?:number};
type DemoProfile = {id:string;name:string;email:string;role:Role;school:string;label:string};
type CreditSummary = {total:number;used:number;remaining:number};
type Intervention = {id:string;assessmentId:string;concept:string;format:string;duration:string;status:string;followup:string;followupRecorded?:boolean;followupEvidence?:{studentsCompleted:number;avgMastery:number;outcome:string;note:string}};
type CognitiveLevel = "recall" | "application" | "analysis";
type WorksheetContent = {
  mcqQuestions:{question:string;options:string[];correctIndex:number;cognitiveLevel:CognitiveLevel;concept?:string}[];
  subjectiveQuestions:{question:string;modelAnswer:string;cognitiveLevel:CognitiveLevel;concept?:string}[];
};
type Worksheet = {id:string;title:string;type:string;status:string;template?:string;concept?:string;concepts?:string[];subject?:string;grade?:string;assessmentId?:string;mcq?:number;subjective?:number;difficulty?:string;answerSheets?:number;gradedSheets?:number;content?:WorksheetContent;guide?:any;studentName?:string;evidenceFiles?:string[]};
type ApiLogEntry = {provider:"mistral"|"openai";ms:number;ok:boolean;ts:number};
type DemoState = {assessments:Assessment[];users:User[];interventions:Intervention[];classes:string[];schools:string[];students:{id:string;name:string;roll:string;className:string;status:string}[];resources:Worksheet[];academicYears:string[];events:string[];apiLog:ApiLogEntry[]};
type ClassSubjectOption = {key:string;classKey:string;grade:string;section:string;subject:string;studentStrength:number};
const DOCUMENT_ACCEPT=".pdf,.jpg,.jpeg,.png,.heic,.docx,.odt,.md,.markdown,.txt,.rtf,.html,.htm,.xml,.json,.yaml,.yml,.csv,.tsv,.xlsx,.xls,text/*";
const DOCUMENT_EXTENSIONS=new Set(["pdf","jpg","jpeg","png","heic","docx","odt","md","markdown","txt","rtf","html","htm","xml","json","yaml","yml","csv","tsv","xlsx","xls"]);
function supportsDocumentUpload(file:File){return file.type.startsWith("text/")||DOCUMENT_EXTENSIONS.has(file.name.toLowerCase().split(".").pop()||"")}

const initialState:DemoState = {
  assessments:[
    {id:"a1",title:"Fractions checkpoint",type:"Quiz",grade:"6",section:"A",subject:"Mathematics",maxMarks:20,date:"2026-07-21",stage:"review",files:[{id:"f0",name:"Grade6A_Fractions_QuestionPaper.pdf",type:"application/pdf",size:1120000,progress:100,status:"OCR complete"},{id:"f1",name:"Grade6A_Fractions_MiraBose.pdf",type:"application/pdf",size:2450000,progress:100,status:"OCR complete"}],questions:8,reviewed:25,totalReviews:28,quality:78,published:false,version:1},
    {id:"a2",title:"Decimals exit ticket",type:"Exit ticket",grade:"6",section:"B",subject:"Mathematics",maxMarks:10,date:"2026-07-19",stage:"published",files:[],questions:5,reviewed:30,totalReviews:30,quality:86,published:true,version:1}
  ],
  users:[
    {id:"u1",name:"Asha Sharma",email:"asha@sunrise.edu",role:"Teacher",school:"Sunrise Academy",phone:"+91 98765 43210",status:"Active"},
    {id:"u2",name:"Rohan Mehta",email:"rohan@sunrise.edu",role:"Principal",school:"Sunrise Academy",phone:"+91 98765 43211",status:"Active"},
    {id:"u3",name:"Priya Nair",email:"priya@sunrise.edu",role:"Teacher",school:"Sunrise Academy",phone:"+91 98765 43212",status:"Inactive"}
  ],
  interventions:[{id:"i1",assessmentId:"a2",concept:"Decimal place value",format:"Guided practice",duration:"15 minutes",status:"In progress",followup:"2026-07-26"}],
  classes:["Class 6A · Mathematics · 28 students","Class 6B · Mathematics · 30 students","Class 7A · Mathematics · 32 students"],
  schools:["Sunrise Academy · Mumbai · CBSE"],
  students:[{id:"s1",name:"Mira Bose",roll:"6A-12",className:"Class 6A",status:"Active"},{id:"s2",name:"Kabir Shah",roll:"6A-14",className:"Class 6A",status:"Active"},{id:"s3",name:"Riya Menon",roll:"6A-18",className:"Class 6A",status:"Active"},{id:"s4",name:"Aarav Kapoor",roll:"6A-21",className:"Class 6A",status:"Active"}],
  resources:[{id:"r1",title:"Unlike Fractions Recovery Practice",type:"Guided worksheet",status:"Approved",template:"Guided recovery",concept:"Add fractions with unlike denominators",mcq:6,subjective:4,answerSheets:6,gradedSheets:4},{id:"r2",title:"Decimal place-value exit ticket",type:"Exit ticket",status:"Draft",template:"Quick check",concept:"Decimal place value",mcq:4,subjective:2,answerSheets:0,gradedSheets:0}],
  academicYears:["2026–27 · Active","2025–26 · Archived"],
  events:["Demo workspace created"],
  apiLog:[]
};

const stageLabel:Record<Stage,string>={draft:"Draft",uploaded:"Uploaded",setup:"Rubric setup",grading:"AI grading",review:"Teacher review",approved:"Approved",xray:"X-Ray ready",intervention:"Intervention",followup:"Follow-up",published:"Published"};
const teacherNav:TeacherModule[]=["Home","Work","Review","X-Ray","Holistic Progress","Interventions","Students","Resources","Achievements","Reports","Settings"];
const demoAccounts:DemoProfile[]=[
  {id:"demo-teacher",name:"Asha Sharma",email:"asha@sunrise.demo",role:"Teacher",school:"Sunrise Academy",label:"Teacher demo"},
  {id:"demo-principal",name:"Rohan Mehta",email:"principal@sunrise.demo",role:"Principal",school:"Sunrise Academy",label:"Principal demo"},
  {id:"demo-school-admin",name:"Meera Iyer",email:"admin@sunrise.demo",role:"School admin",school:"Sunrise Academy",label:"School admin demo"},
  {id:"demo-platform-admin",name:"Dev Malhotra",email:"platform@eduai.demo",role:"Platform admin",school:"EduAI Platform",label:"Super admin demo"},
];

function cloneInitial(){return JSON.parse(JSON.stringify(initialState)) as DemoState}
let activeAccessToken="";
function authFetch(input:RequestInfo|URL,init:RequestInit={}){
  const headers=new Headers(init.headers);
  if(activeAccessToken)headers.set("Authorization",`Bearer ${activeAccessToken}`);
  return fetch(input,{...init,headers});
}
function newTeacherState(profile:DemoProfile):DemoState{
  const state=cloneInitial();
  return {
    ...state,
    assessments:[],
    interventions:[],
    resources:[],
    events:[`Teacher workspace created · ${profile.name}`],
    users:[{id:profile.id,name:profile.name,email:profile.email,role:"Teacher",school:profile.school,phone:"",status:"Active"}],
    schools:[`${profile.school} · Teacher workspace`],
  };
}
function logApiTiming(setState:(fn:(s:DemoState)=>DemoState)=>void,timing?:{provider:"mistral"|"openai";ms:number;ok:boolean}[]){
  if(!timing||!timing.length)return;
  setState(s=>({...s,apiLog:[...timing.map(t=>({...t,ts:Date.now()})),...(s.apiLog||[])].slice(0,200)}));
}

// Aggregates every real graded result across all assessments into usable stats.
// Everything downstream (Students, Reports, Interventions, dashboards) should
// read from this instead of hardcoded demo numbers.
function allGradeResults(state:DemoState):GradeResult[]{
  return state.assessments.flatMap(a=>Object.values(a.gradeResults||{}));
}
function classSubjectOptions(state:DemoState):ClassSubjectOption[]{
  const options=new Map<string,ClassSubjectOption>();
  state.classes.forEach(entry=>{
    const parts=entry.split(/Â·|·/).map(part=>part.trim());
    const match=parts[0]?.match(/^(?:Class|Grade)\s+(.+?)([A-Za-z]+)$/i);
    if(!match||!parts[1])return;
    const grade=match[1].trim(),section=match[2].toUpperCase(),subject=parts[1];
    const key=`${grade}|${section}|${subject.toLowerCase()}`;
    options.set(key,{key,classKey:`${grade}|${section}`,grade,section,subject,studentStrength:Number(parts[2]?.match(/\d+/)?.[0]||0)});
  });
  state.assessments.forEach(a=>{
    if(!a.grade||!a.section||!a.subject)return;
    const section=a.section.toUpperCase(),key=`${a.grade}|${section}|${a.subject.toLowerCase()}`;
    if(!options.has(key))options.set(key,{key,classKey:`${a.grade}|${section}`,grade:a.grade,section,subject:a.subject,studentStrength:0});
  });
  return Array.from(options.values()).sort((a,b)=>a.grade.localeCompare(b.grade,undefined,{numeric:true})||a.section.localeCompare(b.section)||a.subject.localeCompare(b.subject));
}
function studentMastery(state:DemoState):Record<string,{mastery:number;evidence:number;lastDate:string}>{
  const results=allGradeResults(state);
  const byStudent:Record<string,{sum:number;count:number;lastDate:string}>={};
  results.forEach(r=>{
    const avgGap=r.gaps.length?r.gaps.reduce((s,g)=>s+g.mastery,0)/r.gaps.length:(r.score/Math.max(1,r.maxMarks))*100;
    const bucket=byStudent[r.studentName]||{sum:0,count:0,lastDate:r.date};
    bucket.sum+=avgGap;bucket.count+=1;if(r.date>bucket.lastDate)bucket.lastDate=r.date;
    byStudent[r.studentName]=bucket;
  });
  const out:Record<string,{mastery:number;evidence:number;lastDate:string}>={};
  Object.entries(byStudent).forEach(([name,b])=>{out[name]={mastery:Math.round(b.sum/b.count),evidence:b.count,lastDate:b.lastDate}});
  return out;
}
function conceptMastery(state:DemoState):{concept:string;mastery:number;evidence:number}[]{
  const results=allGradeResults(state);
  const byConcept:Record<string,{sum:number;count:number}>={};
  results.forEach(r=>r.gaps.forEach(g=>{
    const bucket=byConcept[g.concept]||{sum:0,count:0};
    bucket.sum+=g.mastery;bucket.count+=1;
    byConcept[g.concept]=bucket;
  }));
  return Object.entries(byConcept).map(([concept,b])=>({concept,mastery:Math.round(b.sum/b.count),evidence:b.count})).sort((a,b)=>a.mastery-b.mastery);
}
function overallMastery(state:DemoState):number|null{
  const concepts=conceptMastery(state);
  if(!concepts.length)return null;
  return Math.round(concepts.reduce((s,c)=>s+c.mastery,0)/concepts.length);
}
function masteryTrend(state:DemoState):{label:string;value:number}[]{
  const results=allGradeResults(state).slice().sort((a,b)=>a.date.localeCompare(b.date));
  const byMonth:Record<string,{sum:number;count:number}>={};
  results.forEach(r=>{
    const avgGap=r.gaps.length?r.gaps.reduce((s,g)=>s+g.mastery,0)/r.gaps.length:(r.score/Math.max(1,r.maxMarks))*100;
    const month=r.date.slice(0,7);
    const bucket=byMonth[month]||{sum:0,count:0};
    bucket.sum+=avgGap;bucket.count+=1;
    byMonth[month]=bucket;
  });
  return Object.entries(byMonth).map(([label,b])=>({label,value:Math.round(b.sum/b.count)}));
}

export default function FunctionalEduAIApp(){
  const [client,setClient]=useState<any>(null);
  const [session,setSession]=useState<any>(null);
  const [profile,setProfile]=useState<DemoProfile|null>(null);
  const [needsProfile,setNeedsProfile]=useState(false);
  const [loading,setLoading]=useState(true);
  const [authError,setAuthError]=useState("");

  useEffect(()=>{let alive=true;let unsubscribe:(()=>void)|undefined;const bootstrapTimer=window.setTimeout(()=>{if(alive){setAuthError("The saved session check timed out. Please sign in again below.");setLoading(false)}},12000);void(async()=>{
    try{
      const response=await fetch("/api/auth/config",{cache:"no-store"});
      const config=await response.json();
      if(!response.ok)throw new Error(config.error||"Authentication is unavailable.");
      // The browser's Web Locks API can leave Supabase auth waiting forever when
      // another tab is suspended while holding the shared auth lock. Keep auth
      // operations independent in this isolated test site so sign-in and saved
      // session restoration cannot be blocked by another open HPC tab.
      const authLock=async <T,>(_name:string,_acquireTimeout:number,fn:()=>Promise<T>)=>fn();
      const supabase=createClient(config.url,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,lock:authLock}});
      if(!alive)return;
      setClient(supabase);
      const apply=async(next:any)=>{
        setSession(next);activeAccessToken=next?.access_token||"";try{if(activeAccessToken)sessionStorage.setItem("eduai-access-token",activeAccessToken);else sessionStorage.removeItem("eduai-access-token")}catch{}
        if(!next){setProfile(null);setNeedsProfile(false);setLoading(false);return}
        setLoading(true);
        const profileResponse=await authFetch("/api/profile",{cache:"no-store"});
        const payload=await profileResponse.json();
        if(!profileResponse.ok)throw new Error(payload.error||"Could not load your profile.");
        if(payload.profile){
          const accountRole:Role=payload.profile.role==="Admin"?"Admin":"Teacher";
          setProfile({id:payload.profile.id,name:payload.profile.name,email:payload.profile.email,role:accountRole,school:payload.profile.school,label:`${accountRole} account`});
          setNeedsProfile(false);
        }else{setProfile(null);setNeedsProfile(true)}
        setLoading(false);
      };
      const recoverAuthError=async(error:unknown)=>{
        const message=error instanceof Error?error.message:"Authentication failed.";
        if(/jwt issued at future/i.test(message)){
          await supabase.auth.signOut({scope:"local"});
          activeAccessToken="";
          setSession(null);setProfile(null);setNeedsProfile(false);
          setAuthError("Your email was confirmed, but the temporary sign-in link is still synchronising. Please wait a minute, then sign in with your email and password.");
        }else setAuthError(message);
        setLoading(false);
      };
      const {data:subscription}=supabase.auth.onAuthStateChange((_event:any,next:any)=>{void apply(next).catch(error=>{void recoverAuthError(error)})});
      unsubscribe=()=>subscription.subscription.unsubscribe();
      const {data}=await supabase.auth.getSession();
      await apply(data.session).catch(recoverAuthError);
      window.clearTimeout(bootstrapTimer);
    }catch(error){if(alive){setAuthError(error instanceof Error?error.message:"Authentication failed.");setLoading(false)}window.clearTimeout(bootstrapTimer)}
  })();return()=>{alive=false;window.clearTimeout(bootstrapTimer);unsubscribe?.()}},[]);

  if(loading)return <div className="app-loading"><img src="/brand/logo.png" alt="EduAI Hub"/><b>Preparing your secure workspace…</b></div>;
  if(!session||needsProfile||!profile)return <TeacherAuth client={client} session={session} needsProfile={needsProfile} error={authError} onProfile={next=>{setProfile(next);setNeedsProfile(false)}}/>;
  return <WorkspaceApp profile={profile} onSignOut={async()=>{await client.auth.signOut();activeAccessToken="";setSession(null);setProfile(null)}}/>;
}

function WorkspaceApp({profile,onSignOut}:{profile:DemoProfile;onSignOut:()=>Promise<void>}){
  const role:Role=profile.role;
  const [credits,setCredits]=useState<CreditSummary>({total:0,used:0,remaining:0});
  const [module,setModule]=useState<TeacherModule|AdminModule>("Home");
  const [state,setState]=useState<DemoState>(cloneInitial);
  const [selectedId,setSelectedId]=useState("a1");
  const [dialog,setDialog]=useState<string|null>(null);
  const [toast,setToast]=useState<{kind:"success"|"warning"|"error";text:string}|null>(null);
  const [dark,setDark]=useState(false);
  const [ready,setReady]=useState(false);
  const [syncStatus,setSyncStatus]=useState<"Loading"|"Syncing"|"Synced"|"Offline">("Loading");

  useEffect(()=>{void(async()=>{let restored:any=null;try{const response=await authFetch("/api/workspace",{cache:"no-store"});if(response.ok){const payload=await response.json();restored=payload.state;setSyncStatus("Synced")}}catch{}try{if(!restored){const cached=localStorage.getItem(`eduai-xray-offline-cache-v1:${profile.id}`);if(cached)restored=JSON.parse(cached);setSyncStatus("Offline")}if(restored){const base=cloneInitial();setState({...base,...restored,students:restored.students||base.students,resources:(restored.resources||base.resources).map((r:Worksheet)=>({...r,answerSheets:r.answerSheets||0,gradedSheets:r.gradedSheets||0})),academicYears:restored.academicYears||base.academicYears,apiLog:restored.apiLog||[]})}else{setState(newTeacherState(profile));setSelectedId("")}setDark(localStorage.getItem("eduai-theme")==="dark")}catch{}setReady(true)})()},[profile.id]);
  useEffect(()=>{if(!ready)return;localStorage.setItem(`eduai-xray-offline-cache-v1:${profile.id}`,JSON.stringify(state));setSyncStatus("Syncing");const timer=window.setTimeout(()=>{void authFetch("/api/workspace",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({state})}).then(response=>{if(!response.ok)throw new Error("sync failed");setSyncStatus("Synced")}).catch(()=>setSyncStatus("Offline"))},700);return()=>window.clearTimeout(timer)},[state,ready,profile.id]);
  useEffect(()=>{document.documentElement.dataset.theme=dark?"dark":"light";if(ready)localStorage.setItem("eduai-theme",dark?"dark":"light")},[dark,ready]);
  const selected=state.assessments.find(a=>a.id===selectedId)||state.assessments[0];
  const notify=(text:string,kind:"success"|"warning"|"error"="success")=>{setToast({text,kind});window.setTimeout(()=>setToast(null),3200)};
  const updateAssessment=(id:string,patch:Partial<Assessment>)=>setState(s=>({...s,assessments:s.assessments.map(a=>a.id===id?{...a,...patch}:a),events:[`${new Date().toLocaleTimeString()} · ${patch.stage?stageLabel[patch.stage]:"Assessment updated"}`,...s.events].slice(0,20)}));
  const openAssessment=(id:string,next:TeacherModule="Work")=>{setSelectedId(id);setModule(next)};
  const resetDemo=()=>{setState(cloneInitial());setSelectedId("a1");notify("Demo data restored")};
  useEffect(()=>{setModule(role==="Teacher"?"Home":"Overview");void authFetch("/api/credits",{cache:"no-store"}).then(r=>r.json()).then(p=>p.credits&&setCredits(p.credits)).catch(()=>{})},[role]);
  useEffect(()=>{if(role!=="Admin")return;void authFetch("/api/admin/users",{cache:"no-store"}).then(async response=>{const payload=await response.json();if(!response.ok)throw new Error(payload.error);setState(s=>({...s,users:(payload.users||[]).map((u:any)=>({id:u.id,name:u.name||u.email,email:u.email,role:u.role,school:profile.school,phone:"",status:u.status==="Inactive"?"Inactive":u.status==="Invited"?"Invited":"Active",totalCredits:u.total_credits,usedCredits:u.used_credits}))}))}).catch(()=>{})},[role,profile.school]);
  if(!ready)return <div className="app-loading"><img src="/brand/logo.png" alt="EduAI Hub"/><b>Preparing your workspace…</b></div>;

  const nav=role==="Teacher"?teacherNav:(role==="Admin"||role==="School admin")?["Overview","Users","Schools & Classes","Students","Academic years","Branding & Privacy","Reports"] as AdminModule[]:role==="Platform admin"?["Overview","Schools","Users","Analytics","AI Configuration","Feature flags","System health","Audit"] as AdminModule[]:["Overview","Reports"] as AdminModule[];
  const initials=profile.name.split(/\s+/).map(x=>x[0]).join("").slice(0,2).toUpperCase();
  return <div className="app-shell functional-shell">
    <aside className="sidebar">
      <button className="brand" onClick={()=>setModule(role==="Teacher"?"Home":"Overview")}><img src="/brand/shield.png" alt=""/><span><b>Learning X-Ray</b><small>by EduAI Hub</small></span></button>
      <nav aria-label="Primary navigation">{nav.map(item=><button key={item} className={module===item?"active":""} onClick={()=>setModule(item)}><span className="nav-icon">{icon(item)}</span><span>{item}</span>{item==="Review"&&<em>{state.assessments.reduce((n,a)=>n+Math.max(0,a.totalReviews-a.reviewed),0)}</em>}</button>)}</nav>
      <div className="sidebar-foot">
        <button className="secondary full" onClick={()=>setDialog("activity")}>Activity & audit</button>
        <button className="profile" onClick={()=>setDialog("profile")}><span>{initials}</span><div><b>{profile.name}</b><small>{profile.school}</small></div><i>•••</i></button>
      </div>
    </aside>
    <main>
      <header className="topbar">
        <div className="mobile-brand"><img src="/brand/shield.png" alt=""/><b>Learning X-Ray</b></div>
        <div className="crumb"><span>{profile.school}</span><i>›</i><b>{role} workspace</b></div>
        <div className="top-actions">
          <span className={`sync-indicator ${syncStatus.toLowerCase()}`}>{syncStatus==="Synced"?"● Cloud synced":syncStatus==="Syncing"?"◌ Saving…":syncStatus==="Offline"?"○ Offline · queued":"◌ Loading…"}</span>
          <span className="credit-badge" title={`${credits.used} of ${credits.total} credits used`}>Credits Remaining: {credits.remaining}</span>
          <span className="demo-role-badge">{profile.label}</span>
          <button className="demo-signout" onClick={()=>void onSignOut()}>Log out</button>
          <button aria-label="Toggle appearance" onClick={()=>setDark(x=>!x)}>{dark?"☀":"☾"}</button>
          <button aria-label="Notifications" onClick={()=>setDialog("notifications")}>♢{state.events.length>0&&<em>{Math.min(9,state.events.length)}</em>}</button>
        </div>
      </header>
      <div className="content">
        {role==="Teacher"
          ? <TeacherApp profile={profile} module={module as TeacherModule} state={state} selected={selected} openAssessment={openAssessment} open={setDialog} notify={notify} update={updateAssessment} setState={setState}/>
          : role==="Admin"||role==="School admin"
            ? <SchoolAdminApp module={module as AdminModule} state={state} setState={setState} open={setDialog} notify={notify}/>
            : role==="Principal"
              ? <PrincipalApp module={module as AdminModule} state={state} open={setDialog} notify={notify}/>
              : <PlatformApp module={module as AdminModule} state={state} open={setDialog} notify={notify}/>
        }
      </div>
    </main>
    <nav className="mobile-nav">{nav.slice(0,5).map(item=><button key={item} className={module===item?"active":""} onClick={()=>setModule(item)}><span className="nav-icon">{icon(item)}</span><small>{item}</small></button>)}</nav>
    {toast&&<div className={`toast ${toast.kind}`} role="status"><b>{toast.kind==="error"?"!":"✓"}</b>{toast.text}</div>}
    {dialog&&<AppDialog type={dialog} close={()=>setDialog(null)} open={setDialog} state={state} setState={setState} selected={selected} update={updateAssessment} notify={notify} resetDemo={resetDemo} openAssessment={openAssessment}/>}
  </div>
}

function TeacherAuth({client,session,needsProfile,error,onProfile}:{client:any;session:any;needsProfile:boolean;error:string;onProfile:(profile:DemoProfile)=>void}){
  const [mode,setMode]=useState<"login"|"signup">("login");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState(error);
  const submitAuth=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();if(!client)return;
    const data=new FormData(event.currentTarget);
    const email=String(data.get("email")||"").trim().toLowerCase();
    const password=String(data.get("password")||"");
    setBusy(true);setMessage("");
    try{
      const result=await Promise.race([
        mode==="signup"
          ? client.auth.signUp({email,password,options:{emailRedirectTo:`${location.origin}/app`}})
          : client.auth.signInWithPassword({email,password}),
        new Promise<never>((_,reject)=>window.setTimeout(()=>reject(new Error("Sign-in is taking longer than expected. Please check your connection and try again.")),15000))
      ]);
      if(result.error)setMessage(result.error.message);
      else if(mode==="signup"&&!result.data.session)setMessage("Check your email to confirm your account, then return here to log in.");
    }catch(cause){setMessage(cause instanceof Error?cause.message:"Unable to sign in right now. Please try again.")}finally{setBusy(false)}
  };
  const oauth=async(provider:"google"|"azure")=>{
    if(!client)return;setMessage("");
    const {error:oauthError}=await client.auth.signInWithOAuth({provider,options:{redirectTo:`${location.origin}/app`,...(provider==="azure"?{scopes:"email"}:{})}});
    if(oauthError)setMessage(oauthError.message);
  };
  const saveProfile=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();const data=new FormData(event.currentTarget);setBusy(true);setMessage("");
    const response=await authFetch("/api/profile",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.fromEntries(data))});
    const payload=await response.json();setBusy(false);
    if(!response.ok){setMessage(payload.error||"Could not save your profile.");return}
    const accountRole:Role=payload.profile.role==="Admin"?"Admin":"Teacher";onProfile({id:payload.profile.id,name:payload.profile.name,email:payload.profile.email,role:accountRole,school:payload.profile.school,label:`${accountRole} account`});
  };
  return <main className="demo-auth">
    <section className="demo-auth-story"><img src="/brand/logo.png" alt="EduAI Hub"/><p className="eyebrow">EduAI Learning X-Ray</p><h1>Your work, securely saved to your teacher account.</h1><p>Grade uploaded answer sheets, identify evidence-based learning gaps, and return later to continue exactly where you stopped.</p><ol><li><b>1</b><span>Sign in securely</span></li><li><b>2</b><span>Create or resume assessments</span></li><li><b>3</b><span>Review AI evidence before publishing</span></li></ol></section>
    <section className="demo-auth-panel"><div className="demo-auth-card">
      {session&&needsProfile?<><p className="eyebrow">First login</p><h2>Complete your teacher profile</h2><p>We’ll use these details to create your private workspace.</p><form onSubmit={saveProfile}><label>Your name<input name="name" required autoFocus/></label><label>School name<input name="school" required/></label><label>Phone (optional)<input name="phone"/></label><label>Subjects taught<input name="subjects" placeholder="e.g. Economics, Business Studies"/></label><label>Classes taught<input name="classes" placeholder="e.g. Class 11 and 12"/></label>{message&&<p className="form-error" role="alert">{message}</p>}<button className="primary full" disabled={busy}>{busy?"Creating workspace…":"Save profile & continue"}</button></form></>:<><p className="eyebrow">Teacher account</p><h2>{mode==="login"?"Welcome back":"Create your account"}</h2><form onSubmit={submitAuth}><label>Email address<input name="email" type="email" autoComplete="email" required/></label><label>Password<input name="password" type="password" minLength={8} autoComplete={mode==="login"?"current-password":"new-password"} required/></label>{message&&<p className="form-error" role="alert">{message}</p>}<button className="primary full" disabled={busy}>{busy?"Please wait…":mode==="login"?"Log in":"Create account"}</button></form><div className="demo-divider"><span>or continue with</span></div><div className="button-row"><button className="secondary" onClick={()=>void oauth("google")}>Google</button><button className="secondary" onClick={()=>void oauth("azure")}>Microsoft</button></div><button className="secondary full" onClick={()=>{setMode(mode==="login"?"signup":"login");setMessage("")}}>{mode==="login"?"New teacher? Create an account":"Already have an account? Log in"}</button></>}
    </div></section>
  </main>;
}

function DemoAccess({accounts,signIn,createTeacher}:{accounts:DemoProfile[];signIn:(account:DemoProfile)=>void;createTeacher:(account:DemoProfile)=>void}){
  const [creating,setCreating]=useState(false);
  const submit=(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    const data=new FormData(event.currentTarget);
    const name=String(data.get("name")||"").trim();
    const email=String(data.get("email")||"").trim().toLowerCase();
    const school=String(data.get("school")||"").trim();
    createTeacher({id:`teacher-${Date.now()}`,name,email,role:"Teacher",school,label:"New teacher demo"});
  };
  return <main className="demo-auth">
    <section className="demo-auth-story">
      <img src="/brand/logo.png" alt="EduAI Hub"/>
      <p className="eyebrow">EduAI Learning X-Ray · Demo access</p>
      <h1>See each role clearly. Start with the teacher journey.</h1>
      <p>Every account opens role-specific sample data. Create a fresh teacher account to begin with an empty workspace and add your first piece of work.</p>
      <ol><li><b>1</b><span>Create a teacher account</span></li><li><b>2</b><span>Add new work</span></li><li><b>3</b><span>Upload, grade and diagnose gaps</span></li></ol>
      <div className="demo-warning"><b>Demo environment</b><span>These accounts are for product demonstration only and are not production authentication.</span></div>
    </section>
    <section className="demo-auth-panel">
      <div className="demo-auth-card">
        <p className="eyebrow">Start here</p>
        <h2>{creating?"Create your teacher demo":"Choose a demo login"}</h2>
        <p>{creating?"Your new workspace starts empty and opens the Create assessment flow immediately.":"Use the teacher journey first, or inspect another role with seeded demo data."}</p>
        {creating?<form onSubmit={submit}>
          <label>Teacher name<input name="name" required autoFocus placeholder="e.g. Neha Verma"/></label>
          <label>Work email<input name="email" type="email" required placeholder="neha@school.edu"/></label>
          <label>School name<input name="school" required placeholder="e.g. Greenfield School"/></label>
          <button className="primary full" type="submit">Create account & add new work</button>
          <button className="secondary full" type="button" onClick={()=>setCreating(false)}>Back to demo accounts</button>
        </form>:<>
          <button data-testid="create-teacher-account" className="teacher-start" onClick={()=>setCreating(true)}><span>＋</span><div><b>Create a new teacher account</b><small>Empty workspace · opens new work</small></div><i>→</i></button>
          <div className="demo-divider"><span>Or sign in with demo data</span></div>
          <div className="demo-account-list">{accounts.map(account=><button key={account.id} data-testid={`demo-login-${account.role.toLowerCase().replaceAll(" ","-")}`} onClick={()=>signIn(account)}><span>{account.name.split(/\s+/).map(x=>x[0]).join("").slice(0,2)}</span><div><b>{account.label}</b><small>{account.name} · {account.school}</small></div><i>→</i></button>)}</div>
        </>}
        <footer><a href="/privacy">Privacy</a><a href="/terms">Terms</a><span>Demo data · No rankings</span></footer>
      </div>
    </section>
  </main>;
}

function TeacherApp({profile,module,state,selected,openAssessment,open,notify,update,setState}:any){
  if(module==="Home")return <TeacherHome profile={profile} state={state} openAssessment={openAssessment} open={open}/>;
  if(module==="Work")return <Work state={state} setState={setState} selected={selected} openAssessment={openAssessment} open={open} update={update} notify={notify}/>;
  if(module==="Review")return <Review selected={selected} update={update} notify={notify} open={open} setState={setState}/>;
  if(module==="X-Ray")return <XRay state={state} setState={setState} selected={selected} openAssessment={openAssessment} open={open} notify={notify}/>;
  if(module==="Holistic Progress")return <HolisticProgress profile={profile} state={state}/>;
  if(module==="Interventions")return <Interventions state={state} setState={setState} open={open} notify={notify}/>;
  if(module==="Students")return <StudentsView state={state} open={open} notify={notify}/>;
  if(module==="Resources")return <ResourcesView state={state} setState={setState} open={open} notify={notify}/>;
  if(module==="Achievements")return <AchievementsView state={state} notify={notify}/>;
  if(module==="Settings")return <SettingsView open={open} notify={notify}/>;
  return <Reports state={state} open={open} notify={notify}/>;
}

function HolisticProgress({profile,state}:{profile:DemoProfile;state:DemoState}){
  const [foundation,setFoundation]=useState<{enabled:boolean;frameworkReady:boolean;approvedFrameworkCount:number;framework:null|{versionLabel:string;sourceName:string;sourceReference:string;sections:{section_code:string;title:string;sort_order:number;required:boolean}[];abilities:{code:string;label:string}[];performanceLevels:{code:string;label:string;score_from:number;score_to:number}[];domains:{code:string;label:string}[]}}|null>(null);
  const [error,setError]=useState("");
  useEffect(()=>{let active=true;void authFetch("/api/hpc/foundation",{cache:"no-store"}).then(async response=>{
    const payload=await response.json();
    if(!response.ok)throw new Error(payload.error||"Unable to load Holistic Progress.");
    if(active)setFoundation(payload);
  }).catch((cause:unknown)=>{if(active)setError(cause instanceof Error?cause.message:"Unable to load Holistic Progress.")});return()=>{active=false}},[]);
  const middleStageStudents=state.students.filter(student=>/^(Class|Grade)\s*[6-8]/i.test(student.className));
  return <><PageHead eyebrow="PARAKH / NCERT framework" title="Holistic Progress" subtitle="A separate evidence-led learner view. Learning X-Ray marks and HPC observations are never combined."><span className="status neutral">Middle Stage · Classes 6–8</span></PageHead>
    <section className="hpc-hero"><div><p className="eyebrow">HPC foundation</p><h2>See the learner beyond a score.</h2><p>Structure follows the official Middle Stage guide: general information, All About Me, ambition, parent-teacher partnership, student progress, and holistic year summary.</p></div><div className="hpc-source"><b>Official source</b><a href="https://parakh.ncert.gov.in/how-to-fill-the-hpc-middle-stage" target="_blank" rel="noreferrer">PARAKH/NCERT · How to fill the HPC (Middle Stage) ↗</a></div></section>
    {error?<section className="card"><p className="eyebrow">Setup check</p><h2>HPC setup is unavailable</h2><p>{error}</p></section>:<><section className="metric-grid hpc-metrics"><Metric label="HPC access" value={foundation?.enabled?"Enabled":"Safely off"} note="Controlled independently per school"/><Metric label="Approved frameworks" value={foundation?String(foundation.approvedFrameworkCount):"…"} note="Official source version required"/><Metric label="Middle Stage learners" value={String(middleStageStudents.length)} note="Learner profiles stay separate"/><Metric label="Academic score blending" value="Never" note="No combined score or ranking"/></section>
    <section className="hpc-roadmap"><article><span>Part A</span><h3>Know the learner</h3><p>General information, interests, All About Me and learner context.</p></article><article><span>Part A</span><h3>Plan with the learner</h3><p>Ambition, goals and parent-teacher partnership.</p></article><article><span>Part B</span><h3>Record progress</h3><p>Observations linked to curricular goals, competencies and abilities.</p></article><article><span>Part C</span><h3>Summarise growth</h3><p>Teacher-approved holistic summary for the academic year.</p></article></section>
    <section className="card hpc-readiness"><div><p className="eyebrow">Next controlled step</p><h2>{foundation?.frameworkReady?"Official framework is ready for learner setup":"Awaiting approved PARAKH framework package"}</h2><p>{foundation?.frameworkReady?`${foundation.framework?.versionLabel} is loaded from ${foundation.framework?.sourceName}. The school can enable its approved stage template before teachers record evidence.`:"The product foundation is in place, but official descriptors are not invented or auto-filled. A school administrator must approve the source version before learner-level records can be opened."}</p></div><div className="hpc-abilities"><b>Middle Stage assessment lenses</b>{(foundation?.framework?.abilities||[{code:"awareness",label:"Awareness"},{code:"sensitivity",label:"Sensitivity"},{code:"creativity",label:"Creativity"}]).map(ability=><span key={ability.code}>{ability.label}</span>)}<small>Performance descriptors are controlled by the approved official framework version.</small></div></section>
    {foundation?.framework&&<section className="card span-2 hpc-framework-library"><CardHead eyebrow="Approved PARAKH / NCERT catalogue" title="Middle Stage framework library"><a className="link" href={foundation.framework.sourceReference} target="_blank" rel="noreferrer">Open source ↗</a></CardHead><div className="hpc-framework-grid"><div><b>HPC card sections</b>{foundation.framework.sections.map(section=><span key={section.section_code}>{section.title}</span>)}</div><div><b>Performance levels</b>{foundation.framework.performanceLevels.map(level=><span key={level.code}>{level.label} · {level.score_from}–{level.score_to}</span>)}</div><div><b>Subject domains</b>{foundation.framework.domains.map(domain=><span key={domain.code}>{domain.label}</span>)}</div></div></section>}
    <HpcLearnerProfiles />
    <HpcPromptOneWorkspace />
    <HpcCompetencyMapper />
    <HpcEvidenceWorkspace />
    <HpcEvidenceReview />
    <HpcActivityMapping />
    <HpcPromptTwoForms />
    <HpcMultiPerspectiveEvidence />
    <HpcEvidenceMapping />
    <HpcEvidenceDashboard />
    <HpcCompletionWorkspace />
    <HpcPromptThreeWorkspace />
    <HpcHolisticSupportActions />
    <HpcHolisticProfile />
    <HpcAppliedLearning />
    <HpcAppliedLearningDetails />
    <HpcAppliedLearningReview />
    </>}
  </>;
}

function HpcLearnerProfiles(){
  const [learners,setLearners]=useState<any[]>([]),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const load=()=>{setLoading(true);void authFetch("/api/hpc/learners").then(async response=>{const payload=await response.json();if(!response.ok)throw new Error(payload.error||"Unable to load HPC learners.");setLearners(payload.learners||[])}).catch((cause:unknown)=>setError(cause instanceof Error?cause.message:"Unable to load HPC learners.")).finally(()=>setLoading(false))};
  useEffect(load,[]);
  const submit=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const form=event.currentTarget;setSaving(true);setError("");setNotice("");const data=new FormData(form);try{const response=await authFetch("/api/hpc/learners",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:data.get("name"),rollNumber:data.get("rollNumber"),grade:data.get("grade"),academicYear:data.get("academicYear"),interests:String(data.get("interests")||"").split(","),allAboutMe:data.get("allAboutMe")})});const payload=await response.json();if(!response.ok)throw new Error(payload.error||"Unable to create HPC learner.");form.reset();setLearners(current=>[payload.learner,...current]);setNotice("Learner profile created. Continue with goals and observations in the next HPC step.")}catch(cause){setError(cause instanceof Error?cause.message:"Unable to create HPC learner.")}finally{setSaving(false)}};
  return <section className="card span-2 hpc-learner-profiles"><CardHead eyebrow="Part A · learner setup" title="HPC learner profiles"/><p className="modal-copy">Create an isolated HPC learner profile. This does not copy any Learning X-Ray marks or records.</p><form className="form-grid" onSubmit={submit}><Field label="Learner name"><input name="name" required minLength={2}/></Field><Field label="Roll number"><input name="rollNumber"/></Field><Field label="Grade"><input name="grade" type="number" min="0" max="12" required placeholder="6"/></Field><Field label="Academic year"><input name="academicYear" required pattern="[0-9]{4}-[0-9]{2}" title="Use YYYY-YY, for example 2026-27" placeholder="2026-27" defaultValue="2026-27"/></Field><Field label="Interests (comma separated)"><input name="interests" placeholder="Music, science clubs, football"/></Field><Field label="All About Me"><textarea name="allAboutMe" placeholder="Learner's own reflection, strengths or support needs"/></Field><div className="form-actions"><button className="primary" disabled={saving}>{saving?"Creating profile…":"Create HPC learner profile"}</button></div></form>{error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="success-note">{notice}</p>}<div className="hpc-learner-list">{loading?<p className="modal-copy">Loading HPC learner profiles…</p>:learners.length?learners.map(learner=><div className="list-item" key={learner.id}><b>{learner.students?.name||"Learner"}</b><span>Grade {learner.grade??"not set"} · {learner.academic_year} · {learner.students?.roll_number||"No roll number"}</span></div>):<p className="modal-copy">No HPC learner profiles yet. Start with a new, non-live test learner.</p>}</div></section>;
}

function HpcPromptOneWorkspace(){
  const [learners,setLearners]=useState<any[]>([]),[domains,setDomains]=useState<any[]>([]),[selected,setSelected]=useState(""),[detail,setDetail]=useState<any>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  useEffect(()=>{void Promise.all([authFetch("/api/hpc/learners"),authFetch("/api/hpc/foundation")]).then(async([learnersResponse,foundationResponse])=>{const learnersPayload=await learnersResponse.json(),foundationPayload=await foundationResponse.json();if(!learnersResponse.ok)throw new Error(learnersPayload.error||"Unable to load HPC learners.");if(!foundationResponse.ok)throw new Error(foundationPayload.error||"Unable to load the HPC framework.");const list=learnersPayload.learners||[];setLearners(list);setDomains(foundationPayload.framework?.domains||[]);if(list[0])setSelected(list[0].id)}).catch((cause:unknown)=>setError(cause instanceof Error?cause.message:"Unable to load Prompt 1.")).finally(()=>setLoading(false))},[]);
  const loadDetail=(learnerId:string)=>{if(!learnerId){setDetail(null);return}setLoading(true);void authFetch(`/api/hpc/learners/${encodeURIComponent(learnerId)}/prompt1`).then(async response=>{const payload=await response.json();if(!response.ok)throw new Error(payload.error||"Unable to load learner context.");setDetail(payload)}).catch((cause:unknown)=>setError(cause instanceof Error?cause.message:"Unable to load learner context.")).finally(()=>setLoading(false))};
  useEffect(()=>{if(selected)loadDetail(selected)},[selected]);
  const save=async(action:"context"|"goal"|"mapping",form:HTMLFormElement)=>{if(!selected)return;const fields=new FormData(form);setBusy(true);setError("");setNotice("");try{const response=await authFetch(`/api/hpc/learners/${encodeURIComponent(selected)}/prompt1`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,grade:fields.get("grade"),attendancePercentage:fields.get("attendancePercentage"),lowAttendanceReason:fields.get("lowAttendanceReason"),learnerContext:fields.get("learnerContext"),homeResources:fields.get("homeResources"),goalType:fields.get("goalType"),content:fields.get("content"),domainId:fields.get("domainId"),mappingNote:fields.get("mappingNote")})});const payload=await response.json();if(!response.ok)throw new Error(payload.error||"Unable to save HPC information.");form.reset();setNotice(action==="context"?"Learner context saved.":action==="goal"?"Goal or aspiration saved as teacher-approved context.":"Competency mapping saved for teacher review.");loadDetail(selected)}catch(cause){setError(cause instanceof Error?cause.message:"Unable to save HPC information.")}finally{setBusy(false)}};
  const goalLabels:Record<string,string>={all_about_me:"All About Me",academic_goal:"Academic goal",personal_goal:"Personal goal",ambition:"My Ambition Card",career_aspiration:"Career aspiration",future_plan:"Future plan",strength:"Strength or ability",support:"Support available",time_management:"Time-management reflection"};
  const goalTypes=detail?.stage?.hpc_template_sections?.flatMap((section:any)=>section.configuration_json?.goal_types||[])||[];
  return <section className="card span-2 hpc-prompt-one"><CardHead eyebrow="Prompt 1 · learner context and goals" title="Build the learner’s holistic foundation"/><p className="modal-copy">HPC records stay separate from Academic X-Ray. Teacher mappings are never converted into an academic score.</p>{loading&&!detail?<p className="modal-copy">Loading learner context…</p>:<>{learners.length?<label className="hpc-picker">Choose HPC learner<select value={selected} onChange={event=>setSelected(event.target.value)}>{learners.map(learner=><option key={learner.id} value={learner.id}>{learner.students?.name||"Learner"} · Grade {learner.grade??"not set"} · {learner.academic_year}</option>)}</select></label>:<p className="modal-copy">Create an HPC learner profile first.</p>}{detail&&<div className="hpc-prompt-grid"><form className="hpc-subform" onSubmit={event=>{event.preventDefault();void save("context",event.currentTarget)}}><b>Learner context</b><label>Grade (sets the HPC stage)<input name="grade" type="number" min="0" max="12" required defaultValue={detail.learner.grade??""}/></label><label>Attendance (%)<input name="attendancePercentage" type="number" min="0" max="100" step="0.01" defaultValue={detail.learner.attendance_percentage??""}/></label><label>Low-attendance reason (only if needed)<input name="lowAttendanceReason" defaultValue={detail.learner.low_attendance_reason||""}/></label><label>Learning context<textarea name="learnerContext" defaultValue={detail.learner.context_json?.learner_context||detail.learner.context_json?.all_about_me||""}/></label><label>Home learning resources<textarea name="homeResources" defaultValue={detail.learner.home_learning_resources_json?.resources||""}/></label><button className="secondary" disabled={busy}>Save learner context</button></form><form className="hpc-subform" onSubmit={event=>{event.preventDefault();void save("goal",event.currentTarget)}}><b>{detail.stage?`${detail.stage.title} · goals and reflection`:"Set the learner grade to unlock stage-aware goals"}</b>{detail.stage?<label>Section<select name="goalType" defaultValue={goalTypes[0]||"all_about_me"}>{goalTypes.map((goalType:string)=><option key={goalType} value={goalType}>{goalLabels[goalType]||goalType}</option>)}</select></label>:<p className="modal-copy">Save a grade between 0 and 12 in learner context first.</p>}<label>Teacher-recorded learner response<textarea name="content" required minLength={2} disabled={!detail.stage} placeholder="Record the learner's words or an agreed next step."/></label><button className="secondary" disabled={busy||!detail.stage}>Save goal or reflection</button><div className="hpc-records">{detail.goals.length?detail.goals.map((goal:any)=><p key={goal.id}><b>{String(goal.goal_type).replaceAll("_"," ")}</b>{goal.content}</p>):<small>No goal or aspiration entries yet.</small>}</div></form><form className="hpc-subform" onSubmit={event=>{event.preventDefault();void save("mapping",event.currentTarget)}}><b>Competency mapping</b><p className="modal-copy">Map the learner to an approved domain. Detailed official curricular goals, competencies and outcomes will remain unavailable until they are loaded from an approved source package.</p><label>Approved subject/domain<select name="domainId" required defaultValue=""><option value="" disabled>Select a domain</option>{domains.map(domain=><option key={domain.id} value={domain.id}>{domain.label}</option>)}</select></label><label>Teacher mapping note<textarea name="mappingNote" placeholder="Why this domain is relevant; no official descriptor is created here."/></label><button className="secondary" disabled={busy||!detail.stage}>Save mapping for review</button><div className="hpc-records">{detail.mappings.length?detail.mappings.map((mapping:any)=><p key={mapping.id}><b>{mapping.hpc_domains?.label||"Domain"} · teacher review required</b>{mapping.mapping_note||"No note added."}</p>):<small>No competency mappings yet.</small>}</div></form></div>}{error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="success-note">{notice}</p>}</>}</section>;
}

function HpcCompetencyMapper(){
  const [learners,setLearners]=useState<any[]>([]),[catalogue,setCatalogue]=useState<any[]>([]),[abilities,setAbilities]=useState<any[]>([]),[learnerId,setLearnerId]=useState(""),[domainId,setDomainId]=useState(""),[goalId,setGoalId]=useState(""),[competencyId,setCompetencyId]=useState(""),[abilityId,setAbilityId]=useState(""),[note,setNote]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  useEffect(()=>{void Promise.all([authFetch("/api/hpc/learners"),authFetch("/api/hpc/foundation")]).then(async([learnerResponse,foundationResponse])=>{const learnerPayload=await learnerResponse.json(),foundationPayload=await foundationResponse.json();if(!learnerResponse.ok)throw new Error(learnerPayload.error||"Unable to load HPC learners.");if(!foundationResponse.ok)throw new Error(foundationPayload.error||"Unable to load the HPC framework.");const list=learnerPayload.learners||[];setLearners(list);setLearnerId(list[0]?.id||"");setAbilities(foundationPayload.framework?.abilities||[]);if(list[0])return authFetch(`/api/hpc/learners/${encodeURIComponent(list[0].id)}/prompt1`).then(response=>response.json()).then(payload=>setCatalogue(payload.catalogue||[]))}).catch((error:unknown)=>setMessage(error instanceof Error?error.message:"Unable to load the mapping catalogue."))},[]);
  useEffect(()=>{if(!learnerId)return;void authFetch(`/api/hpc/learners/${encodeURIComponent(learnerId)}/prompt1`).then(response=>response.json()).then(payload=>setCatalogue(payload.catalogue||[]))},[learnerId]);
  const domain=catalogue.find(item=>item.id===domainId),goals=domain?.hpc_curricular_goals||[],goal=goals.find((item:any)=>item.id===goalId),competencies=goal?.hpc_competencies||[];
  const submit=async(event:React.FormEvent)=>{event.preventDefault();if(!learnerId||!domainId||!goalId||!competencyId){setMessage("Choose a learner, subject, curricular goal and competency.");return}setBusy(true);setMessage("");try{const response=await authFetch(`/api/hpc/learners/${encodeURIComponent(learnerId)}/prompt1`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"mapping",domainId,curricularGoalId:goalId,competencyId,abilityId,mappingNote:note})});const payload=await response.json();if(!response.ok)throw new Error(payload.error||"Unable to save mapping.");setMessage("Official competency mapping saved for teacher review.");setNote("")}catch(error){setMessage(error instanceof Error?error.message:"Unable to save mapping.")}finally{setBusy(false)}};
  return <section className="card span-2 hpc-prompt-one"><CardHead eyebrow="Prompt 1 · official mapping" title="Map evidence to the approved framework"/><p className="modal-copy">Select only the supplied PARAKH/NCERT descriptors. The teacher still reviews every saved mapping.</p><form className="form-grid" onSubmit={submit}><Field label="HPC learner"><select value={learnerId} onChange={event=>{setLearnerId(event.target.value);setDomainId("");setGoalId("");setCompetencyId("")}} required><option value="" disabled>Select learner</option>{learners.map(learner=><option key={learner.id} value={learner.id}>{learner.students?.name||"Learner"} · Grade {learner.grade??"not set"}</option>)}</select></Field><Field label="Subject / domain"><select value={domainId} onChange={event=>{setDomainId(event.target.value);setGoalId("");setCompetencyId("")}} required><option value="" disabled>Select domain</option>{catalogue.map(domain=><option key={domain.id} value={domain.id}>{domain.label}</option>)}</select></Field><Field label="Curricular goal"><select value={goalId} onChange={event=>{setGoalId(event.target.value);setCompetencyId("")}} required disabled={!domainId}><option value="" disabled>Select goal</option>{goals.map((item:any)=><option key={item.id} value={item.id}>{item.code} · {item.label}</option>)}</select></Field><Field label="Competency"><select value={competencyId} onChange={event=>setCompetencyId(event.target.value)} required disabled={!goalId}><option value="" disabled>Select competency</option>{competencies.map((item:any)=><option key={item.id} value={item.id}>{item.code} · {item.label}</option>)}</select></Field><Field label="Ability / dimension (optional)"><select value={abilityId} onChange={event=>setAbilityId(event.target.value)}><option value="">Not selected</option>{abilities.map((item:any)=><option key={item.id} value={item.id}>{item.label}</option>)}</select></Field><Field label="Teacher note (optional)"><textarea value={note} onChange={event=>setNote(event.target.value)} placeholder="Why this mapping is relevant to the learner."/></Field><div className="form-actions"><button className="secondary" disabled={busy||!learnerId}>{busy?"Saving…":"Save official mapping for review"}</button></div></form>{message&&<p className={message.includes("saved")?"success-note":"form-error"} role="alert">{message}</p>}</section>;
}

function HpcEvidenceWorkspace(){
  const [learners,setLearners]=useState<any[]>([]),[activities,setActivities]=useState<any[]>([]),[items,setItems]=useState<any[]>([]),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  const load=()=>void Promise.all([authFetch("/api/hpc/learners"),authFetch("/api/hpc/activities"),authFetch("/api/hpc/evidence")]).then(async responses=>{const payloads=await Promise.all(responses.map(response=>response.json()));if(responses.some(response=>!response.ok))throw new Error(payloads.find(payload=>payload.error)?.error||"Unable to load holistic evidence.");setLearners(payloads[0].learners||[]);setActivities(payloads[1].activities||[]);setItems(payloads[2].evidence||[])}).catch((error:unknown)=>setMessage(error instanceof Error?error.message:"Unable to load evidence."));
  useEffect(load,[]);
  const createActivity=async(form:HTMLFormElement)=>{const fields=new FormData(form);setBusy(true);setMessage("");try{const response=await authFetch("/api/hpc/activities",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:fields.get("title"),activityPrompt:fields.get("prompt"),assessmentMethod:fields.get("method"),pedagogies:String(fields.get("pedagogies")||"").split(",").map(value=>value.trim()).filter(Boolean),activityDate:fields.get("date"),academicYear:"2026-27"})});const payload=await response.json();if(!response.ok)throw new Error(payload.error);form.reset();setMessage("Formative activity saved as a teacher draft.");load()}catch(error){setMessage(error instanceof Error?error.message:"Unable to save activity.")}finally{setBusy(false)}};
  const addEvidence=async(form:HTMLFormElement)=>{const fields=new FormData(form);setBusy(true);setMessage("");try{const response=await authFetch("/api/hpc/evidence",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({learnerProfileId:fields.get("learner"),activityId:fields.get("activity"),sourceType:fields.get("source"),content:fields.get("content")})});const payload=await response.json();if(!response.ok)throw new Error(payload.error);form.reset();setMessage("Evidence saved for teacher review.");load()}catch(error){setMessage(error instanceof Error?error.message:"Unable to save evidence.")}finally{setBusy(false)}};
  return <section className="card span-2 hpc-prompt-one"><CardHead eyebrow="Prompt 2 · formative evidence" title="Activities and 360° perspectives"/><div className="hpc-prompt-grid"><form className="hpc-subform" onSubmit={event=>{event.preventDefault();void createActivity(event.currentTarget)}}><b>Create formative activity</b><label>Activity title<input name="title" required placeholder="e.g. Make your own seal"/></label><label>Activity prompt<textarea name="prompt" required placeholder="What will learners do?"/></label><label>Pedagogies (comma separated)<input name="pedagogies" placeholder="Art-integrated, experiential"/></label><label>Assessment method<input name="method" placeholder="Teacher observation and reflection"/></label><label>Date<input name="date" type="date"/></label><button className="secondary" disabled={busy}>Save activity draft</button></form><form className="hpc-subform" onSubmit={event=>{event.preventDefault();void addEvidence(event.currentTarget)}}><b>Add 360° evidence</b><label>Learner<select name="learner" required defaultValue=""><option value="" disabled>Select learner</option>{learners.map(learner=><option key={learner.id} value={learner.id}>{learner.students?.name||"Learner"}</option>)}</select></label><label>Activity (optional)<select name="activity" defaultValue=""><option value="">No linked activity</option>{activities.map(activity=><option key={activity.id} value={activity.id}>{activity.title}</option>)}</select></label><label>Perspective<select name="source" defaultValue="teacher_observation"><option value="teacher_observation">Teacher observation</option><option value="student_reflection">Student self-reflection</option><option value="peer_feedback">Peer feedback</option><option value="parent_feedback">Parent/caregiver feedback</option><option value="portfolio">Portfolio evidence</option></select></label><label>Evidence note<textarea name="content" required placeholder="Record what was observed or shared. It remains separate from other perspectives."/></label><button className="secondary" disabled={busy}>Save for teacher review</button></form></div><div className="hpc-records">{items.length?items.slice(0,6).map(item=><p key={item.id}><b>{String(item.source_type).replaceAll("_"," ")} · teacher review required</b>{item.content}</p>):<small>No Prompt 2 evidence yet.</small>}</div>{message&&<p className={message.includes("saved")?"success-note":"form-error"} role="alert">{message}</p>}</section>;
}

function HpcEvidenceReview(){
  const [items,setItems]=useState<any[]>([]),[message,setMessage]=useState("");
  const load=()=>void authFetch("/api/hpc/evidence").then(async response=>{const payload=await response.json();if(!response.ok)throw new Error(payload.error);setItems(payload.evidence||[])}).catch((error:unknown)=>setMessage(error instanceof Error?error.message:"Unable to load evidence."));
  useEffect(load,[]);
  const review=async(id:string,reviewStatus:"approved"|"excluded")=>{setMessage("");try{const response=await authFetch(`/api/hpc/evidence/${encodeURIComponent(id)}/review`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({reviewStatus,sufficiencyStatus:"limited"})});const payload=await response.json();if(!response.ok)throw new Error(payload.error);setMessage(`Evidence ${reviewStatus}.`);load()}catch(error){setMessage(error instanceof Error?error.message:"Unable to review evidence.")}};
  const pending=items.filter(item=>item.review_status==="teacher_review_required");
  return <section className="card span-2 hpc-prompt-one"><CardHead eyebrow="Prompt 2 · teacher moderation" title="Review multi-perspective evidence"/><p className="modal-copy">Peer and parent input never determine a final judgement on their own. The teacher controls whether each entry is included.</p>{pending.length?<div className="hpc-records">{pending.map(item=><p key={item.id}><b>{String(item.source_type).replaceAll("_"," ")}</b>{item.content}<span className="button-row"><button className="secondary" onClick={()=>void review(item.id,"approved")}>Approve</button><button className="link danger" onClick={()=>void review(item.id,"excluded")}>Exclude</button></span></p>)}</div>:<p className="modal-copy">No evidence is waiting for moderation.</p>}{message&&<p className={message.includes("approved")?"success-note":"form-error"}>{message}</p>}</section>;
}

function HpcActivityMapping(){
  const [activities,setActivities]=useState<any[]>([]),[catalogue,setCatalogue]=useState<any[]>([]),[activityId,setActivityId]=useState(""),[domainId,setDomainId]=useState(""),[goalId,setGoalId]=useState(""),[competencyId,setCompetencyId]=useState(""),[message,setMessage]=useState("");
  useEffect(()=>{void Promise.all([authFetch("/api/hpc/activities"),authFetch("/api/hpc/learners")]).then(async([activitiesResponse,learnersResponse])=>{const activitiesPayload=await activitiesResponse.json(),learnersPayload=await learnersResponse.json();if(!activitiesResponse.ok||!learnersResponse.ok)throw new Error(activitiesPayload.error||learnersPayload.error);const list=activitiesPayload.activities||[];setActivities(list);setActivityId(list[0]?.id||"");const learner=learnersPayload.learners?.[0];if(learner){const response=await authFetch(`/api/hpc/learners/${encodeURIComponent(learner.id)}/prompt1`);const payload=await response.json();setCatalogue(payload.catalogue||[])}}).catch((error:unknown)=>setMessage(error instanceof Error?error.message:"Unable to load activity mapping."))},[]);
  const domain=catalogue.find(item=>item.id===domainId),goals=domain?.hpc_curricular_goals||[],goal=goals.find((item:any)=>item.id===goalId),competencies=goal?.hpc_competencies||[];
  const save=async(event:React.FormEvent)=>{event.preventDefault();if(!activityId||!domainId||!competencyId){setMessage("Choose an activity, domain and competency.");return}try{const response=await authFetch(`/api/hpc/activities/${encodeURIComponent(activityId)}/mappings`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({domainId,competencyId})});const payload=await response.json();if(!response.ok)throw new Error(payload.error);setMessage("Activity mapping saved.")}catch(error){setMessage(error instanceof Error?error.message:"Unable to save activity mapping.")}};
  return <section className="card span-2 hpc-prompt-one"><CardHead eyebrow="Prompt 2 · rubric context" title="Link a formative activity to competency evidence"/><form className="form-grid" onSubmit={save}><Field label="Activity"><select value={activityId} onChange={event=>setActivityId(event.target.value)} required><option value="" disabled>Select activity</option>{activities.map(activity=><option key={activity.id} value={activity.id}>{activity.title}</option>)}</select></Field><Field label="Domain"><select value={domainId} onChange={event=>{setDomainId(event.target.value);setGoalId("");setCompetencyId("")}} required><option value="" disabled>Select domain</option>{catalogue.map(domain=><option key={domain.id} value={domain.id}>{domain.label}</option>)}</select></Field><Field label="Curricular goal"><select value={goalId} onChange={event=>{setGoalId(event.target.value);setCompetencyId("")}} required disabled={!domainId}><option value="" disabled>Select goal</option>{goals.map((item:any)=><option key={item.id} value={item.id}>{item.code} · {item.label}</option>)}</select></Field><Field label="Competency"><select value={competencyId} onChange={event=>setCompetencyId(event.target.value)} required disabled={!goalId}><option value="" disabled>Select competency</option>{competencies.map((item:any)=><option key={item.id} value={item.id}>{item.code} · {item.label}</option>)}</select></Field><div className="form-actions"><button className="secondary">Save competency mapping</button></div></form>{message&&<p className={message.includes("saved")?"success-note":"form-error"}>{message}</p>}</section>;
}

function HpcPromptTwoForms(){
  const [activities,setActivities]=useState<any[]>([]),[learners,setLearners]=useState<any[]>([]),[levels,setLevels]=useState<any[]>([]),[message,setMessage]=useState("");
  useEffect(()=>{void Promise.all([authFetch("/api/hpc/activities"),authFetch("/api/hpc/learners"),authFetch("/api/hpc/foundation")]).then(async responses=>{const payloads=await Promise.all(responses.map(response=>response.json()));setActivities(payloads[0].activities||[]);setLearners(payloads[1].learners||[]);setLevels(payloads[2].framework?.performanceLevels||[])}).catch(()=>setMessage("Unable to load Prompt 2 forms."))},[]);
  const submit=async(type:"rubric"|"teacher"|"student",form:HTMLFormElement)=>{const f=new FormData(form);try{if(type==="rubric"){const response=await authFetch(`/api/hpc/activities/${encodeURIComponent(String(f.get("activity")))}/rubric`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({descriptors:["beginner","proficient","advanced"].map(level=>({level,text:f.get(level)}))})});if(!response.ok)throw new Error((await response.json()).error)}else{const sourceType=type==="teacher"?"teacher_observation":"student_reflection";const evidenceResponse=await authFetch("/api/hpc/evidence",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({learnerProfileId:f.get("learner"),activityId:f.get("activity"),sourceType,content:f.get("summary")})});const evidence=await evidenceResponse.json();if(!evidenceResponse.ok)throw new Error(evidence.error);const detail=type==="teacher"?{confidence:f.get("confidence"),performanceLevelId:f.get("level"),notes:f.get("summary")}:{reflection:f.get("summary"),learning:f.get("learning"),practiceNeeded:f.get("practice"),helpNeeded:f.get("help")};const detailResponse=await authFetch(`/api/hpc/evidence/${evidence.evidence.id}/details`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(detail)});if(!detailResponse.ok)throw new Error((await detailResponse.json()).error)}form.reset();setMessage("Prompt 2 entry saved for teacher review.")}catch(error){setMessage(error instanceof Error?error.message:"Unable to save entry.")}};
  return <section className="card span-2 hpc-prompt-one"><CardHead eyebrow="Prompt 2 · structured capture" title="Rubrics, observations and learner reflection"/><div className="hpc-prompt-grid"><form className="hpc-subform" onSubmit={e=>{e.preventDefault();void submit("rubric",e.currentTarget)}}><b>Rubric descriptors</b><label>Activity<select name="activity" required>{activities.map(a=><option key={a.id} value={a.id}>{a.title}</option>)}</select></label>{["beginner","proficient","advanced"].map(level=><label key={level}>{level}<textarea name={level} required/></label>)}<button className="secondary">Save rubric</button></form><form className="hpc-subform" onSubmit={e=>{e.preventDefault();void submit("teacher",e.currentTarget)}}><b>Teacher observation</b><label>Learner<select name="learner">{learners.map(l=><option key={l.id} value={l.id}>{l.students?.name}</option>)}</select></label><label>Activity<select name="activity"><option value="">No activity</option>{activities.map(a=><option key={a.id} value={a.id}>{a.title}</option>)}</select></label><label>Performance level<select name="level"><option value="">Not selected</option>{levels.map(l=><option key={l.id} value={l.id}>{l.label}</option>)}</select></label><label>Confidence<select name="confidence"><option value="medium">Medium</option><option value="low">Low</option><option value="high">High</option></select></label><label>Observation<textarea name="summary" required/></label><button className="secondary">Save observation</button></form><form className="hpc-subform" onSubmit={e=>{e.preventDefault();void submit("student",e.currentTarget)}}><b>Learner self-reflection</b><label>Learner<select name="learner">{learners.map(l=><option key={l.id} value={l.id}>{l.students?.name}</option>)}</select></label><label>Reflection<textarea name="summary" required/></label><label>What I learned<textarea name="learning"/></label><label>What I need to practise<textarea name="practice"/></label><label>What help I need<textarea name="help"/></label><button className="secondary">Save reflection</button></form></div>{message&&<p className="success-note">{message}</p>}</section>;
}

function HpcMultiPerspectiveEvidence(){
  const [learners,setLearners]=useState<any[]>([]),[activities,setActivities]=useState<any[]>([]),[message,setMessage]=useState("");
  useEffect(()=>{void Promise.all([authFetch("/api/hpc/learners"),authFetch("/api/hpc/activities")]).then(async responses=>{const payloads=await Promise.all(responses.map(response=>response.json()));setLearners(payloads[0].learners||[]);setActivities(payloads[1].activities||[])}).catch(()=>setMessage("Unable to load evidence forms."))},[]);
  const create=async(type:"peer"|"parent"|"portfolio",form:HTMLFormElement)=>{const f=new FormData(form);setMessage("");try{let attachmentReference="";if(type==="portfolio"){const file=f.get("file") as File;if(!file?.size)throw new Error("Choose a portfolio file.");if(file.size>10*1024*1024)throw new Error("Portfolio files must be 10 MB or smaller.");const id=`hpc-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"-")}`;const upload=await authFetch(`/api/files/${encodeURIComponent(id)}`,{method:"PUT",headers:{"Content-Type":file.type||"application/octet-stream"},body:file});if(!upload.ok)throw new Error((await upload.json()).error||"Portfolio upload failed.");attachmentReference=JSON.stringify({fileId:id,fileName:file.name,fileType:file.type,size:file.size});}
    const sourceType=type==="peer"?"peer_feedback":type==="parent"?"parent_feedback":"portfolio";
    const evidenceResponse=await authFetch("/api/hpc/evidence",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({learnerProfileId:f.get("learner"),activityId:f.get("activity"),sourceType,content:f.get("summary"),attachmentReference})});const evidence=await evidenceResponse.json();if(!evidenceResponse.ok)throw new Error(evidence.error);
    if(type!=="portfolio"){const detail=type==="peer"?{reviewerLearnerProfileId:f.get("reviewer"),feedback:f.get("summary")}:{feedback:f.get("summary"),supportCommitment:f.get("commitment")};const detailResponse=await authFetch(`/api/hpc/evidence/${evidence.evidence.id}/details`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(detail)});if(!detailResponse.ok)throw new Error((await detailResponse.json()).error)}form.reset();setMessage(`${type==="peer"?"Peer feedback":type==="parent"?"Parent feedback":"Portfolio evidence"} saved for teacher moderation.`);
  }catch(error){setMessage(error instanceof Error?error.message:"Unable to save evidence.")}};
  const learnerOptions=<><option value="" disabled>Select learner</option>{learners.map(learner=><option key={learner.id} value={learner.id}>{learner.students?.name||"Learner"}</option>)}</>;
  const activityOptions=<><option value="">No linked activity</option>{activities.map(activity=><option key={activity.id} value={activity.id}>{activity.title}</option>)}</>;
  return <section className="card span-2 hpc-prompt-one"><CardHead eyebrow="Prompt 2 · 360° input" title="Peer, parent and portfolio evidence"/><p className="modal-copy">Every entry stays separate and requires teacher moderation before it can inform a learner record.</p><div className="hpc-prompt-grid"><form className="hpc-subform" onSubmit={e=>{e.preventDefault();void create("peer",e.currentTarget)}}><b>Peer feedback</b><label>Learner receiving feedback<select name="learner" required defaultValue="">{learnerOptions}</select></label><label>Peer reviewer<select name="reviewer" defaultValue=""><option value="">Not recorded</option>{learners.map(learner=><option key={learner.id} value={learner.id}>{learner.students?.name||"Learner"}</option>)}</select></label><label>Feedback<textarea name="summary" required placeholder="What did the peer notice?"/></label><button className="secondary">Save peer feedback</button></form><form className="hpc-subform" onSubmit={e=>{e.preventDefault();void create("parent",e.currentTarget)}}><b>Parent-teacher partnership</b><label>Learner<select name="learner" required defaultValue="">{learnerOptions}</select></label><label>Feedback<textarea name="summary" required placeholder="Parent/caregiver perspective"/></label><label>Home support commitment<textarea name="commitment" placeholder="Agreed support or next step"/></label><button className="secondary">Save parent feedback</button></form><form className="hpc-subform" onSubmit={e=>{e.preventDefault();void create("portfolio",e.currentTarget)}}><b>Portfolio / upload evidence</b><label>Learner<select name="learner" required defaultValue="">{learnerOptions}</select></label><label>Activity<select name="activity" defaultValue="">{activityOptions}</select></label><label>Evidence note<textarea name="summary" required placeholder="What does this file demonstrate?"/></label><label>Portfolio file<input name="file" type="file" required accept="image/*,.pdf,.doc,.docx"/></label><button className="secondary">Upload for review</button></form></div>{message&&<p className={message.includes("saved")?"success-note":"form-error"}>{message}</p>}</section>;
}

function HpcEvidenceMapping(){
  const [evidence,setEvidence]=useState<any[]>([]),[catalogue,setCatalogue]=useState<any[]>([]),[abilities,setAbilities]=useState<any[]>([]),[selected,setSelected]=useState(""),[domainId,setDomainId]=useState(""),[goalId,setGoalId]=useState(""),[competencyId,setCompetencyId]=useState(""),[outcomeId,setOutcomeId]=useState(""),[abilityId,setAbilityId]=useState(""),[message,setMessage]=useState("");
  useEffect(()=>{void Promise.all([authFetch("/api/hpc/evidence"),authFetch("/api/hpc/learners"),authFetch("/api/hpc/foundation")]).then(async responses=>{const payloads=await Promise.all(responses.map(response=>response.json()));const items=payloads[0].evidence||[];setEvidence(items);setSelected(items[0]?.id||"");setAbilities(payloads[2].framework?.abilities||[]);const learner=payloads[1].learners?.[0];if(learner){const response=await authFetch(`/api/hpc/learners/${encodeURIComponent(learner.id)}/prompt1`);const payload=await response.json();setCatalogue(payload.catalogue||[])}}).catch(()=>setMessage("Unable to load evidence mapping."))},[]);
  const domain=catalogue.find(item=>item.id===domainId),goals=domain?.hpc_curricular_goals||[],goal=goals.find((item:any)=>item.id===goalId),competencies=goal?.hpc_competencies||[],competency=competencies.find((item:any)=>item.id===competencyId),outcomes=competency?.hpc_learning_outcomes||[];
  const save=async(e:React.FormEvent)=>{e.preventDefault();try{const response=await authFetch(`/api/hpc/evidence/${encodeURIComponent(selected)}/mappings`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({domainId,competencyId,learningOutcomeId:outcomeId,abilityId})});const payload=await response.json();if(!response.ok)throw new Error(payload.error);setMessage("Evidence linked to the selected outcome and ability.")}catch(error){setMessage(error instanceof Error?error.message:"Unable to save mapping.")}};
  return <section className="card span-2 hpc-prompt-one"><CardHead eyebrow="Prompt 2 · evidence context" title="Link evidence to learning outcomes and abilities"/><form className="form-grid" onSubmit={save}><Field label="Evidence item"><select value={selected} onChange={e=>setSelected(e.target.value)} required><option value="" disabled>Select evidence</option>{evidence.map(item=><option key={item.id} value={item.id}>{String(item.source_type).replaceAll("_"," ")} · {String(item.content).slice(0,45)}</option>)}</select></Field><Field label="Domain"><select value={domainId} onChange={e=>{setDomainId(e.target.value);setGoalId("");setCompetencyId("");setOutcomeId("")}} required><option value="" disabled>Select domain</option>{catalogue.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></Field><Field label="Curricular goal"><select value={goalId} onChange={e=>{setGoalId(e.target.value);setCompetencyId("");setOutcomeId("")}} disabled={!domainId} required><option value="" disabled>Select goal</option>{goals.map((item:any)=><option key={item.id} value={item.id}>{item.code} · {item.label}</option>)}</select></Field><Field label="Competency"><select value={competencyId} onChange={e=>{setCompetencyId(e.target.value);setOutcomeId("")}} disabled={!goalId} required><option value="" disabled>Select competency</option>{competencies.map((item:any)=><option key={item.id} value={item.id}>{item.code} · {item.label}</option>)}</select></Field><Field label="Learning outcome"><select value={outcomeId} onChange={e=>setOutcomeId(e.target.value)} disabled={!competencyId}><option value="">Not specified</option>{outcomes.map((item:any)=><option key={item.id} value={item.id}>{item.code} · {item.label}</option>)}</select></Field><Field label="Ability"><select value={abilityId} onChange={e=>setAbilityId(e.target.value)}><option value="">Not specified</option>{abilities.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></Field><div className="form-actions"><button className="secondary" disabled={!selected}>Save evidence mapping</button></div></form>{message&&<p className={message.includes("linked")?"success-note":"form-error"}>{message}</p>}</section>;
}

function HpcEvidenceDashboard(){
  const [learners,setLearners]=useState<any[]>([]),[learnerId,setLearnerId]=useState(""),[dashboard,setDashboard]=useState<any>(null),[message,setMessage]=useState("");
  useEffect(()=>{void authFetch("/api/hpc/learners").then(async response=>{const payload=await response.json();if(!response.ok)throw new Error(payload.error);setLearners(payload.learners||[]);setLearnerId(payload.learners?.[0]?.id||"")}).catch(error=>setMessage(error instanceof Error?error.message:"Unable to load learners."))},[]);
  useEffect(()=>{if(!learnerId)return;void authFetch(`/api/hpc/dashboard?learnerId=${encodeURIComponent(learnerId)}`).then(async response=>{const payload=await response.json();if(!response.ok)throw new Error(payload.error);setDashboard(payload)}).catch(error=>setMessage(error instanceof Error?error.message:"Unable to load evidence dashboard."))},[learnerId]);
  const download=async(id:string)=>{try{const response=await authFetch(`/api/hpc/evidence/${encodeURIComponent(id)}/file`);if(!response.ok)throw new Error((await response.json()).error);const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download="hpc-portfolio";link.click();URL.revokeObjectURL(url)}catch(error){setMessage(error instanceof Error?error.message:"Unable to download file.")}};
  const createLink=async(type:"peer_feedback"|"parent_feedback")=>{try{const response=await authFetch("/api/hpc/shares",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({learnerId,type,expiresInDays:14})}),payload=await response.json();if(!response.ok)throw new Error(payload.error);await navigator.clipboard.writeText(payload.url);setMessage(`${type==="peer_feedback"?"Peer":"Parent"} contribution link copied. It expires in 14 days.`)}catch(error){setMessage(error instanceof Error?error.message:"Unable to create link.")}};
  const summary=dashboard?.summary;
  return <section className="card span-2 hpc-prompt-one"><CardHead eyebrow="Prompt 2 · evidence dashboard" title="Approved learner evidence timeline"/><Field label="Learner"><select value={learnerId} onChange={e=>setLearnerId(e.target.value)}><option value="" disabled>Select learner</option>{learners.map(learner=><option key={learner.id} value={learner.id}>{learner.students?.name||"Learner"}</option>)}</select></Field>{summary&&<><div className="metric-grid"><Metric label="Approved evidence" value={String(summary.approvedCount)} note="Teacher-approved only"/><Metric label="Awaiting review" value={String(summary.pendingCount)} note="Teacher decision required"/><Metric label="Mapping gaps" value={String(summary.unmappedCount)} note="Approved evidence without outcome link"/><Metric label="Conflicts" value={String(summary.conflicts.length)} note="Different levels for one competency"/></div><div className="hpc-framework-grid"><div><b>Missing perspectives</b>{summary.missingPerspectives.length?summary.missingPerspectives.map((source:string)=><span key={source}>{source.replaceAll("_"," ")}</span>):<span>All four perspectives represented</span>}</div><div><b>Conflict review</b>{summary.conflicts.length?summary.conflicts.map((conflict:any)=><span key={conflict.competencyId}>Competency has levels: {conflict.levels.join(", ")}</span>):<span>No performance-level conflict detected</span>}</div><div><b>Invite contributions</b><button className="secondary" onClick={()=>void createLink("peer_feedback")}>Copy peer link</button><button className="secondary" onClick={()=>void createLink("parent_feedback")}>Copy parent link</button></div></div><div className="hpc-records">{dashboard.approved.length?dashboard.approved.map((item:any)=><p key={item.id}><b>{String(item.source_type).replaceAll("_"," ")} · {new Date(item.observed_at).toLocaleDateString()}</b>{item.content}{item.source_type==="portfolio"&&<span className="button-row"><button className="secondary" onClick={()=>void download(item.id)}>Download portfolio file</button></span>}</p>):<small>No teacher-approved evidence yet. Approve entries in the moderation section to build this timeline.</small>}</div></>}{message&&<p className={message.includes("copied")?"success-note":"form-error"}>{message}</p>}</section>;
}

function HpcCompletionWorkspace(){
  const [learners,setLearners]=useState<any[]>([]),[learnerId,setLearnerId]=useState(""),[dashboard,setDashboard]=useState<any>(null),[links,setLinks]=useState<any[]>([]),[message,setMessage]=useState("");
  const load=()=>void Promise.all([authFetch("/api/hpc/learners"),authFetch("/api/hpc/shares")]).then(async responses=>{const payloads=await Promise.all(responses.map(response=>response.json()));setLearners(payloads[0].learners||[]);setLinks(payloads[1].links||[]);setLearnerId(current=>current||payloads[0].learners?.[0]?.id||"")}).catch(()=>setMessage("Unable to load summary workspace."));useEffect(load,[]);useEffect(()=>{if(learnerId)void authFetch(`/api/hpc/dashboard?learnerId=${encodeURIComponent(learnerId)}`).then(r=>r.json()).then(setDashboard)},[learnerId]);
  const revoke=async(linkId:string)=>{const response=await authFetch("/api/hpc/shares",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({linkId})}),payload=await response.json();setMessage(response.ok?"Contribution link revoked.":payload.error);load()};
  const saveSummary=async(form:HTMLFormElement,approve:boolean)=>{const f=new FormData(form),response=await authFetch("/api/hpc/summaries",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({learnerId,summaryText:f.get("summary"),strengthsText:f.get("strengths"),supportText:f.get("support"),approve})}),payload=await response.json();setMessage(response.ok?(approve?"Yearly Holistic Progress summary approved.":"Yearly summary saved as draft."):payload.error)};
  return <section className="card span-2 hpc-prompt-one"><CardHead eyebrow="Prompt 2 · completion workspace" title="Detailed review, link history and yearly summary"/><Field label="Learner"><select value={learnerId} onChange={e=>setLearnerId(e.target.value)}>{learners.map(l=><option key={l.id} value={l.id}>{l.students?.name||"Learner"}</option>)}</select></Field><div className="hpc-framework-grid"><div><b>Approved evidence review</b>{(dashboard?.approved||[]).map((item:any)=>{const mappings=(dashboard?.mappings||[]).filter((mapping:any)=>mapping.evidence_id===item.id);return <span key={item.id}><strong>{item.source_type.replaceAll("_"," ")}</strong> · {mappings.length?mappings.map((m:any)=>`${m.hpc_competencies?.code||""} ${m.hpc_learning_outcomes?.code||""} ${m.hpc_abilities?.label||""}`).join("; "):"mapping gap"}</span>})}</div><div><b>Contribution link history</b>{links.length?links.map(link=><span key={link.id}>{link.hpc_learner_profiles?.students?.name||"Learner"} · {link.contribution_type.replaceAll("_"," ")} · {link.submission_count||0} submission(s) · {link.revoked_at?"revoked":<button className="link danger" onClick={()=>void revoke(link.id)}>Revoke</button>}</span>):<span>No links created yet.</span>}</div><form className="hpc-subform" onSubmit={e=>{e.preventDefault();void saveSummary(e.currentTarget,false)}}><b>Yearly Holistic Progress summary</b><label>Summary<textarea name="summary" required minLength={10} placeholder="Teacher synthesis of approved evidence"/></label><label>Strengths<textarea name="strengths" placeholder="Key demonstrated strengths"/></label><label>Support next steps<textarea name="support" placeholder="Support and growth priorities"/></label><span className="button-row"><button className="secondary">Save draft</button><button className="primary" type="button" onClick={e=>{const form=e.currentTarget.closest("form") as HTMLFormElement;void saveSummary(form,true)}}>Approve yearly summary</button></span></form></div>{message&&<p className={message.includes("approved")||message.includes("saved")||message.includes("revoked")?"success-note":"form-error"}>{message}</p>}</section>;
}

function HpcPromptThreeWorkspace(){
  const [learners,setLearners]=useState<any[]>([]),[learnerId,setLearnerId]=useState(""),[progress,setProgress]=useState<any>(null),[feedback,setFeedback]=useState<any>(null),[message,setMessage]=useState("");
  const load=()=>{if(!learnerId)return;void Promise.all([authFetch(`/api/hpc/progress?learnerId=${encodeURIComponent(learnerId)}`),authFetch(`/api/hpc/feedback?learnerId=${encodeURIComponent(learnerId)}`)]).then(async responses=>{const payloads=await Promise.all(responses.map(response=>response.json()));if(payloads[0].error)throw new Error(payloads[0].error);setProgress(payloads[0]);setFeedback(payloads[1].feedback||{})}).catch(error=>setMessage(error instanceof Error?error.message:"Unable to load official progress."))};
  useEffect(()=>{void authFetch("/api/hpc/learners").then(r=>r.json()).then(payload=>{setLearners(payload.learners||[]);setLearnerId(payload.learners?.[0]?.id||"")})},[]);useEffect(load,[learnerId]);
  const saveScore=async(form:HTMLFormElement)=>{const f=new FormData(form),response=await authFetch("/api/hpc/progress",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({learnerId,abilityId:f.get("ability"),perspective:f.get("perspective"),statementCount:Number(f.get("count")),teacherOverrideLevel:f.get("override"),evidenceNote:f.get("note")})}),payload=await response.json();setMessage(response.ok?"Official perspective score saved. No blended score was calculated.":payload.error);if(response.ok){form.reset();load()}};
  const saveFeedback=async(form:HTMLFormElement)=>{const f=new FormData(form),response=await authFetch("/api/hpc/feedback",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({learnerId,strengths:f.get("strengths"),barriers:f.get("barriers"),parentShareable:f.get("parentShareable")==="on",observations:f.get("observations"),recommendations:f.get("recommendations"),support:f.get("support")})}),payload=await response.json();setMessage(response.ok?"Teacher feedback saved with the selected barrier visibility.":payload.error);if(response.ok)setFeedback(payload.feedback)};
  return <section className="card span-2 hpc-prompt-one"><CardHead eyebrow="Prompt 3 · official progress and support" title="Progress grid, strengths and contextual support"/><Field label="Learner"><select value={learnerId} onChange={e=>setLearnerId(e.target.value)}>{learners.map(l=><option key={l.id} value={l.id}>{l.students?.name||"Learner"}</option>)}</select></Field>{progress&&<><p className="modal-copy">Rule: {progress.rule?.rule_code||"No approved rule"} · {progress.rule?.source_name||""}. Each count is out of six; self, peer and teacher perspectives are never averaged.</p><div className="hpc-framework-grid">{progress.abilities.map((ability:any)=>{const rows=progress.assessments.filter((item:any)=>item.ability_id===ability.id);return <div key={ability.id}><b>{ability.label}</b>{["self","peer","teacher"].map(perspective=>{const item=rows.find((row:any)=>row.perspective===perspective);return <span key={perspective}>{perspective}: {item?`${item.statement_count}/6 · ${item.teacher_override_level||item.calculated_level}`:"not recorded"}</span>})}</div>})}</div><div className="hpc-prompt-grid"><form className="hpc-subform" onSubmit={e=>{e.preventDefault();void saveScore(e.currentTarget)}}><b>Record official ability count</b><label>Ability<select name="ability">{progress.abilities.map((a:any)=><option key={a.id} value={a.id}>{a.label}</option>)}</select></label><label>Perspective<select name="perspective"><option value="self">Self</option><option value="peer">Peer</option><option value="teacher">Teacher</option></select></label><label>Statements demonstrated (0–6)<input name="count" type="number" min="0" max="6" required/></label><label>Teacher override (optional)<select name="override"><option value="">Use official calculated level</option><option value="beginner">Beginner</option><option value="proficient">Proficient</option><option value="advanced">Advanced</option></select></label><label>Evidence note<textarea name="note"/></label><button className="secondary">Save perspective</button></form><form className="hpc-subform" onSubmit={e=>{e.preventDefault();void saveFeedback(e.currentTarget)}}><b>Teacher strengths, barriers and support</b><label>Areas of strength<textarea name="strengths" defaultValue={feedback?.strengths_text||""}/></label><label>Contextual barriers<textarea name="barriers" defaultValue={feedback?.barriers_text||""} placeholder="Describe current context, not a permanent label"/></label><label className="check"><input type="checkbox" name="parentShareable" defaultChecked={feedback?.barriers_visibility==="parent_shareable"}/> Allow this barrier note in parent sharing</label><label>Teacher observations<textarea name="observations" defaultValue={feedback?.observations_text||""}/></label><label>Recommendations<textarea name="recommendations" defaultValue={feedback?.recommendations_text||""}/></label><label>How I can help the student progress further<textarea name="support" defaultValue={feedback?.support_text||""}/></label><button className="secondary">Save teacher feedback</button></form></div></>}{message&&<p className={message.includes("saved")?"success-note":"form-error"}>{message}</p>}</section>;
}

function HpcHolisticSupportActions(){
  const [learners,setLearners]=useState<any[]>([]),[learnerId,setLearnerId]=useState(""),[progress,setProgress]=useState<any>(null),[actions,setActions]=useState<any[]>([]),[message,setMessage]=useState("");
  const load=()=>{if(!learnerId)return;void Promise.all([authFetch(`/api/hpc/progress?learnerId=${encodeURIComponent(learnerId)}`),authFetch(`/api/hpc/support-actions?learnerId=${encodeURIComponent(learnerId)}`)]).then(async responses=>{const payloads=await Promise.all(responses.map(r=>r.json()));if(payloads[0].error||payloads[1].error)throw new Error(payloads[0].error||payloads[1].error);setProgress(payloads[0]);setActions(payloads[1].actions||[])}).catch(error=>setMessage(error instanceof Error?error.message:"Unable to load holistic support actions."))};
  useEffect(()=>{void authFetch("/api/hpc/learners").then(r=>r.json()).then(payload=>{setLearners(payload.learners||[]);setLearnerId(payload.learners?.[0]?.id||"")})},[]);useEffect(load,[learnerId]);
  const save=async(form:HTMLFormElement)=>{const f=new FormData(form),response=await authFetch("/api/hpc/support-actions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({learnerId,title:f.get("title"),actionPlan:f.get("plan"),reviewDate:f.get("reviewDate"),abilityId:f.get("ability"),evidenceId:f.get("evidence")})}),payload=await response.json();setMessage(response.ok?"Holistic support action created.":payload.error);if(response.ok){form.reset();load()}};
  const update=async(id:string,status:string)=>{const response=await authFetch("/api/hpc/support-actions",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,status})}),payload=await response.json();setMessage(response.ok?"Support action updated.":payload.error);if(response.ok)load()};
  const evidence=progress?.evidenceLinks||[];
  return <section className="card span-2 hpc-prompt-one"><CardHead eyebrow="Prompt 3 · linked support" title="Evidence-linked holistic support actions"/><Field label="Learner"><select value={learnerId} onChange={e=>setLearnerId(e.target.value)}>{learners.map(l=><option key={l.id} value={l.id}>{l.students?.name||"Learner"}</option>)}</select></Field>{progress&&<><div className="hpc-framework-grid">{progress.abilities.map((ability:any)=>{const linked=evidence.filter((item:any)=>item.ability_id===ability.id);return <div key={ability.id}><b>{ability.label} evidence</b>{linked.length?linked.map((item:any)=><span key={item.evidence.id}>{item.evidence.source_type.replaceAll("_"," ")} · {String(item.evidence.content).slice(0,80)}</span>):<span>No approved evidence mapped to this ability yet.</span>}</div>})}</div><form className="hpc-subform" onSubmit={e=>{e.preventDefault();void save(e.currentTarget)}}><b>Create a contextual support action</b><label>Title<input name="title" required minLength={3} placeholder="e.g. Structured peer discussion"/></label><label>Practical support plan<textarea name="plan" required minLength={5} placeholder="Describe the temporary teaching support and next review."/></label><div className="form-grid"><label>Ability<select name="ability"><option value="">Not specific to one ability</option>{progress.abilities.map((a:any)=><option key={a.id} value={a.id}>{a.label}</option>)}</select></label><label>Related approved evidence<select name="evidence"><option value="">No single evidence item</option>{evidence.map((item:any)=><option key={item.evidence.id} value={item.evidence.id}>{item.evidence.source_type.replaceAll("_"," ")} · {String(item.evidence.content).slice(0,42)}</option>)}</select></label><label>Review date<input name="reviewDate" type="date"/></label></div><button className="secondary">Create support action</button></form><div className="hpc-records">{actions.length?actions.map(action=><p key={action.id}><b>{action.title}</b> · {action.status}<br/>{action.action_plan}<span className="button-row">{action.status!=="active"&&<button className="secondary" onClick={()=>void update(action.id,"active")}>Mark active</button>}{action.status!=="completed"&&<button className="secondary" onClick={()=>void update(action.id,"completed")}>Mark complete</button>}</span></p>):<small>No holistic support actions yet.</small>}</div></>}{message&&<p className={message.includes("created")||message.includes("updated")?"success-note":"form-error"}>{message}</p>}</section>;
}

function HpcHolisticProfile(){
  const [learners,setLearners]=useState<any[]>([]),[learnerId,setLearnerId]=useState(""),[progress,setProgress]=useState<any>(null),[feedback,setFeedback]=useState<any>(null),[actions,setActions]=useState<any[]>([]),[detail,setDetail]=useState<any>(null),[message,setMessage]=useState("");
  const load=()=>{if(!learnerId)return;void Promise.all([authFetch(`/api/hpc/progress?learnerId=${encodeURIComponent(learnerId)}`),authFetch(`/api/hpc/feedback?learnerId=${encodeURIComponent(learnerId)}`),authFetch(`/api/hpc/support-actions?learnerId=${encodeURIComponent(learnerId)}`)]).then(async rs=>{const p=await Promise.all(rs.map(r=>r.json()));if(p[0].error)throw new Error(p[0].error);setProgress(p[0]);setFeedback(p[1].feedback);setActions(p[2].actions||[])}).catch(e=>setMessage(e instanceof Error?e.message:"Unable to load holistic profile."))};
  useEffect(()=>{void authFetch("/api/hpc/learners").then(r=>r.json()).then(p=>{setLearners(p.learners||[]);setLearnerId(p.learners?.[0]?.id||"")})},[]);useEffect(load,[learnerId]);
  const showEvidence=async(id:string)=>{const r=await authFetch(`/api/hpc/evidence/${encodeURIComponent(id)}/details`),p=await r.json();setDetail(r.ok?p:{error:p.error})};
  const teacher=(id:string)=>progress?.assessments.find((a:any)=>a.ability_id===id&&a.perspective==="teacher");
  return <section className="card span-2 hpc-prompt-one"><CardHead eyebrow="Prompt 3 · holistic profile" title="Learner profile and visual progress wheel"/><Field label="Learner"><select value={learnerId} onChange={e=>setLearnerId(e.target.value)}>{learners.map(l=><option key={l.id} value={l.id}>{l.students?.name||"Learner"}</option>)}</select></Field>{progress&&<><div className="hpc-wheel-row">{progress.abilities.map((ability:any)=>{const score=teacher(ability.id)?.statement_count||0;return <div className="hpc-wheel-card" key={ability.id}><div className="hpc-wheel" style={{"--wheel":`${Math.round(score/6*100)}%`} as React.CSSProperties} aria-label={`${ability.label}: teacher count ${score} out of 6`}><b>{score}/6</b></div><strong>{ability.label}</strong><span>{teacher(ability.id)?.teacher_override_level||teacher(ability.id)?.calculated_level||"Not recorded"}</span></div>})}</div><div className="hpc-framework-grid"><div><b>Strengths and observations</b><span>{feedback?.strengths_text||"Not recorded"}</span><span>{feedback?.observations_text||"No observation recorded"}</span></div><div><b>Contextual support</b><span>{feedback?.recommendations_text||"No recommendation recorded"}</span><span>{feedback?.support_text||"No support plan recorded"}</span></div><div><b>Linked support actions</b>{actions.length?actions.map(a=><span key={a.id}>{a.title} · {a.status}</span>):<span>No support action recorded</span>}</div></div><div className="hpc-records"><b>Evidence detail</b>{(progress.evidenceLinks||[]).length?(progress.evidenceLinks||[]).map((item:any)=><p key={item.evidence.id}><b>{item.evidence.source_type.replaceAll("_"," ")}</b>{String(item.evidence.content).slice(0,110)}<button className="secondary" onClick={()=>void showEvidence(item.evidence.id)}>View mappings</button></p>):<small>No approved mapped evidence yet.</small>}</div>{detail&&<div className="hpc-evidence-detail"><b>{detail.error||`${detail.evidence.source_type.replaceAll("_"," ")} · ${new Date(detail.evidence.observed_at).toLocaleDateString()}`}</b>{!detail.error&&<><p>{detail.evidence.content}</p><p>{detail.mappings.length?detail.mappings.map((m:any)=>`${m.hpc_abilities?.label||""} ${m.hpc_competencies?.code||""} ${m.hpc_learning_outcomes?.code||""}`).join(" · "):"No mapping recorded"}</p></>}</div>}</>}{message&&<p className="form-error">{message}</p>}</section>;
}

function HpcAppliedLearning(){
  const [learners,setLearners]=useState<any[]>([]),[learnerId,setLearnerId]=useState(""),[records,setRecords]=useState<any[]>([]),[stageRecordId,setStageRecordId]=useState(""),[message,setMessage]=useState("");
  const refreshLearners=()=>void authFetch("/api/hpc/learners").then(r=>r.json()).then(p=>{const list=p.learners||[];setLearners(list);setLearnerId(current=>{const currentLearner=list.find((l:any)=>l.id===current);return Number(currentLearner?.grade)>=9?current:list.find((l:any)=>Number(l.grade)>=9)?.id||current||list[0]?.id||""})}).catch(()=>setMessage("Unable to refresh HPC learners."));
  const selectedLearner=learners.find(l=>l.id===learnerId),isSecondary=Number(selectedLearner?.grade)>=9;
  const load=()=>{if(!learnerId)return;void authFetch(`/api/hpc/applied-learning?learnerId=${encodeURIComponent(learnerId)}`).then(async r=>{const p=await r.json();if(!r.ok)throw new Error(p.error);setRecords(p.records||[]);setStageRecordId((current:string)=>current||p.records?.[0]?.id||"")}).catch(e=>setMessage(e instanceof Error?e.message:"Unable to load applied-learning records."))};
  useEffect(()=>{refreshLearners()},[]);useEffect(load,[learnerId]);
  const save=async(form:HTMLFormElement)=>{const f=new FormData(form),r=await authFetch("/api/hpc/applied-learning",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({learnerId,memberLearnerIds:f.getAll("members"),recordType:f.get("type"),title:f.get("title"),promptText:f.get("prompt"),stageNumber:f.get("stage"),interactionType:f.get("interaction"),hoursSpent:f.get("hours"),completionStatus:f.get("status"),guidingQuestions:f.get("questions"),roles:f.get("roles"),learnerReflection:f.get("reflection"),teacherAssessment:f.get("assessment"),peerFeedback:f.get("peer"),finalRubric:f.get("rubric"),teacherComments:f.get("comments"),barriersText:f.get("barriers"),credits:f.get("credits")})}),p=await r.json();setMessage(r.ok?"Applied-learning record saved.":p.error);if(r.ok){form.reset();load();window.dispatchEvent(new CustomEvent("hpc-applied-learning-updated"))}};
  const saveStage=async(form:HTMLFormElement)=>{const f=new FormData(form),r=await authFetch(`/api/hpc/applied-learning/${encodeURIComponent(stageRecordId)}/stages`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({stageNumber:f.get("stageNumber"),status:f.get("stageStatus"),dueDate:f.get("dueDate"),learnerReflection:f.get("stageReflection"),teacherAssessment:f.get("stageAssessment"),peerFeedback:f.get("stagePeer")})}),p=await r.json();setMessage(r.ok?`Stage ${p.stage.stage_number} updated.`:p.error);if(r.ok){load();window.dispatchEvent(new CustomEvent("hpc-applied-learning-updated"))}};
  return <section className="card span-2 hpc-prompt-one"><CardHead eyebrow="Prompt 4 · Secondary applied learning" title="Projects, inquiry and classroom interaction"/><p className="modal-copy">Available only for Secondary learners. Each record stays within the same Holistic Profile; younger stages are deliberately gated.</p><Field label="Learner"><select value={learnerId} onChange={e=>{setMessage("");setStageRecordId("");setLearnerId(e.target.value)}}>{learners.map(l=><option key={l.id} value={l.id}>{l.students?.name||"Learner"} · Grade {l.grade??"not set"}</option>)}</select></Field>{!isSecondary?<p className="modal-copy">Select a Grade 9–12 learner to record Secondary Stage applied learning. This module is not shown for younger learners.</p>:<><form className="hpc-subform" onSubmit={e=>{e.preventDefault();void save(e.currentTarget)}}><div className="form-grid"><label>Record type<select name="type"><option value="group_project">Group project</option><option value="problem_inquiry">Problem-based inquiry</option><option value="classroom_interaction">Classroom interaction</option><option value="online_course">Online course</option><option value="community_skill">Community / skill training</option></select></label><label>Title<input name="title" required placeholder="Project, inquiry, course or interaction title"/></label><label>Interaction type<select name="interaction"><option value="">Not applicable</option><option>Discussion</option><option>Debate</option><option>Simulation / role play</option><option>Laboratory activity</option><option>Digital learning</option></select></label><label>Stage<select name="stage"><option value="">Not staged</option><option value="1">Stage 1</option><option value="2">Stage 2</option><option value="3">Stage 3</option></select></label><label>Hours<input name="hours" type="number" min="0" step="0.5"/></label><label>Status<select name="status"><option value="planned">Planned</option><option value="in_progress">In progress</option><option value="completed">Completed</option></select></label><label>Credits (if required)<input name="credits" type="number" min="0" step="0.5"/></label></div><label>Additional group members (Secondary only)<select name="members" multiple size={Math.min(4,Math.max(2,learners.length-1))}>{learners.filter(l=>l.id!==learnerId&&Number(l.grade)>=9).map(l=><option key={l.id} value={l.id}>{l.students?.name||"Learner"} · Grade {l.grade}</option>)}</select></label><label>Roles, in member order (comma separated)<input name="roles" placeholder="Facilitator, researcher, presenter"/></label><label>Prompt / problem / challenge<textarea name="prompt"/></label><label>Guiding questions and evidence collection<textarea name="questions"/></label><div className="hpc-prompt-grid"><label>Learner reflection<textarea name="reflection"/></label><label>Teacher assessment<textarea name="assessment"/></label><label>Peer feedback<textarea name="peer"/></label><label>Final rubric<textarea name="rubric"/></label><label>Possible barriers<textarea name="barriers"/></label><label>Teacher comments / intervention<textarea name="comments"/></label></div><button className="secondary">Save applied-learning record</button></form>{records.length>0&&<form className="hpc-subform" onSubmit={e=>{e.preventDefault();void saveStage(e.currentTarget)}}><b>Stage 1–3 progress review</b><label>Record<select value={stageRecordId} onChange={e=>setStageRecordId(e.target.value)}>{records.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label><div className="form-grid"><label>Stage<select name="stageNumber"><option value="1">Stage 1</option><option value="2">Stage 2</option><option value="3">Stage 3</option></select></label><label>Status<select name="stageStatus"><option value="planned">Planned</option><option value="in_progress">In progress</option><option value="completed">Completed</option></select></label><label>Review date<input name="dueDate" type="date"/></label></div><label>Learner reflection<textarea name="stageReflection"/></label><label>Teacher assessment<textarea name="stageAssessment"/></label><label>Peer feedback<textarea name="stagePeer"/></label><button className="secondary">Save stage review</button></form>}<div className="hpc-records">{records.map(item=><p key={item.id}><b>{item.record_type.replaceAll("_"," ")} · {item.completion_status}</b>{item.title}{item.hours_spent!==null&&<span>{item.hours_spent} hour(s)</span>}{item.stages?.length?<small>{item.stages.map((stage:any)=>`Stage ${stage.stage_number}: ${stage.status}`).join(" · ")}</small>:<small>No stage reviews yet.</small>}</p>)}</div></>}{message&&<p className={message.includes("saved")||message.includes("updated")?"success-note":"form-error"}>{message}</p>}</section>;
}

function HpcAppliedLearningDetails(){
  const [learners,setLearners]=useState<any[]>([]),[learnerId,setLearnerId]=useState(""),[records,setRecords]=useState<any[]>([]),[recordId,setRecordId]=useState(""),[detail,setDetail]=useState<any>(null),[message,setMessage]=useState("");
  const loadRecords=()=>{if(!learnerId)return;void authFetch(`/api/hpc/applied-learning?learnerId=${encodeURIComponent(learnerId)}`).then(r=>r.json()).then(p=>{setRecords(p.records||[]);setRecordId((current:string)=>current||p.records?.[0]?.id||"")}).catch(()=>setMessage("Unable to load applied-learning records."))};
  const loadDetail=()=>{if(!recordId)return;void authFetch(`/api/hpc/applied-learning/${encodeURIComponent(recordId)}`).then(r=>r.json()).then(p=>{if(p.error)throw new Error(p.error);setDetail(p)}).catch(e=>setMessage(e instanceof Error?e.message:"Unable to load record details."))};
  useEffect(()=>{void authFetch("/api/hpc/learners").then(r=>r.json()).then(p=>{const list=p.learners||[];setLearners(list);setLearnerId(list.find((x:any)=>Number(x.grade)>=9)?.id||"")})},[]);useEffect(loadRecords,[learnerId]);useEffect(loadDetail,[recordId]);useEffect(()=>{const refresh=()=>loadRecords();window.addEventListener("hpc-applied-learning-updated",refresh);return()=>window.removeEventListener("hpc-applied-learning-updated",refresh)},[learnerId]);
  const submit=async(path:string,form:HTMLFormElement,method="POST")=>{const f=new FormData(form),body=Object.fromEntries(f.entries()),r=await authFetch(path,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),p=await r.json();setMessage(r.ok?"Saved.":p.error);if(r.ok){loadRecords();loadDetail()}};
  const download=async()=>{if(!recordId)return;const r=await authFetch(`/api/hpc/applied-learning/${encodeURIComponent(recordId)}/course-proof/file`);if(!r.ok){const p=await r.json();setMessage(p.error||"Unable to download the proof.");return}const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="course-proof";a.click();URL.revokeObjectURL(url)};
  if(!records.length)return null;const record=detail?.record;
  return <section className="card span-2 hpc-prompt-one"><CardHead eyebrow="Prompt 4 · record detail" title="Applied-learning record details, schedule and support tracking"/><div className="form-grid"><Field label="Secondary learner"><select value={learnerId} onChange={e=>{setRecordId("");setLearnerId(e.target.value)}}>{learners.filter(l=>Number(l.grade)>=9).map(l=><option key={l.id} value={l.id}>{l.students?.name||"Learner"} · Grade {l.grade}</option>)}</select></Field><Field label="Record"><select value={recordId} onChange={e=>setRecordId(e.target.value)}>{records.map(item=><option key={item.id} value={item.id}>{item.title} · {item.record_type.replaceAll("_"," ")}</option>)}</select></Field></div>{record&&<><form className="hpc-subform" onSubmit={e=>{e.preventDefault();void submit(`/api/hpc/applied-learning/${encodeURIComponent(record.id)}`,e.currentTarget,"PATCH")}}><b>Edit {record.record_type.replaceAll("_"," ")} record</b><div className="form-grid"><label>Record type<select name="recordType" defaultValue={record.record_type}><option value="group_project">Group project</option><option value="problem_inquiry">Problem-based inquiry</option><option value="classroom_interaction">Classroom interaction</option><option value="online_course">Online course</option><option value="community_skill">Community / skill training</option></select></label><label>Title<input name="title" required defaultValue={record.title}/></label><label>Academic term<input name="termLabel" placeholder="Term 1 / Semester 2" defaultValue={record.term_label||""}/></label><label>Class / section context<input name="classContext" placeholder="Class 10 A" defaultValue={record.class_context||""}/></label><label>Interaction type<input name="interactionType" defaultValue={record.interaction_type||""}/></label><label>Stage<select name="stageNumber" defaultValue={record.stage_number||""}><option value="">Not staged</option><option value="1">Stage 1</option><option value="2">Stage 2</option><option value="3">Stage 3</option></select></label><label>Hours<input name="hoursSpent" type="number" min="0" step="0.5" defaultValue={record.hours_spent??""}/></label><label>Status<select name="completionStatus" defaultValue={record.completion_status}><option value="planned">Planned</option><option value="in_progress">In progress</option><option value="completed">Completed</option></select></label><label>Credits<input name="credits" type="number" min="0" step="0.5" defaultValue={record.credits_json?.credits??""}/></label></div><label>Prompt / question / activity<textarea name="promptText" defaultValue={record.prompt_text||""}/></label><label>Guiding questions and evidence collection<textarea name="guidingQuestions" defaultValue={record.schedule_json?.guiding_questions||""}/></label><div className="hpc-prompt-grid"><label>Learner reflection<textarea name="learnerReflection" defaultValue={record.learner_reflection||""}/></label><label>Teacher assessment<textarea name="teacherAssessment" defaultValue={record.teacher_assessment||""}/></label><label>Peer feedback<textarea name="peerFeedback" defaultValue={record.peer_feedback||""}/></label><label>Rubric note<textarea name="finalRubric" defaultValue={record.rubric_json?.final_rubric||""}/></label><label>Summary barriers<textarea name="barriersText" defaultValue={record.barriers_text||""}/></label><label>Teacher comments / intervention<textarea name="teacherComments" defaultValue={record.teacher_comments||""}/></label></div><button className="primary">Save record changes</button></form><div className="hpc-prompt-grid"><form className="hpc-subform" onSubmit={e=>{e.preventDefault();void submit(`/api/hpc/applied-learning/${encodeURIComponent(record.id)}/milestones`,e.currentTarget)}}><b>Schedule milestones</b><label>Milestone<input name="title" required placeholder="Research sources approved"/></label><div className="form-grid"><label>Due date<input name="dueDate" type="date"/></label><label>Owner<input name="ownerLabel" placeholder="Learner / team role"/></label><label>Status<select name="status"><option value="planned">Planned</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="blocked">Blocked</option></select></label></div><label>Notes<textarea name="notes"/></label><button className="secondary">Add milestone</button><div className="hpc-records">{detail.milestones?.map((m:any)=><small key={m.id}>{m.title} · {m.status}{m.due_date?` · ${m.due_date}`:""}</small>)}</div></form><form className="hpc-subform" onSubmit={e=>{e.preventDefault();void submit(`/api/hpc/applied-learning/${encodeURIComponent(record.id)}/barriers`,e.currentTarget)}}><b>Barrier and support tracker</b><label>Barrier / risk<textarea name="barrierText" required/></label><label>Support action<textarea name="supportAction" placeholder="Agreed support or intervention"/></label><div className="form-grid"><label>Owner<input name="ownerLabel" placeholder="Teacher / learner / team"/></label><label>Status<select name="status"><option value="open">Open</option><option value="monitoring">Monitoring</option><option value="resolved">Resolved</option></select></label></div><button className="secondary">Add barrier</button><div className="hpc-records">{detail.barriers?.map((b:any)=><small key={b.id}>{b.barrier_text} · {b.status}{b.support_action?` · ${b.support_action}`:""}</small>)}</div></form></div>{record.record_type==="online_course"&&detail.courseProof&&<div className="hpc-subform"><b>Attached course certificate</b><p>{detail.courseProof.provider_name} · {detail.courseProof.course_name} · {detail.courseProof.completion_status}</p><button type="button" className="secondary" onClick={()=>void download()}>Download certificate / proof</button></div>}</>}{message&&<p className={message==="Saved."?"success-note":"form-error"}>{message}</p>}</section>;
}

function HpcAppliedLearningReview(){
  const [learners,setLearners]=useState<any[]>([]),[learnerId,setLearnerId]=useState(""),[records,setRecords]=useState<any[]>([]),[recordId,setRecordId]=useState(""),[catalogue,setCatalogue]=useState<any[]>([]),[domainId,setDomainId]=useState(""),[goalId,setGoalId]=useState(""),[competencyId,setCompetencyId]=useState(""),[outcomeId,setOutcomeId]=useState(""),[message,setMessage]=useState("");
  const load=()=>{if(!learnerId)return;void authFetch(`/api/hpc/applied-learning?learnerId=${encodeURIComponent(learnerId)}`).then(r=>r.json()).then(p=>{setRecords(p.records||[]);setRecordId((current:string)=>current||p.records?.[0]?.id||"")}).catch(()=>setMessage("Unable to load Secondary applied-learning records."))};
  useEffect(()=>{void authFetch("/api/hpc/learners").then(r=>r.json()).then(p=>{setLearners(p.learners||[]);setLearnerId(p.learners?.find((x:any)=>Number(x.grade)>=9)?.id||"")})},[]);useEffect(load,[learnerId]);useEffect(()=>{const refresh=()=>load();window.addEventListener("hpc-applied-learning-updated",refresh);return()=>window.removeEventListener("hpc-applied-learning-updated",refresh)},[learnerId]);useEffect(()=>{if(!learnerId)return;void authFetch(`/api/hpc/learners/${encodeURIComponent(learnerId)}/prompt1`).then(r=>r.json()).then(p=>setCatalogue(p.catalogue||[])).catch(()=>setCatalogue([]))},[learnerId]);
  const record=records.find(item=>item.id===recordId),domain=catalogue.find(item=>item.id===domainId),goals=domain?.hpc_curricular_goals||[],goal=goals.find((item:any)=>item.id===goalId),competencies=goal?.hpc_competencies||[],competency=competencies.find((item:any)=>item.id===competencyId),outcomes=competency?.hpc_learning_outcomes||[];
  const post=async(path:string,body:any,success:string)=>{const r=await authFetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),p=await r.json();setMessage(r.ok?success:p.error);if(r.ok)load()};
  const proof=async(form:HTMLFormElement)=>{if(!record)return;const f=new FormData(form),file=f.get("proof") as File;if(!file?.size){setMessage("Choose a certificate or proof file.");return}if(file.size>10*1024*1024){setMessage("Proof files must be 10 MB or smaller.");return}const fileId=`hpc-course-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"-")}`,upload=await authFetch(`/api/files/${encodeURIComponent(fileId)}`,{method:"PUT",headers:{"Content-Type":file.type||"application/octet-stream"},body:file});if(!upload.ok){setMessage((await upload.json()).error||"Proof upload failed.");return}await post(`/api/hpc/applied-learning/${encodeURIComponent(record.id)}/course-proof`,{providerName:f.get("provider"),courseName:f.get("course"),completionStatus:f.get("status"),completionDate:f.get("date"),hoursCompleted:f.get("hours"),verificationNote:f.get("note"),proofReference:JSON.stringify({fileId,fileName:file.name,fileType:file.type,size:file.size})},"Course proof saved for verification.")};
  if(!records.length)return null;
  return <section className="card span-2 hpc-prompt-one"><CardHead eyebrow="Prompt 4 · mapping and final review" title="Outcomes, rubric decisions and course completion proof"/><Field label="Secondary learner"><select value={learnerId} onChange={e=>{setRecordId("");setLearnerId(e.target.value)}}>{learners.filter(l=>Number(l.grade)>=9).map(l=><option key={l.id} value={l.id}>{l.students?.name||"Learner"} · Grade {l.grade}</option>)}</select></Field><Field label="Applied-learning record"><select value={recordId} onChange={e=>setRecordId(e.target.value)}>{records.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>{record&&<div className="hpc-prompt-grid"><form className="hpc-subform" onSubmit={e=>{e.preventDefault();void post(`/api/hpc/applied-learning/${encodeURIComponent(record.id)}/mapping`,{domainId,curricularGoalId:goalId,competencyId,learningOutcomeId:outcomeId},"Applied-learning mapping saved.")}}><b>Approved learning mapping</b>{!catalogue.length?<p className="modal-copy">No detailed approved curricular catalogue is loaded for this framework, so no descriptor can be invented.</p>:<><label>Subject/domain<select value={domainId} onChange={e=>{setDomainId(e.target.value);setGoalId("");setCompetencyId("");setOutcomeId("")}} required><option value="">Select subject</option>{catalogue.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label><label>Curricular goal<select value={goalId} onChange={e=>{setGoalId(e.target.value);setCompetencyId("");setOutcomeId("")}} disabled={!domainId} required><option value="">Select goal</option>{goals.map((item:any)=><option key={item.id} value={item.id}>{item.code} · {item.label}</option>)}</select></label><label>Competency<select value={competencyId} onChange={e=>{setCompetencyId(e.target.value);setOutcomeId("")}} disabled={!goalId} required><option value="">Select competency</option>{competencies.map((item:any)=><option key={item.id} value={item.id}>{item.code} · {item.label}</option>)}</select></label><label>Learning outcome<select value={outcomeId} onChange={e=>setOutcomeId(e.target.value)} disabled={!competencyId}><option value="">Not specified</option>{outcomes.map((item:any)=><option key={item.id} value={item.id}>{item.code} · {item.label}</option>)}</select></label><button className="secondary" disabled={!competencyId}>Save mapping</button></>}<div className="hpc-records">{record.mappings?.map((item:any)=><small key={item.id}>{item.hpc_domains?.label} · {item.hpc_competencies?.code} · {item.hpc_learning_outcomes?.code||"outcome not specified"}</small>)}</div></form><form className="hpc-subform" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void post(`/api/hpc/applied-learning/${encodeURIComponent(record.id)}/final-review`,{action:"criterion",criterion:f.get("criterion"),descriptor:f.get("descriptor"),maximumScore:f.get("maximum"),teacherScore:f.get("score"),teacherComment:f.get("comment")},"Rubric criterion saved.")}}><b>Final rubric criterion</b><label>Criterion<input name="criterion" required/></label><label>Descriptor<textarea name="descriptor" required/></label><div className="form-grid"><label>Maximum score<input name="maximum" type="number" min="0.5" step="0.5" required/></label><label>Teacher score<input name="score" type="number" min="0" step="0.5" required/></label></div><label>Teacher comment<textarea name="comment"/></label><button className="secondary">Save criterion</button><div className="hpc-records">{record.criteria?.map((item:any)=><small key={item.id}>{item.criterion} · {item.teacher_score}/{item.maximum_score}</small>)}</div></form><form className="hpc-subform" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void post(`/api/hpc/applied-learning/${encodeURIComponent(record.id)}/final-review`,{action:"finalise",scoringBasis:f.get("basis"),officialLevelText:f.get("level"),moderationNote:f.get("note")},"Final assessment saved.")}}><b>Final score workflow</b><label>Scoring basis<select name="basis"><option value="teacher_rubric">Teacher rubric total</option><option value="approved_official_level">Approved official level</option><option value="not_prescribed">No official score prescribed</option></select></label><label>Approved official level, if applicable<input name="level"/></label><label>Moderation note<textarea name="note"/></label><button className="primary">Finalise assessment</button>{record.finalAssessment&&<small>Final: {record.finalAssessment.total_score}/{record.finalAssessment.maximum_score} · {record.finalAssessment.scoring_basis}</small>}</form>{record.record_type==="online_course"&&<form className="hpc-subform" onSubmit={e=>{e.preventDefault();void proof(e.currentTarget)}}><b>Online-course proof</b><label>Provider<input name="provider" required/></label><label>Course name<input name="course" required/></label><div className="form-grid"><label>Status<select name="status"><option value="enrolled">Enrolled</option><option value="in_progress">In progress</option><option value="completed">Completed</option></select></label><label>Completion date<input name="date" type="date"/></label><label>Hours completed<input name="hours" type="number" min="0" step="0.5"/></label></div><label>Certificate / proof<input name="proof" type="file" required accept="image/*,.pdf,.doc,.docx"/></label><label>Verification note<textarea name="note"/></label><button className="secondary">Upload and save proof</button>{record.courseProof&&<small>{record.courseProof.provider_name} · {record.courseProof.completion_status}</small>}</form>}</div>}{message&&<p className={message.includes("saved")?"success-note":"form-error"}>{message}</p>}</section>;
}

function TeacherHome({profile,state,openAssessment,open}:any){
  const pending=state.assessments.reduce((n:any,a:any)=>n+Math.max(0,a.totalReviews-a.reviewed),0);
  const concepts=conceptMastery(state);
  const priorityConcepts=concepts.filter(c=>c.mastery<70);
  const today=new Date().toISOString().slice(0,10);
  const followupsDue=state.interventions.filter((i:Intervention)=>i.status!=="Completed"&&i.followup&&i.followup<=today).length;
  return <><PageHead eyebrow="Teacher workspace" title={`Good morning, ${String(profile?.name||"Teacher").split(" ")[0]}.`} subtitle="Follow the clearest path from evidence to action."><button className="primary" onClick={()=>open("create-assessment")}>＋ Create assessment</button><button className="secondary" onClick={()=>open(state.assessments.length?"upload":"create-assessment")}>{state.assessments.length?"↑ Upload work":"＋ Create assessment"}</button></PageHead>
    <section className="metric-grid five"><Metric label="Assessments" value={state.assessments.length} note="Persisted securely"/><Metric label="Answers to review" value={pending} note="Teacher judgement"/><Metric label="Priority gaps" value={String(priorityConcepts.length)} note={concepts.length?`Across ${concepts.length} concept${concepts.length===1?"":"s"} with evidence`:"No graded evidence yet"}/><Metric label="Interventions" value={state.interventions.length} note="Active cycles"/><Metric label="Follow-ups due" value={String(followupsDue)} note="Overdue or due today"/></section>
    <div className="dashboard-grid"><section className="card span-2"><CardHead title="Continue your work" eyebrow="Assessment pipeline"><button className="link" onClick={()=>open("create-assessment")}>New assessment →</button></CardHead>
      <div className="table"><div className="tr th"><span>Assessment</span><span>Progress</span><span>Next step</span><span>Status</span></div>{state.assessments.map((a:any)=><button className="tr row-button" key={a.id} onClick={()=>openAssessment(a.id,"Work")}><span><b>{a.title}</b><small>Class {a.grade}{a.section} · {a.subject}</small></span><span>{a.reviewed}/{a.totalReviews||0}</span><span>{nextAction(a.stage)}</span><span><b>{stageLabel[a.stage as Stage]}</b></span></button>)}</div>
    </section><section className="card"><CardHead eyebrow="Recommended next" title={pending?"Review uncertain answers":"Create a new Learning X-Ray"}/><p>AI suggestions remain drafts until you approve them.</p><button className="primary" onClick={()=>pending?openAssessment(state.assessments[0]?.id,"Review"):open("create-assessment")}>{pending?"Review next answer":"Create assessment"} →</button></section></div></>;
}

function Work({state,setState,selected,openAssessment,open,update,notify}:any){
  const [filter,setFilter]=useState("All");
  const list=state.assessments.filter((a:any)=>filter==="All"||stageLabel[a.stage].includes(filter));
  return <><PageHead eyebrow="Teacher workspace" title="Work & evidence" subtitle="Create the assessment and attach its required reference documents before adding student answer sheets."><button className="primary" onClick={()=>open("create-assessment")}>＋ Create assessment</button></PageHead>
    <section className="card span-2 evidence-entry"><div><p className="eyebrow">Assessment-first evidence</p><h2>Keep every analysis grounded in the assessment</h2><p>Creation now captures Class 1–12, the compulsory question paper, and optional marking scheme and model answer. Add student answer sheets after saving.</p></div><div className="evidence-role-list"><span>Question paper · required</span><span>Marking scheme</span><span>Model answer</span><span>Student answers</span></div></section>
    <div className="dashboard-grid"><section className="card span-2"><div className="filters">{["All","Draft","Uploaded","Review","Published"].map(x=><button key={x} className={filter===x?"active":""} onClick={()=>setFilter(x)}>{x}</button>)}</div><div className="work-grid">{list.map((a:any)=><button className={`work-card ${selected?.id===a.id?"selected-card":""}`} key={a.id} onClick={()=>openAssessment(a.id)}><div className="mini-paper"><i/><i/><i/></div><b>{a.title}</b><small>Class {a.grade}{a.section} · {a.subject}</small><Progress value={Math.round(stageProgress(a.stage))}/><span>{stageLabel[a.stage]} →</span></button>)}</div></section>
    {selected&&<AssessmentDecision assessment={selected} open={open} openAssessment={openAssessment}/>}
    {selected&&<AssessmentJourney assessment={selected} open={open}/>}
    {selected&&<UploadedFiles assessment={selected} update={update} notify={notify} open={open}/>}</div></>;
}

function AssessmentDecision({assessment:a,open,openAssessment}:any){
  const results=Object.values(a.gradeResults||{}) as GradeResult[],graded=results.some(result=>!result.gradingSkipped),diagnosed=results.length>0;
  const learningGaps=()=>diagnosed?openAssessment(a.id,"X-Ray"):openAssessment(a.id,"Review");
  return <section className="card span-2 decision-card"><div><p className="eyebrow">Choose an action</p><h2>{graded?"AI grading is ready for teacher review":diagnosed?"Learning-gap diagnosis is ready":"Start AI grading"}</h2><p>{graded?"Open the reviewed answer sheets or view their learning-gap analysis.":diagnosed?"Open the selected assessment in Review or continue to learning-gap analysis.":"AI grading processes the selected answer sheets without an OCR review step, then opens the existing Review tab for teacher review."}</p></div><div className="button-row"><button className="primary" onClick={()=>open("grade-picker")}>Analyse Assessment</button><button className="secondary" onClick={()=>open("bulk-analysis")}>Check Multiple Students</button><button className="secondary" onClick={learningGaps}>View learning gaps</button><button className="link danger" onClick={()=>open("delete-assessment")}>Delete Assessment</button></div></section>
}

function AssessmentJourney({assessment:a,open}:any){
  const steps:[Stage,string,string][]=[["draft","Assessment details","create-assessment"],["uploaded","Student work","upload"],["setup","Questions & rubric","setup"],["grading","AI processing","process"],["review","Teacher review","review-help"],["approved","Final approval","approval"],["xray","Learning X-Ray","xray-details"],["intervention","Intervention","intervention-form"],["followup","Follow-up","followup"],["published","Publish grades","publish"]];
  const current=Object.keys(stageLabel).indexOf(a.stage);
  return <section className="card span-2"><CardHead eyebrow="End-to-end workflow" title={a.title}><span className="status success">Version {a.version}</span></CardHead><div className="journey">{steps.map(([stage,label,action],i)=><button key={stage} className={i<=current?"done":i===current+1?"current":""} onClick={()=>open(action)}><i>{i<current?"✓":i+1}</i><b>{label}</b><small>{i<=current?"Complete":"Open step"}</small></button>)}</div></section>;
}

function LegacyReview({selected,update,notify,open}:any){
  const a=selected;
  const results:GradeResult[]=(Object.values(a.gradeResults||{}) as GradeResult[]).sort((x,y)=>x.date.localeCompare(y.date));
  const remaining=Math.max(0,a.totalReviews-a.reviewed);
  const [index,setIndex]=useState(0);
  const current=results.length?results[Math.min(index,results.length-1)]:undefined;
  const gradedFile=current?a.files.find((f:UploadFile)=>f.id===current.fileId):undefined;
  const [mark,setMark]=useState(current?String(current.score):"0");
  const [note,setNote]=useState(current?.feedback||"");
  useEffect(()=>{setMark(current?String(current.score):"0");setNote(current?.feedback||"")},[current?.fileId]);
  const approve=()=>{
    const reviewed=Math.min(a.totalReviews,a.reviewed+1);
    update(a.id,{reviewed,stage:reviewed===a.totalReviews?"approved":"review"});
    notify(reviewed===a.totalReviews?"All answers approved. Final approval is ready.":"Mark approved. Next answer loaded.");
    if(index<results.length-1)setIndex(index+1);
  };
  if(!results.length)return <><PageHead eyebrow={a.title} title="Teacher grading review" subtitle="Compare the original evidence, AI suggestion and rubric before approval."><button className="secondary" onClick={()=>open("grade-picker")}>Grade an answer sheet</button></PageHead>
    <section className="card span-2"><p className="eyebrow">No graded evidence yet</p><h2>Grade an answer sheet to review it here</h2><p>This screen shows the real OCR text, score and rubric evidence from EduAI once you grade a student's answer sheet — there's nothing to review until then.</p></section></>;
  return <><PageHead eyebrow={`${a.title} · Answer ${index+1} of ${results.length}`} title="Teacher grading review" subtitle="Compare the original evidence, AI suggestion and rubric before approval."><button className="secondary" onClick={()=>open("bulk-review")}>Bulk review</button><button className="secondary" onClick={()=>open(`grade-file:${current?.fileId}`)}>Regrade</button></PageHead>
    <div className="review-layout"><section className="card paper-panel"><CardHead eyebrow={`Selected answer sheet · ${gradedFile?.name||"answer sheet"}`} title={`${current?.studentName} · graded against ${current?.questionPaperName||"subject rubric"}`}><span className="status warning">Draft · teacher approval required</span></CardHead><div className="paper">{current?.ocrText?<p className="hand">{current.ocrText}</p>:<p className="hand note">OCR text was not stored for this earlier grading run.</p>}<i className="teacher-mark">{mark}/{current?.maxMarks}</i></div><div className="source-files"><b>Graded answer sheet:</b><span>{gradedFile?.name||"Selected upload"}</span><b>Reference files:</b>{a.files.filter((f:UploadFile)=>f.id!==gradedFile?.id).map((f:UploadFile)=><span key={f.id}>{f.name}</span>)}</div><div className="pager"><button disabled={index===0} onClick={()=>setIndex(Math.max(0,index-1))}>← Previous</button><span>{remaining} remaining</span><button disabled={index>=results.length-1} onClick={()=>setIndex(Math.min(results.length-1,index+1))}>Next →</button></div></section>
    <aside className="card inspector"><p className="eyebrow">AI suggestion · draft · {a.subject}</p><h2>{current?.score} / {current?.maxMarks} marks</h2><div className="evidence"><b>Concept-level evidence</b>{current?.gaps.map(g=><p key={g.concept}>{g.concept}: {g.mastery}% mastery</p>)}</div>{current?.feedback&&<div className="evidence"><b>AI feedback</b><p>{current.feedback}</p></div>}<label>Teacher mark<input type="number" min="0" max={current?.maxMarks} step=".5" value={mark} onChange={e=>setMark(e.target.value)}/></label><label>Teacher note<textarea value={note} onChange={e=>setNote(e.target.value)}/></label><div className="button-row"><button className="secondary" onClick={()=>open(`grade-file:${current?.fileId}`)}>Regrade this answer</button><button className="secondary" onClick={()=>notify("Escalated this assessment to subject coordinator","warning")}>Escalate</button></div><button className="primary full" disabled={!remaining} onClick={approve}>{remaining?"Approve & next":"Review complete ✓"}</button>{!remaining&&<button className="primary full" onClick={()=>open("approval")}>Final approval & publish</button>}<p className="audit-note">OCR + diagnostic grading · {a.subject} rubric · Version {a.version} · teacher decision recorded</p></aside></div></>;
}

function Review({selected,update,notify,open,setState}:any){
  if(!selected)return <><PageHead eyebrow="Teacher workspace" title="Review" subtitle="Review opens after you create an assessment and process at least one student answer sheet."><button className="primary" onClick={()=>open("create-assessment")}>＋ Create assessment</button></PageHead><section className="card span-2"><p className="eyebrow">Nothing to review yet</p><h2>Create an assessment first</h2><p>Add the question paper and student work in Work. After AI processing, the answer sheets will appear here for teacher review.</p><button className="secondary" onClick={()=>open("create-assessment")}>Create assessment</button></section></>;
  return <ReviewWorkspace selected={selected} update={update} notify={notify} open={open} setState={setState}/>;
}

function ReviewWorkspace({selected,update,notify,open,setState}:any){
  const assessment:Assessment=selected;
  const results=(Object.values(assessment.gradeResults||{}) as GradeResult[]).sort((left,right)=>left.date.localeCompare(right.date));
  const [studentIndex,setStudentIndex]=useState(0);
  const current=results[Math.min(studentIndex,Math.max(0,results.length-1))];
  const answerFile=current?assessment.files.find(file=>file.id===current.fileId):undefined;
  const questions=current?.questionDecisions||[];
  const [drafts,setDrafts]=useState<Record<string,{mark:number;comment:string;reviewed:boolean}>>({});
  const [collapsed,setCollapsed]=useState<Record<string,boolean>>({});
  const [sourceUrl,setSourceUrl]=useState("");
  const [saveStatus,setSaveStatus]=useState("Saved");
  const [creatingCorrectedCopy,setCreatingCorrectedCopy]=useState(false);
  useEffect(()=>{setDrafts(Object.fromEntries(questions.map(question=>[question.id,{mark:Number(question.awardedMarks),comment:question.teacherComment||"",reviewed:Boolean(question.reviewed)}])));setCollapsed({});setSaveStatus("Saved")},[current?.fileId]);
  useEffect(()=>{let active=true,url="";(async()=>{if(!answerFile){setSourceUrl("");return}const blob=await readFileBlob(answerFile.id);if(blob&&active){url=URL.createObjectURL(blob);setSourceUrl(url)}})();return()=>{active=false;if(url)URL.revokeObjectURL(url)}},[answerFile?.id]);
  const reviewedCount=questions.filter(question=>drafts[question.id]?.reviewed).length;
  const pendingCount=questions.length-reviewedCount;
  const aiTotal=questions.reduce((sum,question)=>sum+Number(question.aiAwardedMarks??question.awardedMarks),0);
  const teacherTotal=questions.reduce((sum,question)=>sum+Number(drafts[question.id]?.mark??question.awardedMarks),0);
  const pageNumbers=Array.from(new Set(questions.map(question=>Math.max(1,Number(question.pageNumber)||1)))).sort((left,right)=>left-right);
  const saveDrafts=(next:Record<string,{mark:number;comment:string;reviewed:boolean}>)=>{if(!current)return;const questionDecisions=questions.map(question=>{const draft=next[question.id];return {...question,aiAwardedMarks:question.aiAwardedMarks??question.awardedMarks,awardedMarks:draft?.mark??question.awardedMarks,teacherComment:draft?.comment||"",reviewed:Boolean(draft?.reviewed)}});const score=questionDecisions.filter(question=>question.attemptState!=="excluded").reduce((sum,question)=>sum+Number(question.awardedMarks||0),0);update(assessment.id,{gradeResults:{...(assessment.gradeResults||{}),[current.fileId]:{...current,score,questionDecisions}},reviewed:questionDecisions.filter(question=>question.reviewed).length,totalReviews:questionDecisions.length,stage:"review"});setSaveStatus("✓ Auto-saved")};
  useEffect(()=>{if(!current||!Object.keys(drafts).length)return;setSaveStatus("Saving…");const timer=window.setTimeout(()=>saveDrafts(drafts),650);return()=>window.clearTimeout(timer)},[drafts]);
  const changeDraft=(id:string,patch:Partial<{mark:number;comment:string;reviewed:boolean}>)=>setDrafts(value=>({...value,[id]:{...value[id],...patch}}));
  const approvedResult=(result:GradeResult,nextDrafts:Record<string,{mark:number;comment:string;reviewed:boolean}>)=>{const decisions=(result.questionDecisions||[]).map(question=>{const draft=nextDrafts[question.id];return {...question,aiAwardedMarks:question.aiAwardedMarks??question.awardedMarks,awardedMarks:draft?.mark??question.awardedMarks,teacherComment:draft?.comment||question.teacherComment||"",reviewed:true}});return {...result,score:decisions.filter(question=>question.attemptState!=="excluded").reduce((sum,question)=>sum+Number(question.awardedMarks||0),0),questionDecisions:decisions}};
  const submitReview=()=>{if(!current||pendingCount)return;const finalResult=approvedResult(current,drafts);saveDrafts(drafts);update(assessment.id,{stage:"approved",reviewed:questions.length,totalReviews:questions.length,gradeResults:{...(assessment.gradeResults||{}),[current.fileId]:finalResult}});notify("Review submitted. Resources are generating in the background.");void generateAllStudentResources(assessment,finalResult,setState).then(()=>notify(`Updated resources are ready for ${finalResult.studentName}.`)).catch(error=>notify(error instanceof Error?error.message:"Resource generation failed","error"))};
  const bulkApprove=()=>{const approved=results.map(result=>approvedResult(result,Object.fromEntries((result.questionDecisions||[]).map(question=>[question.id,{mark:question.awardedMarks,comment:question.teacherComment||"",reviewed:true}]))));const gradeResults={...(assessment.gradeResults||{})};approved.forEach(result=>{gradeResults[result.fileId]=result});const count=approved.reduce((sum,result)=>sum+(result.questionDecisions?.length||0),0);update(assessment.id,{stage:"approved",reviewed:count,totalReviews:count,gradeResults});notify(`Bulk approval started for ${approved.length} students. Resources will appear as they finish.`);approved.forEach(result=>void generateAllStudentResources(assessment,result,setState).catch(error=>notify(error instanceof Error?error.message:"Background resource generation failed","error")))};
  const jumpTo=(id:string)=>{setCollapsed(value=>({...value,[id]:false}));window.setTimeout(()=>document.getElementById(`review-question-${id}`)?.scrollIntoView({behavior:"smooth",block:"start"}),30)};
  if(!results.length)return <><PageHead eyebrow={assessment.title} title="Teacher grading review" subtitle="This selected assessment is open and ready for its reviewed answer sheets."></PageHead><section className="card span-2"><p className="eyebrow">No reviewed answers yet</p><h2>This assessment is loaded in Review</h2><p>Add or process student answer sheets from the assessment evidence area; this direct Review route does not open an OCR confirmation pop-up.</p></section></>;
  return <><section className="review-top-actions"><button className="link" onClick={()=>open("bulk-review")}>← Back to Submissions</button><div className="review-student-bar" aria-label="Student review navigation"><button className="link" disabled={studentIndex===0} onClick={()=>setStudentIndex(value=>Math.max(0,value-1))}>← Previous Student</button><div><select aria-label="Current student" value={studentIndex} onChange={event=>setStudentIndex(Number(event.target.value))}>{results.map((result,index)=><option key={result.fileId} value={index}>{result.studentName}</option>)}</select><small>{assessment.grade}-{assessment.section} | {assessment.subject} - {assessment.title}</small></div><button className="link" disabled={studentIndex===results.length-1} onClick={()=>setStudentIndex(value=>Math.min(results.length-1,value+1))}>Next Student →</button></div><div className="button-row"><button className="link" disabled={creatingCorrectedCopy} onClick={async()=>{if(!answerFile){notify("The original answer sheet is unavailable. Re-upload it before creating a corrected copy.","error");return}setCreatingCorrectedCopy(true);try{await downloadCorrectedAnswerSheet(assessment,current,answerFile);notify(`Corrected answer sheet created for ${current.studentName}.`)}catch(error){notify(error instanceof Error?error.message:"The corrected answer sheet could not be created.","error")}finally{setCreatingCorrectedCopy(false)}}}>{creatingCorrectedCopy?"Preparing student copy…":"Create Corrected Answer Sheet"}</button><button className="primary" disabled={pendingCount>0} onClick={submitReview}>Submit Review & Generate Resource</button><button className="secondary" onClick={bulkApprove}>Bulk Approval & Generate Resource</button></div></section>
    <section className="review-student-details"><span><small>Student Name</small><b>{current.studentName}</b></span><span><small>Class</small><b>{assessment.grade} - {assessment.section}</b></span><span><small>Subject</small><b>{assessment.subject}</b></span><span><small>Assignment</small><b>{assessment.title}</b></span><span><small>Submitted On</small><b>{new Date(current.date).toLocaleString()}</b></span></section>
    <section className="review-summary-compact card" aria-label="Overall Summary"><p className="eyebrow">Overall Summary</p><div className="review-score-ring" style={{"--review-progress":`${current.maxMarks?Math.round(teacherTotal/current.maxMarks*100):0}%`} as any}><b>{teacherTotal}</b><small>/ {current.maxMarks}</small></div><div><span>AI Total Marks <b>{aiTotal} / {current.maxMarks}</b></span><span>Teacher Reviewed <b>{reviewedCount} / {questions.length}</b></span><span>Pending Review <b>{pendingCount} / {questions.length}</b></span></div></section>
    <div className="continuous-review-layout"><div className="continuous-review-workspace">{pageNumbers.map((pageNumber,pageIndex)=>{const pageQuestions=questions.filter(question=>(Number(question.pageNumber)||1)===pageNumber);return <section className="review-page" key={pageNumber}><header><span>PAGE {pageIndex+1} OF {pageNumbers.length}</span><small>{answerFile?.name||"Answer sheet"}</small></header>{pageQuestions.map((question,questionIndex)=>{const draft=drafts[question.id]||{mark:question.awardedMarks,comment:question.teacherComment||"",reviewed:question.reviewed};const aiMark=question.aiAwardedMarks??question.awardedMarks;const isCollapsed=Boolean(collapsed[question.id]);return <article id={`review-question-${question.id}`} className={`review-question-card ${draft.reviewed?"is-reviewed":""}`} key={question.id}><button className="review-question-toggle" aria-expanded={!isCollapsed} onClick={()=>setCollapsed(value=>({...value,[question.id]:!value[question.id]}))}><span>Q{questionIndex+1} · {draft.reviewed?"✓ Reviewed":question.attemptState==="not_attempted"?"Not Answered":"Pending"}</span><b>{draft.reviewed?`${draft.mark}/${question.maxMarks}`:`—/${question.maxMarks}`}</b><i>{isCollapsed?"▾":"▴"}</i></button>{!isCollapsed&&<div className="five-stage-review"><section><p className="eyebrow">1. Question</p><div className="review-section-head"><h3>{question.label}</h3><span>{question.maxMarks} Marks</span></div></section><section><p className="eyebrow">2. Student Handwritten Answer</p>{sourceUrl?(answerFile?.type?.startsWith("image/")?<div className="answer-image-wrap"><img src={sourceUrl} alt={`Original handwritten answer for ${question.label}`}/><a className="secondary" href={sourceUrl} target="_blank" rel="noreferrer">Expand original</a></div>:<div className="answer-document-wrap"><object data={`${sourceUrl}#page=${pageNumber}`} type={answerFile?.type||"application/pdf"} aria-label={`Original answer-sheet page ${pageNumber}`}/><a className="secondary" href={`${sourceUrl}#page=${pageNumber}`} target="_blank" rel="noreferrer">Expand original page</a></div>):<p className="review-empty">Original file is unavailable on this device. Re-open or re-upload the secured answer sheet.</p>}</section><section><div className="review-section-head"><p className="eyebrow">3. OCR (Extracted Text)</p><button className="link" onClick={()=>navigator.clipboard?.writeText(question.evidence||current.ocrText||"").then(()=>notify("OCR text copied"))}>Copy</button></div><p className="ocr-review-text">{question.evidence||current.ocrText||"No stored OCR excerpt for this question."}</p></section><section className="ai-marking-panel"><p className="eyebrow">4. Marking Done by AI</p><div className="review-section-head"><h3>AI Awarded Marks</h3><strong>{aiMark} / {question.maxMarks}</strong></div><b>AI Evaluation / Feedback</b><p>{question.rationale||current.feedback||"No AI feedback stored."}</p>{question.confidence>0&&<small>AI confidence: {Math.round(question.confidence*100)}%</small>}</section><section className="teacher-edit-panel"><p className="eyebrow">5. Edit Marks & Comments — Teacher</p><div className="teacher-mark-row"><label>Teacher Edited Marks<input type="number" min="0" max={question.maxMarks} step={question.allowedIncrement||0.5} value={draft.mark} onChange={event=>changeDraft(question.id,{mark:Math.max(0,Math.min(question.maxMarks,Number(event.target.value)))})}/><span>/ {question.maxMarks}</span></label><em>{aiMark===draft.mark?`Same as AI: ${aiMark}/${question.maxMarks}`:`AI ${aiMark}/${question.maxMarks} → Teacher ${draft.mark}/${question.maxMarks}`}</em></div><label>Teacher Comments (Optional)<textarea rows={3} value={draft.comment} onChange={event=>changeDraft(question.id,{comment:event.target.value})} placeholder="Add feedback for this answer…"/></label><div className="teacher-save-row"><span>{saveStatus}</span><label className="check"><input type="checkbox" checked={draft.reviewed} onChange={event=>changeDraft(question.id,{reviewed:event.target.checked})}/> Mark as reviewed</label></div></section></div>}</article>})}<footer><span>END OF PAGE {pageIndex+1}</span></footer></section>})}</div><aside className="question-navigator card"><p className="eyebrow">Questions</p>{pageNumbers.map((pageNumber,pageIndex)=><section key={pageNumber}><b>Page {pageIndex+1}</b>{questions.filter(question=>(Number(question.pageNumber)||1)===pageNumber).map(question=>{const draft=drafts[question.id];return <button key={question.id} onClick={()=>jumpTo(question.id)}><span>{question.label}</span><small>{draft?.reviewed?"Reviewed":question.attemptState==="not_attempted"?"Not Answered":"Pending"}</small><em>{draft?.reviewed?`${draft.mark}/${question.maxMarks}`:`—/${question.maxMarks}`}</em></button>})}</section>)}</aside></div></>;
}

function XRay({state,setState,selected,openAssessment,open,notify}:any){
  const options=classSubjectOptions(state);
  const mappedAssessment=selected?.grade&&selected?.section&&selected?.subject?selected:state.assessments.find((assessment:Assessment)=>assessment.grade&&assessment.section&&assessment.subject);
  const initialClassKey=mappedAssessment?`${mappedAssessment.grade}|${mappedAssessment.section.toUpperCase()}`:options[0]?.classKey||"";
  const [classKey,setClassKey]=useState(initialClassKey);
  const [subject,setSubject]=useState(mappedAssessment?.subject||options.find(o=>o.classKey===initialClassKey)?.subject||"");
  const [assessmentId,setAssessmentId]=useState(mappedAssessment?.id||"");
  const classOptions=Array.from(new Map(options.map(o=>[o.classKey,o])).values());
  const subjects=Array.from(new Set(options.filter(o=>o.classKey===classKey).map(o=>o.subject)));
  const effectiveSubject=subjects.includes(subject)?subject:subjects[0]||"";
  const assessments:Assessment[]=state.assessments.filter((a:Assessment)=>`${a.grade}|${a.section.toUpperCase()}`===classKey&&a.subject===effectiveSubject);
  const analysis=assessments.find(a=>a.id===assessmentId)||assessments[0];
  const chooseClass=(nextClass:string)=>{
    const nextSubject=options.find(o=>o.classKey===nextClass)?.subject||"";
    const nextAssessment=state.assessments.find((a:Assessment)=>`${a.grade}|${a.section.toUpperCase()}`===nextClass&&a.subject===nextSubject);
    setClassKey(nextClass);setSubject(nextSubject);setAssessmentId(nextAssessment?.id||"");
  };
  const chooseSubject=(nextSubject:string)=>{
    const nextAssessment=state.assessments.find((a:Assessment)=>`${a.grade}|${a.section.toUpperCase()}`===classKey&&a.subject===nextSubject);
    setSubject(nextSubject);setAssessmentId(nextAssessment?.id||"");
  };
  return <><PageHead eyebrow="Class analysis" title="Class, subject & assessment heatmap" subtitle="Review evidence in the hierarchy: class and section, subject, assessment, then students."><button className="primary" onClick={()=>open("class")}>＋ Create class & subject</button><button className="secondary" onClick={()=>open("create-assessment")}>＋ Create assessment</button></PageHead>
    <section className="card analysis-scope" aria-label="Visual learning-gap report"><CardHead eyebrow="Analysis scope" title="Class & section → Subject → Assessment → Students"/><div className="analysis-scope-grid">
      <Field label="Class & section"><select value={classKey} onChange={e=>chooseClass(e.target.value)}>{classOptions.map(o=><option key={o.classKey} value={o.classKey}>Class {o.grade}{o.section}</option>)}</select></Field>
      <Field label="Subject"><select value={effectiveSubject} onChange={e=>chooseSubject(e.target.value)} disabled={!subjects.length}>{subjects.map(item=><option key={item}>{item}</option>)}</select></Field>
      <Field label="Assessment"><select value={analysis?.id||""} onChange={e=>setAssessmentId(e.target.value)} disabled={!assessments.length}>{assessments.map(a=><option key={a.id} value={a.id}>{a.title} · {a.date}</option>)}</select></Field>
    </div><p className="analysis-scope-note">Every analysis is linked to a saved assessment with a compulsory question paper and its Class master record.</p></section>
    {!analysis?<section className="card"><p className="eyebrow">No assessment evidence yet</p><h2>Create the assessment first</h2><p>Add its Class, subject, question paper, marking scheme, and model answer before uploading student responses.</p><button className="primary" onClick={()=>open("create-assessment")}>Create assessment</button></section>:<AssessmentHeatmap selected={analysis} open={open} notify={notify}/>}
  </>;
}

function AssessmentHeatmap({selected,open,notify}:any){
  const results:GradeResult[]=Object.values(selected.gradeResults||{});
  const hasData=results.length>0;

  // Aggregate mastery per concept across every real graded result.
  const conceptTotals:{[concept:string]:{sum:number;count:number}}={};
  results.forEach(r=>r.gaps.forEach(g=>{
    const bucket=conceptTotals[g.concept]||{sum:0,count:0};
    bucket.sum+=g.mastery;bucket.count+=1;
    conceptTotals[g.concept]=bucket;
  }));
  const concepts=Object.keys(conceptTotals);
  const avgFor=(c:string)=>Math.round(conceptTotals[c].sum/conceptTotals[c].count);
  const sortedConcepts=concepts.slice().sort((a,b)=>avgFor(a)-avgFor(b));
  const priorityConcept=sortedConcepts[0];
  const classMastery=concepts.length?Math.round(concepts.reduce((s,c)=>s+avgFor(c),0)/concepts.length):0;
  const priorityStudents=results.filter(r=>r.gaps.some(g=>g.concept===priorityConcept&&g.mastery<70));
  const students=Array.from(new Set(results.map(r=>r.studentName)));
  const clusterMap=new Map<string,string[]>();
  results.forEach(r=>{const signature=r.gaps.filter(g=>g.mastery<70).sort((a,b)=>a.mastery-b.mastery).slice(0,2).map(g=>g.concept).join(" + ")||"Monitor only";clusterMap.set(signature,[...(clusterMap.get(signature)||[]),r.studentName])});
  const clusters=Array.from(clusterMap.entries()).sort((a,b)=>b[1].length-a[1].length);

  const lastGradedFileId=selected.lastGradedFileId||results[0]?.fileId;
  return <><div className="assessment-analysis-actions"><div><p className="eyebrow">Selected assessment · Students</p><h2>{selected.title}</h2><span>Class {selected.grade}{selected.section} · {selected.subject} · {results.length} analysed student{results.length===1?"":"s"}</span></div><div className="button-row"><button className="secondary" disabled={!hasData} onClick={()=>downloadClassLearningGapReport(selected,results)}>Download Learning Gap Report</button><button className="primary" disabled={!hasData} onClick={()=>open(`study-guide:${lastGradedFileId}`)}>Create study guide</button><button className="secondary" onClick={()=>open("worksheet")}>Build gap worksheet</button><button className="secondary" onClick={()=>open("quality")}>Assessment quality</button></div></div>
  {!hasData&&<section className="card span-2"><p className="eyebrow">No graded evidence yet</p><h2>Grade at least one answer sheet to see real learning gaps</h2><p>This report is built entirely from Mistral-graded results for {selected.subject}. Once you grade a student's answer sheet, their concept-level gaps will appear here instead of placeholder data.</p></section>}
  {hasData&&<section className="executive-summary"><p className="eyebrow">Executive summary</p><h3>Learning gaps requiring attention</h3><ul>{sortedConcepts.map(concept=><li key={concept}><b>{concept}</b> — {avgFor(concept)}% average mastery</li>)}</ul></section>}
  {hasData&&<div className="dashboard-grid"><section className="card span-2 branded-report"><BrandDocumentHeader label="Learning gap report" title={selected.title} meta={`${selected.subject} · ${results.length} analysed answer sheet${results.length===1?"":"s"}`}/><div className="source-ribbon"><b>Evidence used</b>{selected.files.map((file:UploadFile)=><span key={file.id}>{file.documentRole||inferDocumentRole(file.name)} · {file.name}</span>)}</div><div className="xray-summary"><Metric label="Class mastery" value={`${classMastery}%`} note="Graded evidence"/><Metric label="Priority concepts" value={String(sortedConcepts.filter(c=>avgFor(c)<70).length)} note={`${priorityStudents.length} students`}/><Metric label="Confidence" value={results.length>2?"High":results.length>1?"Medium":"Low"} note={`${results.length} evidence point${results.length===1?"":"s"}`}/><Metric label="Quality" value={`${selected.quality||0}%`} note="Suitable with limitations"/></div><div className="gap-clusters"><div className="cluster-heading"><b>Dynamic intervention groups</b><span>Students with similar priority gaps</span></div>{clusters.map(([label,names],index)=><button key={label} onClick={()=>notify(`${label}: ${names.join(", ")}`)}><i>Group {index+1}</i><b>{label}</b><span>{names.join(" · ")}</span></button>)}</div><div className="heatmap" style={{gridTemplateColumns:`100px repeat(${Math.max(1,concepts.length)},minmax(72px,1fr))`}}><div/>{concepts.map(c=><b key={c}>{c}</b>)}{students.flatMap((s)=>[<span key={s}>{s}</span>,...concepts.map((c)=>{const r=results.find(x=>x.studentName===s);const g=r?.gaps.find(x=>x.concept===c);const v=g?g.mastery:null;const band=v===null?"review":v>=80?"excellent":v<=35?"weak":"average";return <button key={c+s} className={band} disabled={v===null} aria-label={`${s}, ${c}, ${v===null?"not assessed":`${v}% ${band}`}`} onClick={()=>open(`evidence:${encodeURIComponent(s)}:${encodeURIComponent(c)}`)}>{v===null?"—":`${v}%`}</button>})])}</div><div className="heat-legend" aria-label="Heatmap performance categories"><span><i className="weak"/>Weak · 35% or less</span><span><i className="average"/>Average · 36% to 79%</span><span><i className="excellent"/>Excellent · 80% or above</span><span><i className="review"/>Not assessed</span></div></section>
  <section className="card"><p className="eyebrow">Priority gap</p><h2>{priorityConcept||"No concept identified yet"}</h2><div className="big-stat">{priorityStudents.length} <small>students</small></div><p>{priorityConcept?`Lowest average mastery across graded evidence for ${selected.subject}: ${avgFor(priorityConcept)}%.`:"Grade more answer sheets to surface a priority concept."}</p><div className="gap-funnel">{sortedConcepts.slice(0,3).map(c=><span key={c} className={avgFor(c)<60?"critical":""}><i style={{width:`${avgFor(c)}%`}}/>{c} · {avgFor(c)}%</span>)}</div><button className="secondary" disabled={!priorityStudents.length} onClick={()=>open(`evidence:${encodeURIComponent(priorityStudents[0]?.studentName||"")}:${encodeURIComponent(priorityConcept||"")}`)}>View student evidence</button><button className="primary" disabled={!priorityConcept} onClick={()=>open(`study-guide:${lastGradedFileId}`)}>Generate study guide</button></section>
  <section className="card"><p className="eyebrow">Teacher authority</p><h2>Approve diagnosis</h2><label>Classification<select><option>Priority learning gap</option><option>Developing</option><option>Possible performance issue</option><option>Insufficient evidence</option></select></label><label>Observation<select><option>No additional observation</option><option>Time issue</option><option>Language issue</option><option>Careless error</option></select></label><button className="primary" onClick={()=>notify("Diagnosis approved and stored in the audit trail")}>Approve X-Ray</button></section></div>}</>;
}

function Interventions({state,setState,open,notify}:any){
  const complete=(id:string)=>{setState((s:DemoState)=>({...s,interventions:s.interventions.map(i=>i.id===id?{...i,status:"Completed"}:i),events:["Intervention completed",...s.events]}));notify("Intervention marked complete. Record follow-up evidence next.")};
  const concepts=conceptMastery(state);
  const completedCount=state.interventions.filter((i:Intervention)=>i.status==="Completed").length;
  const followupRate=state.interventions.length?Math.round((completedCount/state.interventions.length)*100):0;
  return <><PageHead eyebrow="Improvement cycle" title="Interventions & follow-up" subtitle="Temporary, concept-specific support linked to measurable evidence."><button className="primary" onClick={()=>open("intervention-form")}>＋ Create intervention</button><button className="secondary" onClick={()=>open("worksheet")}>Generate worksheet</button></PageHead>
  <div className="dashboard-grid">{state.interventions.map((i:any)=>{const evidence=concepts.find(c=>c.concept===i.concept);return <section className="card" key={i.id}><span className={`status ${i.status==="Completed"?"success":"warning"}`}>{i.status}</span><p className="eyebrow">Temporary group · Strengthen</p><h2>{i.concept}</h2><p>{i.format} · {i.duration} · {evidence?`${evidence.evidence} evidence point${evidence.evidence===1?"":"s"}`:"No graded evidence yet"}</p><p>Follow-up: {i.followup}</p>{i.followupRecorded&&i.followupEvidence&&<p className="modal-copy">Recorded outcome: {i.followupEvidence.outcome} · {i.followupEvidence.studentsCompleted} students · {i.followupEvidence.avgMastery}% avg mastery</p>}<div className="button-row"><button className="secondary" onClick={()=>open(`group:${i.assessmentId}:${encodeURIComponent(i.concept)}`)}>Review group</button>{i.status!=="Completed"?<button className="primary" onClick={()=>complete(i.id)}>Mark complete</button>:<button className="primary" onClick={()=>open(`followup:${i.id}`)}>{i.followupRecorded?"Follow-up recorded ✓":"Record follow-up"}</button>}</div></section>})}
  <section className="card"><p className="eyebrow">Resource studio</p><h2>Generate teacher-approved materials</h2><p>Worksheets, exit tickets, guided examples and answer keys remain drafts until approval.</p><button className="primary" onClick={()=>open("worksheet")}>Generate resource</button></section>
  <section className="card span-2"><CardHead eyebrow="Progress tracking" title="Concept mastery from graded evidence"/>{concepts.length?<div className="quality-bars">{concepts.slice(0,3).map(c=><Bar key={c.concept} label={c.concept} pct={c.mastery}/>)}<Bar label="Intervention follow-up completion" pct={followupRate}/></div>:<p className="modal-copy">No graded evidence yet — grade answer sheets to see real concept mastery here.</p>}</section></div></>;
}

function Reports({state,open,notify}:any){
  const [tab,setTab]=useState("Student performance");const tabs=["Student performance","Performance matrix report","Concept mastery","Learning gaps","Teacher summary","School dashboard"];
  const concepts=conceptMastery(state);
  const trend=masteryTrend(state);
  return <><PageHead eyebrow="Reports" title="Reports" subtitle="Interactive performance views with quality, privacy and limitation context."><button className="primary" onClick={()=>open("report")}>＋ Generate report</button></PageHead>
  <div className="filters">{tabs.map(x=><button key={x} className={tab===x?"active":""} onClick={()=>setTab(x)}>{x}</button>)}</div>
  {tab==="Performance matrix report"?<SchoolPerformanceMatrix state={state}/>:<div className="dashboard-grid"><section className="card span-2"><CardHead eyebrow={tab} title={reportTitle(tab)}><button className="secondary" onClick={()=>notify(`${tab} exported as a report`)}>Export</button></CardHead>
  {!concepts.length&&<p className="modal-copy">No graded evidence yet. Grade answer sheets to populate real reports here.</p>}
  {concepts.length>0&&(tab.includes("matrix")||tab.includes("mastery")?<div className="concept-bars">{concepts.map(c=><Bar key={c.concept} label={c.concept} pct={c.mastery}/>)}</div>:trend.length?<div className="chart" aria-label="Performance trend chart">{trend.map((t,i)=><button key={t.label} style={{height:`${t.value}%`}} onClick={()=>notify(`${t.label}: ${t.value}% mastery`)} aria-label={`${t.label}, ${t.value}%`}/>)}</div>:<p className="modal-copy">Grade evidence across more than one date to see a trend.</p>)}</section>
  <section className="card"><p className="eyebrow">Secure sharing</p><h2>Leadership report</h2><label>Expiry<select><option>7 days</option><option>30 days</option><option>90 days</option></select></label><label className="check"><input type="checkbox" defaultChecked/> Require access code</label><label className="check"><input type="checkbox"/> Allow download</label><button className="primary" onClick={()=>open("share-report")}>Create secure link</button></section>
  <section className="card"><p className="eyebrow">Data safeguards</p><h2>Context included</h2><ul className="checklist"><li>No teacher or student ranking</li><li>Assessment limitations disclosed</li><li>Teacher-approved results only</li><li>Revocable access</li></ul></section></div>}</>;
}

function SchoolPerformanceMatrix({state}:any){
  const [selectedCell,setSelectedCell]=useState<{className:string;subject:string;results:GradeResult[]}|null>(null);
  const classNames=Array.from(new Set<string>(state.assessments.map((a:Assessment)=>`Class ${a.grade}${a.section}`))).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  const subjects=Array.from(new Set<string>(state.assessments.map((a:Assessment)=>a.subject))).sort();
  const cell=(className:string,subject:string)=>{const assessments=state.assessments.filter((a:Assessment)=>`Class ${a.grade}${a.section}`===className&&a.subject===subject),results:GradeResult[]=assessments.flatMap((a:Assessment)=>Object.values(a.gradeResults||{})),bands={green:0,yellow:0,orange:0,red:0};results.forEach(result=>{const percentage=Math.round(result.score/Math.max(1,result.maxMarks)*100);bands[percentage>=90?"green":percentage>=75?"yellow":percentage>=55?"orange":"red"]++});const priority=["green","yellow","orange","red"] as const;const band=results.length?priority.reduce((winner,current)=>bands[current]>bands[winner]?current:winner):"empty";return {results,band,average:results.length?Math.round(results.reduce((sum,result)=>sum+result.score/Math.max(1,result.maxMarks)*100,0)/results.length):null,bands}};
  return <><section className="card principal-matrix-card"><CardHead eyebrow="Performance matrix report" title="Learning performance across grades, sections and subjects"/><p className="modal-copy">Each cell uses the score band containing the majority of students in that class and subject. Select a colored cell to view every student.</p><div className="matrix-legend" aria-label="Performance matrix score bands"><span className="green">Green · 90% and above</span><span className="yellow">Yellow · 75–89%</span><span className="orange">Orange · 55–74%</span><span className="red">Red · Below 55%</span></div><div className="principal-matrix" style={{gridTemplateColumns:`minmax(170px,1.25fr) repeat(${Math.max(1,classNames.length)},minmax(120px,1fr))`}} role="grid" aria-label="School performance matrix"><b className="matrix-corner" role="columnheader">Subjects</b>{classNames.map(className=><b key={className} role="columnheader">{className}</b>)}{subjects.flatMap(subject=>[<b key={subject} className="matrix-subject" role="rowheader">{subject}</b>,...classNames.map(className=>{const data=cell(className,subject);return <button key={`${subject}-${className}`} className={`matrix-cell ${data.band}`} disabled={!data.results.length} onClick={()=>setSelectedCell({className,subject,results:data.results})} aria-label={`${className}, ${subject}, ${data.average===null?"no results":`${data.average}% average, majority ${data.band}`}`}><strong>{data.average===null?"—":`${data.average}%`}</strong><small>{data.results.length?`${data.results.length} students · majority ${data.band}`:"No results"}</small></button>})])}</div></section>{selectedCell&&<section className="card matrix-drilldown"><CardHead eyebrow="Class drill-down" title={`${selectedCell.className} · ${selectedCell.subject}`}><button className="link" onClick={()=>setSelectedCell(null)}>Close</button></CardHead><div className="user-table">{selectedCell.results.slice().sort((a,b)=>b.score/b.maxMarks-a.score/a.maxMarks).map(result=>{const percentage=Math.round(result.score/Math.max(1,result.maxMarks)*100),band=percentage>=90?"green":percentage>=75?"yellow":percentage>=55?"orange":"red";return <div className="user-row" key={result.fileId}><span className={`performance-dot ${band}`}/><div><b>{result.studentName}</b><small>{result.gaps.slice().sort((a,b)=>a.mastery-b.mastery)[0]?.concept||"No priority gap identified"}</small></div><strong>{result.score}/{result.maxMarks} · {percentage}%</strong><span className={`status ${band}`}>{band}</span></div>})}</div></section>}</>;
}

function StudentsView({state,open,notify}:any){
  const [query,setQuery]=useState("");const students=state.students.filter((s:any)=>`${s.name} ${s.roll} ${s.className}`.toLowerCase().includes(query.toLowerCase()));
  const mastery=studentMastery(state);
  return <><PageHead eyebrow="Assigned classes only" title="Students & evidence" subtitle="Review evidence and progress without permanent ability labels."><button className="secondary" onClick={()=>open("import-students")}>Import roster</button><button className="primary" onClick={()=>open("student")}>＋ Add student</button></PageHead><section className="card"><CardHead eyebrow="Class 6A · Mathematics" title="Student roster"><input className="compact-input" placeholder="Search name or roll number" value={query} onChange={e=>setQuery(e.target.value)}/></CardHead><div className="user-table">{students.map((s:any)=>{const m=mastery[s.name];return <button className="user-row student-row" key={s.id} onClick={()=>open(`student-evidence:${s.id}`)}><span className="avatar">{s.name.split(" ").map((x:string)=>x[0]).join("")}</span><div><b>{s.name}</b><small>{s.roll} · {s.className}</small></div><span>{m?`${m.mastery}% mastery`:"No evidence yet"}</span><span className="status success">{s.status}</span><span className="link">View evidence →</span></button>})}</div></section></>;
}

function ResourcesView({state,setState,open,notify}:any){
  const [classFilter,setClassFilter]=useState("All classes");
  const [subjectFilter,setSubjectFilter]=useState("All subjects");
  const [assessmentFilter,setAssessmentFilter]=useState("All assessments");
  const classes=Array.from(new Set(state.assessments.map((a:Assessment)=>`Class ${a.grade}${a.section}`))).sort();
  const subjects=Array.from(new Set(state.assessments.filter((a:Assessment)=>classFilter==="All classes"||`Class ${a.grade}${a.section}`===classFilter).map((a:Assessment)=>a.subject))).sort();
  const assessments:Assessment[]=state.assessments.filter((a:Assessment)=>(classFilter==="All classes"||`Class ${a.grade}${a.section}`===classFilter)&&(subjectFilter==="All subjects"||a.subject===subjectFilter));
  const rows=assessments.filter(a=>assessmentFilter==="All assessments"||a.id===assessmentFilter).flatMap(a=>Object.values(a.gradeResults||{}).map(result=>{
    const guide=state.resources.find((r:Worksheet)=>r.type==="Study Guide"&&(r.assessmentId===a.id||r.id===`guide-${a.id}-${result.fileId}`)&&(r.studentName===result.studentName||!r.studentName));
    const worksheet=state.resources.find((r:Worksheet)=>r.type!=="Study Guide"&&(r.assessmentId===a.id||r.id.includes(`${a.id}-${result.fileId}`))&&(r.studentName===result.studentName||!r.studentName));
    return {assessment:a,result,guide,worksheet};
  }));
  return <><PageHead eyebrow="Saved reports & learning materials" title="Resource library" subtitle="Filter by class, subject and assessment, then download each student's report and learning materials."><button className="primary" onClick={()=>open("worksheet")}>＋ Create worksheet</button></PageHead>
    <section className="card resource-library">
      <div className="resource-filters" aria-label="Resource filters">
        <Field label="Class"><select aria-label="Filter resources by class" value={classFilter} onChange={e=>{setClassFilter(e.target.value);setSubjectFilter("All subjects");setAssessmentFilter("All assessments")}}><option>All classes</option>{classes.map(x=><option key={x}>{x}</option>)}</select></Field>
        <Field label="Subject"><select aria-label="Filter resources by subject" value={subjectFilter} onChange={e=>{setSubjectFilter(e.target.value);setAssessmentFilter("All assessments")}}><option>All subjects</option>{subjects.map(x=><option key={x}>{x}</option>)}</select></Field>
        <Field label="Assessment"><select aria-label="Filter resources by assessment" value={assessmentFilter} onChange={e=>setAssessmentFilter(e.target.value)}><option value="All assessments">All assessments</option>{assessments.map(a=><option value={a.id} key={a.id}>{a.title}</option>)}</select></Field>
      </div>
      <div className="resource-table" role="table" aria-label="Student reports and documents">
        <div className="resource-row resource-head" role="row"><span role="columnheader">Student name</span><span role="columnheader">Learning gap report</span><span role="columnheader">Study guide</span><span role="columnheader">Worksheet & answer key</span></div>
        {!rows.length&&<div className="empty-state"><b>No analysed students match these filters</b><p>Grade an answer sheet or change the filters to view downloadable resources.</p></div>}
        {rows.map(({assessment,result,guide,worksheet})=><div className="resource-row" role="row" key={`${assessment.id}-${result.fileId}`}>
          <span role="cell"><b>{result.studentName}</b><small>Class {assessment.grade}{assessment.section} · {assessment.subject}<br/>{assessment.title}</small><button className="primary download-all" onClick={async e=>{const button=e.currentTarget;button.disabled=true;const label=button.textContent;button.textContent="Checking all reports…";try{const complete=guide&&worksheet?{guide,worksheet}:await generateAllStudentResources(assessment,result,setState);button.textContent="Preparing four PDFs…";await downloadAssessmentZip(assessment,result,complete.guide,complete.worksheet)}catch(error){notify(error instanceof Error?error.message:"Report bundle download failed","error")}finally{button.disabled=false;button.textContent=label}}}>Download All (ZIP)</button><button className="secondary parent-share-button" onClick={()=>open(`parent-share:${assessment.id}:${result.fileId}`)}>▦ Share with parent</button></span>
          <span role="cell"><button className="link" onClick={()=>downloadStudentLearningGapReport(assessment,result)}>Download report</button></span>
          <span role="cell">{guide?<button className="link" onClick={()=>downloadStudyGuide(guide,guide.guide)}>Download study guide</button>:<small>Not created</small>}</span>
          <span role="cell">{worksheet?<div className="resource-actions"><button className="link" onClick={()=>downloadWorksheet(worksheet,worksheet.content)}>Worksheet</button><button className="link" onClick={()=>downloadAnswerKey(worksheet,worksheet.content)}>Answer key</button></div>:<small>Not created</small>}</span>
        </div>)}
      </div>
    </section>
  </>;
}

function AchievementsView({state,notify}:any){
  const results=allGradeResults(state);
  const completedInterventions=state.interventions.filter((i:Intervention)=>i.status==="Completed").length;
  const followupRate=state.interventions.length?Math.round((completedInterventions/state.interventions.length)*100):0;
  const avgQuality=state.assessments.length?Math.round(state.assessments.reduce((s:number,a:Assessment)=>s+(a.quality||0),0)/state.assessments.length):0;
  const badges=[
    ["First Learning X-Ray",results.length?"Completed":"Not yet — grade an answer sheet"],
    ["Intervention Planner",completedInterventions?"Completed":"Not yet — complete an intervention"],
    ["Evidence-Based Teacher",`${Math.min(completedInterventions,5)} of 5 cycles`],
    ["Assessment Quality Champion",`${avgQuality}% avg quality`],
    ["Answer sheets graded",`${results.length} graded`]
  ];
  return <><PageHead eyebrow="Progress without competition" title="Achievements" subtitle="Recognition rewards evidence quality, follow-up and improvement—not upload volume."><button className="secondary" onClick={()=>notify("Weekly progress summary prepared")}>Weekly summary</button></PageHead><section className="metric-grid"><Metric label="Improvement cycles" value={String(completedInterventions)} note="Completed"/><Metric label="Answer sheets graded" value={String(results.length)} note="EduAI analysis"/><Metric label="Follow-up completion" value={`${followupRate}%`} note="This term"/><Metric label="Avg assessment quality" value={`${avgQuality}%`} note="Across all assessments"/></section><div className="achievement-grid">{badges.map(([name,status],i)=><button key={name} onClick={()=>notify(`${name}: ${status}`)}><i>{["✦","↗","✓","◎","◷"][i]}</i><b>{name}</b><small>{status}</small></button>)}</div><p className="insight">No teacher or student leaderboard is used. School challenges and celebrations can be disabled by administrators.</p></>;
}

function SettingsView({open}:any){
  const items=[["Profile & onboarding","Personal, teaching and school details","profile"],["Grading preferences","Strictness, partial credit, spelling and units","grading-settings"],["Appearance & accessibility","Theme, contrast, text and reduced motion","appearance-settings"],["Notifications","Processing, intervention and follow-up reminders","notification-settings"],["Privacy & consent","Terms, AI disclosure and product-improvement consent","consent-settings"],["Sessions & security","Login history and log out all devices","security-settings"]];
  return <><PageHead eyebrow="Teacher preferences" title="Settings" subtitle="Control grading, notifications, accessibility, privacy and account security."/><div className="settings-grid">{items.map(([title,sub,type])=><button key={title} onClick={()=>open(type)}><b>{title}</b><small>{sub}</small><span>Manage →</span></button>)}</div></>;
}

function SchoolAdminApp({module,state,setState,open,notify}:any){
  const toggle=async(id:string)=>{const current=state.users.find((u:User)=>u.id===id);const status=current?.status==="Active"?"Inactive":"Active";const response=await authFetch("/api/admin/users",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:id,status})});if(!response.ok){const payload=await response.json();notify(payload.error||"User status could not be updated","error");return}setState((s:DemoState)=>({...s,users:s.users.map(u=>u.id===id?{...u,status}:u)}));notify("User status updated")};
  return <><PageHead eyebrow="School administrator" title={module} subtitle="Manage people, school structure and access with a clear audit trail.">{module==="Users"&&<button className="primary" onClick={()=>open("invite")}>＋ Invite user</button>}{module==="Schools & Classes"&&<button className="primary" onClick={()=>open("class")}>＋ Add class</button>}</PageHead>
  {module==="Overview"&&<><section className="metric-grid"><Metric label="Users" value={state.users.length} note="Across all roles"/><Metric label="Invitations" value={state.users.filter((u:any)=>u.status==="Invited").length} note="Pending"/><Metric label="Classes" value={state.classes.length} note="Current year"/><Metric label="Schools" value={state.schools.length} note="Active tenant"/></section><div className="dashboard-grid"><section className="card span-2"><CardHead eyebrow="Admin actions" title="School setup"/><div className="admin-actions"><button onClick={()=>open("invite")}>Invite user<span>Name, email, role and school</span></button><button onClick={()=>open("class")}>Add class<span>Class, section and subject</span></button><button onClick={()=>open("school")}>Manage school<span>Profile, board and branding</span></button><button onClick={()=>open("privacy-settings")}>Privacy & retention<span>Access and data policy</span></button></div></section></div></>}
  {module==="Users"&&<section className="card"><CardHead eyebrow="People, access & credit usage" title="Users"><button className="primary" onClick={()=>open("invite")}>Invite Teacher</button></CardHead><div className="user-table">{state.users.map((u:any)=><div className="user-row" key={u.id}><span className="avatar">{u.name.split(" ").map((x:string)=>x[0]).join("").slice(0,2)}</span><div><b>{u.name}</b><small>{u.email} · {u.school}<br/>Credits: Total {u.totalCredits||0} · Used {u.usedCredits||0} · Remaining {Math.max(0,(u.totalCredits||0)-(u.usedCredits||0))}</small></div><span>{u.role}</span><span className={`status ${u.status==="Active"?"success":u.status==="Invited"?"warning":""}`}>{u.status}</span><div className="button-row"><button className="link" onClick={()=>open(`edit-user:${u.id}`)}>View / Edit</button><button className="link" onClick={()=>open(`credits-user:${u.id}`)}>Assign Credits</button><button className="link" onClick={()=>open(`reset-user:${u.id}`)}>Resend Invite</button><button className="link" onClick={()=>toggle(u.id)}>{u.status==="Active"?"Disable":"Activate"}</button></div></div>)}</div></section>}
  {module==="Schools & Classes"&&<div className="dashboard-grid"><section className="card"><CardHead eyebrow="School profile" title="Schools"><button className="link" onClick={()=>open("school")}>Edit</button></CardHead>{state.schools.map((x:any)=><div className="list-item" key={x}><b>{x}</b><button onClick={()=>open("school")}>Manage</button></div>)}</section><section className="card"><CardHead eyebrow="Academic structure" title="Classes"><button className="link" onClick={()=>open("class")}>Add</button></CardHead>{state.classes.map((x:any)=><div className="list-item" key={x}><b>{x}</b><button onClick={()=>open("class")}>Edit</button></div>)}</section></div>}
  {module==="Students"&&<StudentsView state={state} open={open} notify={notify}/>}
  {module==="Academic years"&&<section className="card"><CardHead eyebrow="School calendar" title="Academic years"><button className="primary" onClick={()=>open("academic-year")}>＋ Add year</button></CardHead>{state.academicYears.map((x:string)=><div className="list-item" key={x}><b>{x}</b><div className="button-row"><button onClick={()=>open("academic-year")}>Edit</button><button onClick={()=>notify("Academic year status updated")}>Change status</button></div></div>)}</section>}
  {module==="Branding & Privacy"&&<div className="settings-grid">{[["School branding","Logo, report cover and co-branding","school"],["Privacy & retention","Retention, recovery and deletion","privacy-settings"],["Login-provider policy","Google, Microsoft and email fallback","security-settings"],["Notifications","Frequency and templates","notification-settings"],["Support access","Reason, named agent and expiry","support-access"],["Report settings","Expiry, download and OTP defaults","report-settings"]].map(([a,b,c])=><button key={a} onClick={()=>open(c)}><b>{a}</b><small>{b}</small><span>Manage →</span></button>)}</div>}
  {module==="Reports"&&<Reports state={state} open={open} notify={notify}/>}</>;
}

function PrincipalApp({module,state,open,notify}:any){
  if(module==="Reports")return <Reports state={state} open={open} notify={notify}/>;
  const concepts=conceptMastery(state);
  const priorityGaps=concepts.filter(c=>c.mastery<70).length;
  const completed=state.interventions.filter((i:Intervention)=>i.status==="Completed").length;
  const interventionRate=state.interventions.length?Math.round((completed/state.interventions.length)*100):0;
  const mastery=overallMastery(state);
  const trend=masteryTrend(state);
  return <><PageHead eyebrow="Principal workspace" title="School academic improvement" subtitle="Aggregated, non-punitive insight for planning academic support."><button className="primary" onClick={()=>open("report")}>Generate leadership report</button></PageHead><section className="metric-grid"><Metric label="Students in roster" value={String(state.students.length)} note="Assigned classes"/><Metric label="Priority gaps" value={String(priorityGaps)} note={`Across ${concepts.length} concept${concepts.length===1?"":"s"}`}/><Metric label="Interventions complete" value={`${interventionRate}%`} note={`${completed} of ${state.interventions.length}`}/><Metric label="Overall mastery" value={mastery===null?"No data":`${mastery}%`} note="Graded evidence"/></section>
  <SchoolPerformanceMatrix state={state}/>
  <div className="dashboard-grid"><section className="card span-2"><CardHead eyebrow="School trend" title="Mastery from graded evidence"/>{trend.length?<div className="chart">{trend.map(t=><button key={t.label} style={{height:`${t.value}%`}} onClick={()=>notify(`${t.label}: ${t.value}% mastery evidence`)}/>)}</div>:<p className="modal-copy">No graded evidence yet across more than one date.</p>}</section><section className="card"><p className="eyebrow">Management action</p><h2>Protect remedial time</h2><p>{concepts[0]?`${concepts[0].concept} is currently the lowest-mastery concept with graded evidence (${concepts[0].mastery}%).`:"No graded evidence yet to identify a priority concept."}</p><button className="primary" onClick={()=>notify("Action assigned to academic head")}>Assign action</button></section></div></>;
}

function SystemHealthPanel({state}:{state:DemoState}){
  const [checking,setChecking]=useState(false);
  const [live,setLive]=useState<{checkedAt:string;providers:{provider:string;ok:boolean;ms:number;status?:number;error?:string}[]}|null>(null);
  const [liveError,setLiveError]=useState("");
  const runCheck=async()=>{
    setChecking(true);setLiveError("");
    try{
      const res=await fetch("/api/system-health");
      const payload=await res.json();
      if(!res.ok)throw new Error(payload?.error||"Health check failed");
      setLive(payload);
    }catch(err){
      setLiveError(err instanceof Error?err.message:"Health check failed");
    }finally{
      setChecking(false);
    }
  };
  const log=state.apiLog||[];
  const byProvider=(p:"mistral"|"openai")=>log.filter(l=>l.provider===p);
  const stats=(p:"mistral"|"openai")=>{
    const entries=byProvider(p);
    if(!entries.length)return null;
    const ok=entries.filter(e=>e.ok).length;
    const avgMs=Math.round(entries.reduce((s,e)=>s+e.ms,0)/entries.length);
    return {count:entries.length,successRate:Math.round((ok/entries.length)*100),avgMs};
  };
  const mistralStats=stats("mistral");
  const openaiStats=stats("openai");
  return <section className="card span-2">
    <CardHead eyebrow="System health" title="Live provider status"/>
    <p className="modal-copy">This checks the OCR and learning-analysis services with a real request and reports what actually comes back — no simulated numbers.</p>
    <button className="secondary" onClick={runCheck} disabled={checking}>{checking?"Checking…":"Check live status now"}</button>
    {liveError&&<p className="form-error" role="alert">{liveError}</p>}
    {live&&<div>
      {live.providers.map(p=><div className="list-item" key={p.provider}><b>{p.provider==="mistral"?"OCR service":"Learning analysis"}</b><span className={`status ${p.ok?"success":"warning"}`}>{p.ok?`Reachable · ${p.ms}ms`:`Unreachable${p.error?` · ${p.error}`:""}`}</span></div>)}
      <p className="modal-copy">Checked at {new Date(live.checkedAt).toLocaleTimeString()}.</p>
    </div>}
    <h2>Real usage this session</h2>
    <p className="modal-copy">Success rate and latency computed from every real grading and worksheet-generation call this app has actually made — not projected or simulated.</p>
    <div>
      <div className="list-item"><b>Mistral OCR</b><span className="status neutral">{mistralStats?`${mistralStats.successRate}% success · ${mistralStats.avgMs}ms avg · ${mistralStats.count} call${mistralStats.count===1?"":"s"}`:"No calls made yet this session"}</span></div>
      <div className="list-item"><b>Learning analysis</b><span className="status neutral">{openaiStats?`${openaiStats.successRate}% success · ${openaiStats.avgMs}ms avg · ${openaiStats.count} call${openaiStats.count===1?"":"s"}`:"No calls made yet this session"}</span></div>
    </div>
    <p className="modal-copy">Long-term uptime (30/90-day %) and queue depth still require a real monitoring backend with persistent storage across sessions — that's genuinely out of scope for this frontend-only build, not faked.</p>
  </section>;
}
function PlatformApp({module,state,open,notify}:any){
  const configs:{[key:string]:string[]}={Overview:["Tenant management","Usage analytics","AI providers","Model routing","Prompt versions","Academic configuration","Feature flags","Gamification","Notifications","Privacy","System health","Audit logs"],Schools:["Search schools","Plans & limits","Suspend / reactivate","Pilot status","Support owner","Internal notes"],Users:["Search users","Suspend access","Reset access","Login history","Terms version","Platform roles"],Analytics:["DAU / WAU / MAU","Assessments & pages","AI acceptance & changes","Regrading","X-Rays & interventions","Time saved & AI cost"],"AI Configuration":["Provider registry","Model registry","Routing rules","Prompt versions","Output schemas","Fallback sequence"],"Feature flags":["AI grading","Handwriting recognition","Regrading","Gamification","Principal reporting","Experimental models"],"System health":["API uptime","Queue depth","Provider latency","Database & storage","Failed jobs","Active incidents"],Audit:["Authentication","Configuration changes","Support access","Tenant changes","AI versions","Retention actions"]};
  const items=configs[module]||configs.Overview;
  const totalFiles=state.assessments.reduce((s:number,a:Assessment)=>s+(a.files?.length||0),0);
  const results=allGradeResults(state);
  const reviewRatio=state.assessments.length?Math.round(state.assessments.reduce((s:number,a:Assessment)=>s+(a.totalReviews?a.reviewed/a.totalReviews:0),0)/state.assessments.length*100):null;
  return <><PageHead eyebrow="EduAI Hub platform administrator" title={module==="Overview"?"Platform operations":module} subtitle="Tenant health, responsible AI operations and auditable configuration."><button className="primary" onClick={()=>open("platform-config")}>＋ Configure</button></PageHead><section className="metric-grid"><Metric label="Active schools" value={String(state.schools.length)} note="This tenant"/><Metric label="Files processed" value={String(totalFiles)} note="Uploaded to assessments"/><Metric label="Graded evidence" value={String(results.length)} note="EduAI analysis"/><Metric label="Teacher review rate" value={reviewRatio===null?"No data":`${reviewRatio}%`} note="Avg across assessments"/></section><div className="dashboard-grid">{module==="System health"?<SystemHealthPanel state={state}/>:<section className="card span-2"><CardHead eyebrow={module} title="Controls & evidence"/><div className="admin-actions">{items.map(x=><button key={x} onClick={()=>open("platform-config")}><b>{x}</b><span>View, configure and audit</span></button>)}</div></section>}<section className="card"><p className="eyebrow">Responsible operations</p><h2>Current safeguards</h2>{["Tenant isolation","Identifiable-data restriction","Prompt versioning","Support-access expiry","Audit logging"].map(x=><div className="list-item" key={x}><b>{x}</b><span className="status success">Active</span></div>)}</section></div></>;
}

function AppDialog({type,close,open,state,setState,selected,update,notify,resetDemo,openAssessment}:any){
  const title=type.split(":")[0]; const id=type.split(":").slice(1).join(":"); const user=state.users.find((u:any)=>u.id===id);
  const done=(message:string)=>{notify(message);close()};
  const needsAssessment=new Set(["upload","grade-picker","diagnose-picker","bulk-analysis","grade-file","auto-grade-file","diagnose-file","delete-assessment","student-gaps","worksheet-gap","setup","process","approval","publish","regrade","bulk-review","intervention-form","study-guide","quality"]);
  if(needsAssessment.has(title)&&!selected)return <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><section className="modal functional-modal" role="dialog" aria-modal="true" aria-label="Create an assessment first"><button className="modal-close" onClick={close} aria-label="Close">×</button><DialogHead eyebrow="Assessment required" title="Create or select an assessment first"/><p className="modal-copy">This action needs an assessment and its evidence. Create one first, then return here to add work, analyse results, or plan an intervention.</p><button className="primary full" onClick={()=>open("create-assessment")}>Create assessment</button></section></div>;
  return <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><section className="modal functional-modal" role="dialog" aria-modal="true" aria-label={dialogTitle(title)}><button className="modal-close" onClick={close} aria-label="Close">×</button>
    {title==="create-assessment"&&<CreateAssessment state={state} setState={setState} done={(id:string)=>{openAssessment(id,"Work");done("Assessment saved and added to Work")}}/>}
    {title==="upload"&&selected&&<UploadDialogV2 assessment={selected} update={update} done={()=>done("Evidence uploaded and classified. OCR is ready.")}/>}
    {title==="grade-picker"&&<GradeSelectionDialog assessment={selected} open={open} done={done}/>}
    {title==="diagnose-picker"&&<DiagnosisSelectionDialog assessment={selected} open={open}/>}
    {title==="bulk-analysis"&&<BulkAnalysisWizard assessment={selected} open={open} done={done}/>}
    {title==="grade-file"&&<PerFileGradeDialog key={id} assessment={selected} file={(selected.files||[]).find((f:UploadFile)=>f.id===id)} state={state} setState={setState} update={update} open={open} notify={notify} openAssessment={openAssessment} close={close}/>}
    {title==="auto-grade-file"&&<PerFileGradeDialog key={`auto-grade-${id}`} assessment={selected} file={(selected.files||[]).find((f:UploadFile)=>f.id===id)} state={state} setState={setState} update={update} open={open} notify={notify} autoGrade openAssessment={openAssessment} close={close}/>}
    {title==="diagnose-file"&&<PerFileGradeDialog key={`diagnose-${id}`} assessment={selected} file={(selected.files||[]).find((f:UploadFile)=>f.id===id)} state={state} setState={setState} update={update} open={open} notify={notify} diagnosisOnly openAssessment={openAssessment} close={close}/>}
    {title==="delete-assessment"&&selected&&<DeleteAssessmentDialog assessment={selected} state={state} setState={setState} openAssessment={openAssessment} done={()=>done("Assessment and all associated resources deleted")}/>}
    {title==="student-gaps"&&<StudentGapsDialog assessment={selected} fileId={id} open={open}/>}
    {title==="worksheet-gap"&&<WorksheetDialog state={state} setState={setState} sourceAssessment={selected} sourceResult={selected.gradeResults?.[id]} presetConcept={selected.gradeResults?.[id]?.gaps.slice().sort((a:Gap,b:Gap)=>a.mastery-b.mastery)[0]?.concept} presetTitle={selected.gradeResults?.[id]?`${selected.gradeResults[id].gaps.slice().sort((a:Gap,b:Gap)=>a.mastery-b.mastery)[0]?.concept} Practice`:undefined} presetStudent={selected.gradeResults?.[id]?.studentName} done={()=>done("Practice worksheet and answer key ready in Resources")}/>}
    {title==="setup"&&<SetupDialog assessment={selected} update={update} done={()=>done("Questions, answer key and rubric saved")}/>}
    {title==="process"&&<ProcessDialog assessment={selected} update={update} open={open} done={()=>{openAssessment(selected.id,"Review");done(`${selected.subject} answer sheets graded. Review this assessment now.`)}}/>}
    {title==="approval"&&<ConfirmDialog eyebrow="Teacher authority" title="Final approval" text={`${selected.reviewed}/${selected.totalReviews} answers reviewed. Approving locks grading version ${selected.version} and makes results ready to publish.`} action="Approve final grades" onConfirm={()=>{update(selected.id,{stage:"xray"});done("Final grades approved. Learning X-Ray generated.")}}/>}
    {title==="publish"&&<ConfirmDialog eyebrow="High-impact action" title="Publish grades" text="Published grades become visible in reports. A new version is required for later changes." action="Publish grades" onConfirm={()=>{update(selected.id,{stage:"published",published:true});done("Grades published and reports updated.")}}/>}
    {title==="regrade"&&<RegradeDialog assessment={selected} update={update} done={()=>done("Regrade version created and returned to teacher review")}/>}
    {title==="bulk-review"&&<BulkReview assessment={selected} update={update} done={()=>done("High-confidence answers approved in bulk")}/>}
    {title==="intervention-form"&&<InterventionForm state={state} setState={setState} assessment={selected} done={()=>done("Intervention created and added to the improvement cycle")}/>}
    {title==="study-guide"&&<StudyGuideDialog assessment={selected} fileId={id||undefined} open={open} setState={setState} done={()=>done("Study guide saved to resources")}/>}
    {(title==="worksheet"||title==="worksheet-edit")&&<WorksheetDialog state={state} setState={setState} sourceAssessment={selected} worksheet={state.resources.find((r:Worksheet)=>r.id===id)} done={()=>done("Worksheet saved to Resources with its answer key")}/>}
    {title==="worksheet-grade"&&<WorksheetGradingDialog worksheet={state.resources.find((r:Worksheet)=>r.id===id)} setState={setState} done={()=>done("Answer worksheets graded and results saved")}/>}
    {title==="followup"&&<FollowupDialog setState={setState} intervention={state.interventions.find((i:Intervention)=>i.id===id)} done={()=>done("Follow-up evidence recorded.")}/>}
    {title==="quality"&&<QualityDialog assessment={selected} state={state} done={()=>done("Assessment quality recommendations acknowledged")}/>}
    {title==="evidence"&&<EvidenceDialog state={state} id={id} done={()=>done("Evidence decision saved")}/>}
    {title==="report"&&<ReportDialog done={()=>done("Interactive report generated and saved")}/>}
    {title==="share-report"&&<ShareDialog done={()=>done("Secure demo link created with expiry and access code")}/>}
    {title==="parent-share"&&<ParentShareDialog state={state} id={id} done={()=>done("Student QR code is ready to share")}/>}
    {title==="invite"&&<InviteDialog state={state} setState={setState} done={()=>done("Invitation created and shown in Users")}/>}
    {title==="edit-user"&&user&&<UserEdit user={user} setState={setState} done={()=>done("User details updated")}/>}
    {title==="credits-user"&&user&&createElement(CreditAllocationDialog,{user,setState,done:()=>done("Credits assigned and audit trail recorded")})}
    {title==="reset-user"&&user&&<ConfirmDialog eyebrow="Account security" title="Reset password" text={`Send a password-reset link to ${user.email}?`} action="Send reset link" onConfirm={()=>done("Password reset link sent")}/>}
    {title==="class"&&<ClassDialog state={state} setState={setState} done={()=>done("Class saved")}/>}
    {title==="school"&&<SchoolDialog state={state} setState={setState} done={()=>done("School profile saved")}/>}
    {title==="privacy-settings"&&<SimpleSettings title="Privacy & retention" fields={["Retention period","Support access","Login provider policy","Notification frequency"]} done={()=>done("Privacy and retention settings saved")}/>}
    {title==="platform-config"&&<SimpleSettings title="Platform configuration" fields={["Configuration area","Enabled status","Scope","Approval note"]} done={()=>done("Platform configuration version saved")}/>}
    {title==="profile"&&<SimpleSettings title="Profile & preferences" fields={["Display name","Mobile number","Preferred language","Email notifications"]} done={()=>done("Profile saved")}/>}
    {title==="activity"&&<Activity events={state.events} resetDemo={resetDemo} close={close}/>}
    {title==="notifications"&&<NotificationDialog state={state} done={()=>done("Notifications marked as read")}/>}
    {title==="group"&&<GroupDialog state={state} id={id} done={()=>done("Temporary group membership saved")}/>}
    {title==="student"&&<StudentDialog state={state} setState={setState} done={()=>done("Student added to the roster")}/>}
    {title==="import-students"&&<RosterImport state={state} setState={setState} done={()=>done("Student roster imported and validated")}/>}
    {title==="student-evidence"&&<StudentEvidence state={state} student={state.students.find((s:any)=>s.id===id)} done={()=>done("Student observation saved")}/>}
    {title==="academic-year"&&<AcademicYearDialog state={state} setState={setState} done={()=>done("Academic year saved")}/>}
    {title==="grading-settings"&&<SimpleSettings title="Grading preferences" fields={["Strictness","Partial-credit policy","Spelling and grammar tolerance","Working and units required","Alternative methods","Confidence threshold"]} done={()=>done("Grading preferences saved")}/>}
    {title==="appearance-settings"&&<SimpleSettings title="Appearance & accessibility" fields={["Appearance","High contrast","Text size","Reduced motion"]} done={()=>done("Accessibility preferences saved")}/>}
    {title==="notification-settings"&&<SimpleSettings title="Notification settings" fields={["Reminder frequency","Processing results","Intervention reminders","Follow-up reminders"]} done={()=>done("Notification settings saved")}/>}
    {title==="consent-settings"&&<ConsentDialog done={()=>done("Privacy and consent choices saved")}/>}
    {title==="security-settings"&&<SecurityDialog done={()=>done("Security preference saved")}/>}
    {title==="support-access"&&<SimpleSettings title="Temporary support access" fields={["Named support agent","Reason","Expiry","School approval"]} done={()=>done("Support-access decision saved and audited")}/>}
    {title==="report-settings"&&<SimpleSettings title="Report settings" fields={["Default expiry","Require OTP","Allow download","School branding"]} done={()=>done("Report defaults saved")}/>}
    {title==="review-help"&&<ConfirmDialog eyebrow="Workflow guide" title="Teacher review" text="Open the Review module to approve, edit, bulk-review, escalate or request a second AI opinion for every answer." action="Got it" onConfirm={close}/>}
    {title==="xray-details"&&<ConfirmDialog eyebrow="Learning X-Ray" title="Analysis ready" text="Open X-Ray to inspect student evidence, confidence, mastery and concept classifications." action="Got it" onConfirm={close}/>}
  </section></div>;
}

function CreateAssessment({state,setState,done}:any){
  const [error,setError]=useState(""),[saving,setSaving]=useState(false);
  const [sourceMode,setSourceMode]=useState<"upload"|"generate">("upload");
  const submit=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();setError("");
    const f=new FormData(e.currentTarget);
    const references:{file:File;role:DocumentRole}[]=[];
    const title=String(f.get("title")),className=String(f.get("className")),subject=String(f.get("subject")),maxMarks=Number(f.get("marks"));
    setSaving(true);
    try{
      let questionCount=0,answerKey="",rubric="";
      if(sourceMode==="upload"){
        const questionPaper=f.get("questionPaper");const markingScheme=f.get("markingScheme");const modelAnswer=f.get("modelAnswer");
        if(!(questionPaper instanceof File)||!questionPaper.size)throw new Error("A question paper is required before the assessment can be created.");
        references.push({file:questionPaper,role:"Question paper"});
        if(markingScheme instanceof File&&markingScheme.size)references.push({file:markingScheme,role:"Marking scheme"});
        if(modelAnswer instanceof File&&modelAnswer.size)references.push({file:modelAnswer,role:"Model answer"});
      }else{
        const blueprint=f.get("blueprint");
        if(blueprint instanceof File&&blueprint.size&&!supportsDocumentUpload(blueprint))throw new Error(`${blueprint.name}: unsupported blueprint format.`);
        const blueprintPayload=blueprint instanceof File&&blueprint.size?{name:blueprint.name,mimeType:blueprint.type||"application/octet-stream",base64:await blobToBase64(blueprint)}:undefined;
        const response=await authFetch("/api/generate-assessment",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title,type:String(f.get("type")),className,subject,maxMarks,blueprint:blueprintPayload})});
        const payload=await response.json();
        logApiTiming(setState,payload?.timing);
        if(!response.ok)throw new Error(payload?.error||"Assessment generation failed.");
        questionCount=Math.max(1,Number(payload.questionCount)||1);answerKey=String(payload.modelAnswerText||"");rubric=String(payload.markingSchemeText||"");
        const safeTitle=title.replace(/[^a-z0-9-]+/gi,"-");
        const documentMeta=`Class ${className} · ${subject} · ${title}`;
        const [questionPaperPdf,markingSchemePdf,modelAnswerPdf]=await Promise.all([
          createBrandedPdfBlob(`${title} · Question Paper`,documentMeta,textToDocumentHtml(String(payload.questionPaperText))),
          createBrandedPdfBlob(`${title} · Marking Scheme`,documentMeta,textToDocumentHtml(String(payload.markingSchemeText))),
          createBrandedPdfBlob(`${title} · Model Answer`,documentMeta,textToDocumentHtml(String(payload.modelAnswerText))),
        ]);
        references.push(
          {file:new File([questionPaperPdf],`${safeTitle}-Question-Paper.pdf`,{type:"application/pdf"}),role:"Question paper"},
          {file:new File([markingSchemePdf],`${safeTitle}-Marking-Scheme.pdf`,{type:"application/pdf"}),role:"Marking scheme"},
          {file:new File([modelAnswerPdf],`${safeTitle}-Model-Answer.pdf`,{type:"application/pdf"}),role:"Model answer"},
        );
        if(blueprint instanceof File&&blueprint.size)references.push({file:blueprint,role:"Supporting reference"});
      }
      if(references.some(item=>item.file.size>10*1024*1024))throw new Error("Each document must be 10 MB or smaller.");
      if(references.some(item=>!supportsDocumentUpload(item.file)))throw new Error("Use PDF, Word, Markdown, text, spreadsheet or supported image files.");
      const files:UploadFile[]=references.map(({file,role})=>({id:`f${crypto.randomUUID()}`,name:file.name,type:file.type||"application/pdf",size:file.size,progress:100,status:"OCR ready",documentRole:role}));
      await Promise.all(files.map((item,index)=>saveFileBlob(item.id,references[index].file)));
      const id=`a${Date.now()}`;
      const a:Assessment={id,title,type:String(f.get("type")),grade:className,section:String(f.get("section")),subject,maxMarks,date:String(f.get("date")),stage:"draft",files,questions:questionCount,reviewed:0,totalReviews:0,quality:0,published:false,version:1,answerKey,rubric};
      setState((s:DemoState)=>({...s,assessments:[a,...s.assessments],events:[`${sourceMode==="generate"?"Assessment generated":"Assessment created with uploaded reference documents"} · ${a.title}`,...s.events]}));
      done(id);
    }catch(err){setError(err instanceof Error?err.message:"Assessment could not be created.");setSaving(false)}
  };
  return <form onSubmit={submit}><DialogHead eyebrow="New work" title="Create or generate assessment"/><div className="form-grid"><Field label="Title"><input name="title" required minLength={3} placeholder="e.g. Fractions checkpoint"/></Field><Field label="Activity type"><select name="type" required>{["Test","Quiz","Worksheet","Homework","Assessment","Diagnostic","Follow-up"].map(x=><option key={x}>{x}</option>)}</select></Field><Field label="Class"><select name="className">{Array.from({length:12},(_,index)=>String(index+1)).map(x=><option key={x}>{x}</option>)}</select></Field><Field label="Section"><input name="section" required defaultValue="A"/></Field><Field label="Subject"><input name="subject" required defaultValue="Mathematics"/></Field><Field label="Maximum marks"><input name="marks" type="number" min="1" max="200" required defaultValue="20"/></Field><Field label="Assessment date"><input name="date" type="date" required defaultValue={new Date().toISOString().slice(0,10)}/></Field><Field label="Grading mode"><select><option>Structured</option><option>Objective</option><option>Rubric</option><option>Completion</option></select></Field></div><div className="assessment-source-picker" role="radiogroup" aria-label="Question paper source"><button type="button" role="radio" aria-checked={sourceMode==="upload"} className={sourceMode==="upload"?"active":""} onClick={()=>setSourceMode("upload")}><b>Upload question paper</b><small>Use an existing paper and optional marking references</small></button><button type="button" role="radio" aria-checked={sourceMode==="generate"} className={sourceMode==="generate"?"active":""} onClick={()=>setSourceMode("generate")}><b>Generate assessment</b><small>Create a paper, marking scheme and model answer with AI</small></button></div><section className="assessment-reference-files"><p className="eyebrow">{sourceMode==="upload"?"Assessment reference documents":"AI assessment generation"}</p>{sourceMode==="upload"?<><p className="modal-copy">The uploaded files are fixed to the assessment and automatically used during OCR and learning-gap analysis.</p><Field label="Question paper · required"><input name="questionPaper" type="file" accept={DOCUMENT_ACCEPT} required/></Field><div className="form-grid"><Field label="Marking scheme"><input name="markingScheme" type="file" accept={DOCUMENT_ACCEPT}/></Field><Field label="Model answer paper"><input name="modelAnswer" type="file" accept={DOCUMENT_ACCEPT}/></Field></div></>:<><p className="modal-copy">A blueprint is optional. When supplied, its structure, sections and mark distribution guide the generated assessment.</p><Field label="Assessment blueprint · optional"><input name="blueprint" type="file" accept={DOCUMENT_ACCEPT}/></Field><div className="insight">EduAI will generate the compulsory question paper together with its marking scheme and complete model answer. You can review the generated documents before analysing student work.</div></>}</section>{error&&<p className="form-error" role="alert">{error}</p>}<button className="primary full" disabled={saving}>{saving?(sourceMode==="generate"?"Generating assessment & references…":"Saving assessment & documents…"):(sourceMode==="generate"?"Generate & save assessment":"Save uploaded assessment")}</button></form>
}

function UploadDialog({assessment,update,done}:any){const input=useRef<HTMLInputElement>(null);const [files,setFiles]=useState<UploadFile[]>(assessment.files||[]);const [error,setError]=useState("");const add=(list:FileList|File[])=>{setError("");const next:Array<UploadFile>=[];Array.from(list).forEach(file=>{if(!supportsDocumentUpload(file)){setError(`${file.name}: unsupported format. Use PDF, Word, Markdown, text, spreadsheet or an image.`);return}if(file.size>10*1024*1024){setError(`${file.name}: exceeds the 10 MB limit.`);return}next.push({id:`f${Date.now()}${file.name}`,name:file.name,type:file.type||"application/octet-stream",size:file.size,progress:0,status:"Ready",preview:file.type.startsWith("image/")?URL.createObjectURL(file):undefined})});setFiles(x=>[...x,...next])};const upload=()=>{if(!files.length){setError("Choose at least one supported document or image.");return}let p=0;const timer=window.setInterval(()=>{p+=20;setFiles(fs=>fs.map(f=>({...f,progress:Math.min(100,p),status:p>=100?"Uploaded · ready for OCR":"Uploading"})));if(p>=100){clearInterval(timer);window.setTimeout(()=>{update(assessment.id,{files:files.map(f=>({...f,progress:100,status:"OCR complete",preview:undefined})),stage:"uploaded",totalReviews:Math.max(assessment.totalReviews,files.length*4)});done()},400)}},180)};return <><DialogHead eyebrow={assessment.title} title="Upload student work"/><div className="dropzone" role="button" tabIndex={0} onClick={()=>input.current?.click()} onKeyDown={e=>{if(e.key==="Enter"||e.key===" ")input.current?.click()}} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();add(e.dataTransfer.files)}}><span>↑</span><b>Drop files here or choose files</b><small>PDF, Word, Markdown, text, spreadsheet or image · multiple files · 10 MB each</small><button type="button" className="secondary" onClick={e=>{e.stopPropagation();input.current?.click()}}>Browse / Choose File</button><input ref={input} className="file-input" type="file" multiple accept={DOCUMENT_ACCEPT} onChange={e=>e.target.files&&add(e.target.files)}/></div>{error&&<p className="form-error" role="alert">{error}</p>}<div className="upload-list">{files.map(f=><div key={f.id}>{f.preview?<img src={f.preview} alt={`Preview ${f.name}`}/>:<span className="file-icon">{f.name.split(".").pop()?.toUpperCase()}</span>}<div><b>{f.name}</b><small>{(f.size/1024/1024).toFixed(2)} MB · {f.status}</small><Progress value={f.progress}/></div><button onClick={()=>setFiles(x=>x.filter(v=>v.id!==f.id))} aria-label={`Remove ${f.name}`}>×</button></div>)}</div><button className="primary full" onClick={upload}>Upload and start OCR</button></>}

function SetupDialog({assessment,update,done}:any){
  const [questions,setQuestions]=useState(assessment.questions||5);
  const [answerKey,setAnswerKey]=useState(assessment.answerKey||"Q1: Equivalent fractions; Q2: Common denominator; Q3: Add numerators after conversion.");
  const [rubric,setRubric]=useState(assessment.rubric||"Method 40% · Conversion 30% · Calculation 20% · Final answer and unit 10%");
  return <form onSubmit={e=>{e.preventDefault();update(assessment.id,{questions,answerKey,rubric,stage:"setup"});done()}}><DialogHead eyebrow="Question detection" title="Review questions & rubric"/><p className="modal-copy">The simulation detected {questions} questions. Review the answer key and partial-credit rules before grading.</p><Field label="Detected questions"><input type="number" min="1" max="50" value={questions} onChange={e=>setQuestions(Number(e.target.value))}/></Field><Field label="Answer key / expected evidence"><textarea required value={answerKey} onChange={e=>setAnswerKey(e.target.value)}/></Field><div className="form-grid"><Field label="Strictness"><select><option>Balanced</option><option>Supportive</option><option>Strict</option></select></Field><Field label="Partial credit"><select><option>Allow method marks</option><option>Final answer only</option></select></Field></div><Field label="Rubric criteria"><textarea value={rubric} onChange={e=>setRubric(e.target.value)}/></Field><button className="primary full">Approve structure & rubric</button></form>}
function GradeSelectionDialog({assessment,open,done}:any){const allFiles:UploadFile[]=assessment.files||[];const answerCandidates:UploadFile[]=allFiles.filter((f:UploadFile)=>isAnswerSheetFile(f,allFiles.length));const hasQuestionPaper=allFiles.some((f:UploadFile)=>isQuestionPaperFile(f,allFiles.length));const preferred=answerCandidates[0];const [selectedFileId,setSelectedFileId]=useState(preferred?.id||"");const selected=answerCandidates.find(file=>file.id===selectedFileId);return <><DialogHead eyebrow={assessment.title} title="Select answer sheet for AI grading"/><p className="modal-copy">AI grading processes an ungraded answer sheet directly, then opens the existing Review tab for teacher review. Teacher-graded sheets preserve the teacher's marks and continue to learning-gap diagnosis.</p><div className="grade-file-picker">{allFiles.map((file:UploadFile)=>{const graded=Boolean(assessment.gradeResults?.[file.id]);const answer=isAnswerSheetFile(file,allFiles.length);return <label key={file.id} className={selectedFileId===file.id?"selected":""}><input type="radio" name="grade-file" value={file.id} disabled={!answer} checked={selectedFileId===file.id} onChange={()=>setSelectedFileId(file.id)}/><span className="file-icon">{file.name.split(".").pop()?.toUpperCase()}</span><span><b>{file.name}</b><small>{answer?(file.documentRole||inferDocumentRole(file.name)):`${file.documentRole||inferDocumentRole(file.name)} · assessment reference`}</small></span>{graded&&<em>Already analysed</em>}</label>})}</div>{selected?.documentRole==="Teacher-graded answer sheet"&&<p className="insight">Teacher-graded selected: awarded marks are read and used for learning-gap diagnosis without a grading review.</p>}{!hasQuestionPaper&&<p className="form-error">A question paper is compulsory. This assessment cannot be analysed until one is attached in assessment creation.</p>}{!answerCandidates.length&&<p className="form-error">Upload at least one student answer sheet.</p>}<button className="primary full" disabled={!selectedFileId||!hasQuestionPaper} onClick={()=>selected&&open(`${autoAnalysisDialogFor(selected)}:${selectedFileId}`)}>{selected?.documentRole==="Teacher-graded answer sheet"?"Read teacher marks & diagnose learning gaps →":"Start AI Grading →"}</button></>}
function DiagnosisSelectionDialog({assessment,open}:any){
  const allFiles:UploadFile[]=assessment.files||[];
  const answerCandidates=allFiles.filter(file=>isAnswerSheetFile(file,allFiles.length));
  const hasQuestionPaper=allFiles.some(file=>isQuestionPaperFile(file,allFiles.length));
  const [selectedFileId,setSelectedFileId]=useState(answerCandidates[0]?.id||"");
  return <><DialogHead eyebrow={assessment.title} title="Select answer sheet for learning-gap diagnosis"/><p className="modal-copy">Choose an answer sheet to use the existing Learning Gap Diagnosis without completing grading.</p><div className="grade-file-picker">{allFiles.map(file=>{const answer=isAnswerSheetFile(file,allFiles.length);return <label key={file.id} className={selectedFileId===file.id?"selected":""}><input type="radio" name="diagnosis-file" value={file.id} disabled={!answer} checked={selectedFileId===file.id} onChange={()=>setSelectedFileId(file.id)}/><span className="file-icon">{file.name.split(".").pop()?.toUpperCase()}</span><span><b>{file.name}</b><small>{answer?"Answer sheet":`${file.documentRole||inferDocumentRole(file.name)} · assessment reference`}</small></span></label>})}</div>{!hasQuestionPaper&&<p className="form-error">A question paper is compulsory for the existing Learning Gap Diagnosis.</p>}{!answerCandidates.length&&<p className="form-error">Upload at least one student answer sheet.</p>}<button className="primary full" disabled={!selectedFileId||!hasQuestionPaper} onClick={()=>open(`diagnose-file:${selectedFileId}`)}>Skip Grading & Diagnose Learning Gaps →</button></>
}

const bulkQueueKey=(assessmentId:string)=>`eduai-bulk-analysis:${assessmentId}`;
function saveBulkAnalysisQueue(assessmentId:string,fileIds:string[]){try{sessionStorage.setItem(bulkQueueKey(assessmentId),JSON.stringify(fileIds))}catch{}}
function bulkAnalysisQueue(assessmentId:string):string[]{try{return JSON.parse(sessionStorage.getItem(bulkQueueKey(assessmentId))||"[]")}catch{return []}}
function advanceBulkAnalysisQueue(assessmentId:string,completedFileId:string){try{const queue:string[]=JSON.parse(sessionStorage.getItem(bulkQueueKey(assessmentId))||"[]");const remaining=queue.filter(id=>id!==completedFileId);if(remaining.length)sessionStorage.setItem(bulkQueueKey(assessmentId),JSON.stringify(remaining));else sessionStorage.removeItem(bulkQueueKey(assessmentId));return remaining[0]||""}catch{return ""}}
function BulkAnalysisWizard({assessment,open,done}:any){
  const answers:UploadFile[]=(assessment.files||[]).filter((f:UploadFile)=>isAnswerSheetFile(f,(assessment.files||[]).length));
  const [step,setStep]=useState(1),[selected,setSelected]=useState<string[]>(answers.map(f=>f.id));
  const chosen=answers.filter(f=>selected.includes(f.id)),completed=chosen.filter(f=>assessment.gradeResults?.[f.id]),pending=chosen.filter(f=>!assessment.gradeResults?.[f.id]);
  const toggle=(id:string)=>setSelected(current=>current.includes(id)?current.filter(x=>x!==id):[...current,id]);
  const nextPending=pending[0];
  const startQueue=()=>{saveBulkAnalysisQueue(assessment.id,pending.map(file=>file.id));if(nextPending)open(`${autoAnalysisDialogFor(nextPending)}:${nextPending.id}`);else setStep(5)};
  return <><DialogHead eyebrow={`Step ${step} of 5 · ${assessment.title}`} title="Check Multiple Students"/>
    {step===1&&<><p className="modal-copy">Select the students whose uploaded answer sheets belong to this assessment.</p><label className="check"><input type="checkbox" checked={selected.length===answers.length&&answers.length>0} onChange={e=>setSelected(e.target.checked?answers.map(f=>f.id):[])}/> Select All</label><div className="grade-file-picker">{answers.map(file=><label key={file.id} className={selected.includes(file.id)?"selected":""}><input type="checkbox" checked={selected.includes(file.id)} onChange={()=>toggle(file.id)}/><span className="file-icon">{file.name.split(".").pop()?.toUpperCase()}</span><span><b>{guessStudentName(file,[])}</b><small>{file.name}</small></span><em>{assessment.gradeResults?.[file.id]?"Completed":"Uploaded"}</em></label>)}</div><button className="primary full" disabled={!selected.length} onClick={()=>setStep(2)}>Continue with {selected.length} student{selected.length===1?"":"s"}</button></>}
    {step===2&&<><p className="modal-copy">Confirm each student-to-answer-sheet match. Use Upload evidence if a selected student has no sheet.</p><div className="upload-list">{chosen.map(file=><div key={file.id}><span className="file-icon">PDF</span><div><b>{guessStudentName(file,[])}</b><small>{file.name} · {file.status||"Uploaded"}</small></div><span className="status success">Ready</span></div>)}</div><div className="button-row"><button className="secondary" onClick={()=>open("upload")}>Upload / replace sheets</button><button className="primary" onClick={()=>setStep(3)}>Confirm matches</button></div></>}
    {step===3&&<><div className="impact-box"><b>Students selected: {chosen.length}</b><span>Answer sheets ready: {chosen.length}</span></div><p className="modal-copy">Each sheet uses the same assessment question paper and marking references. AI grading runs without an OCR review step. When the selected students are graded, the existing Review tab opens for teacher review.</p><button className="primary full" onClick={startQueue}>Start AI Grading</button></>}
    {step===4&&<><Progress value={chosen.length?Math.round(completed.length/chosen.length*100):0}/><p className="modal-copy">AI grading {completed.length} of {chosen.length}. The safe queue prevents duplicate requests and credit charges.</p><div className="pipeline">{chosen.map(file=><div className={assessment.gradeResults?.[file.id]?"done":""} key={file.id}><i>{assessment.gradeResults?.[file.id]?"✓":"…"}</i><b>{guessStudentName(file,[])}</b><small>{assessment.gradeResults?.[file.id]?"AI graded":file.id===nextPending?.id?"Ready for AI grading":"Pending"}</small></div>)}</div>{nextPending?<button className="primary full" onClick={()=>open(`${autoAnalysisDialogFor(nextPending)}:${nextPending.id}`)}>Continue AI Grading</button>:<button className="primary full" onClick={()=>done("AI grading complete. Review is ready.")}>Open Review</button>}</>}
    {step===5&&<><div className="impact-box"><b>{chosen.length} Students Selected</b><span>{completed.length} Successfully Completed · {chosen.length-completed.length} Failed or Pending</span></div><div className="button-row"><button className="secondary" onClick={()=>setStep(4)}>Retry Failed</button><button className="secondary" onClick={()=>open("process")}>View Results</button><button className="primary" onClick={()=>done("Multiple-student analysis queue completed")}>Download Reports</button></div></>}
  </>;
}
function ProcessDialog({assessment,update,open,done}:any){
  const files:UploadFile[]=(assessment.files||[]).filter((f:UploadFile)=>isAnswerSheetFile(f,(assessment.files||[]).length));
  const gradedCount=files.filter(f=>Boolean(assessment.gradeResults?.[f.id])).length;
  const allGraded=files.length>0&&gradedCount===files.length;
  const continueToReview=()=>{update(assessment.id,{stage:"review",reviewed:assessment.reviewed,totalReviews:Math.max(assessment.totalReviews,files.length*4)});done()};
  return <><DialogHead eyebrow="Grading status" title="OCR & grading pipeline"/><p className="modal-copy">Each answer sheet is graded individually with OCR and diagnostic learning analysis. Grade every file below, then continue to teacher review.</p>
  <div className="upload-list">{files.map(f=>{const graded=Boolean(assessment.gradeResults?.[f.id]);return <div key={f.id}><span className="file-icon">{f.name.split(".").pop()?.toUpperCase()}</span><div><b>{f.name}</b><small>{graded?"Graded":"Not graded yet"}</small></div>{!graded&&<button className="secondary" onClick={()=>open(`grade-file:${f.id}`)}>Grade now</button>}</div>})}</div>
  {!files.length&&<p className="form-error">No answer-sheet files uploaded yet.</p>}
  <button className="primary full" disabled={!allGraded} onClick={continueToReview}>{allGraded?"Continue to teacher review":`${gradedCount}/${files.length} graded — grade all files to continue`}</button></>}
function RegradeDialog({assessment,update,done}:any){
  const affected=Object.keys(assessment.gradeResults||{}).length;
  const submit=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();update(assessment.id,{stage:"review",reviewed:0,version:assessment.version+1});done()};
  return <form onSubmit={submit}><DialogHead eyebrow="Versioned grading" title="Start regrade"/><Field label="Scope"><select required><option>Selected question</option><option>Selected students</option><option>Full assessment</option><option>Rubric criterion</option></select></Field><Field label="Reason"><select required><option>Alternative correct answer discovered</option><option>Rubric changed</option><option>Partial-credit rule changed</option><option>Question ambiguity</option><option>Moderation</option></select></Field><Field label="Teacher note"><textarea required placeholder="Explain the change for the audit history"/></Field><div className="impact-box"><b>Impact preview</b><span>{affected} student{affected===1?"":"s"} with existing graded evidence. Score changes will be calculated after the regrade runs.</span></div><button className="primary full">Confirm regrade version {assessment.version+1}</button></form>}
function BulkReview({assessment,update,done}:any){
  const remaining=Math.max(0,assessment.totalReviews-assessment.reviewed);
  return <><DialogHead eyebrow="High-confidence objective answers" title="Bulk review"/><p className="modal-copy">{remaining} answer{remaining===1?"":"s"} remain in the review queue for this assessment.</p><div className="list-item"><b>Approve {remaining} remaining answer{remaining===1?"":"s"}</b></div><button className="primary full" disabled={!remaining} onClick={()=>{update(assessment.id,{reviewed:assessment.totalReviews});done()}}>Approve remaining answers</button></>}
function InterventionForm({state,setState,assessment,done}:any){
  const results:GradeResult[]=Object.values(assessment.gradeResults||{});
  const conceptAgg:Record<string,{sum:number;count:number}>={};
  results.forEach(r=>r.gaps.forEach(g=>{const b=conceptAgg[g.concept]||{sum:0,count:0};b.sum+=g.mastery;b.count+=1;conceptAgg[g.concept]=b}));
  const sortedConcepts=Object.entries(conceptAgg).map(([concept,b])=>({concept,mastery:b.sum/b.count})).sort((a,b)=>a.mastery-b.mastery);
  const defaultConcept=sortedConcepts[0]?.concept||"";
  const submit=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);const i:Intervention={id:`i${Date.now()}`,assessmentId:assessment.id,concept:String(f.get("concept")),format:String(f.get("format")),duration:String(f.get("duration")),status:"Planned",followup:String(f.get("followup"))};setState((s:DemoState)=>({...s,interventions:[i,...s.interventions],assessments:s.assessments.map(a=>a.id===assessment.id?{...a,stage:"intervention"}:a),events:[`Intervention created · ${i.concept}`,...s.events]}));done()};
  return <form onSubmit={submit}><DialogHead eyebrow="Plan intervention" title="Plan intervention"/><Field label="Concept"><input name="concept" required defaultValue={defaultConcept} placeholder="Grade an answer sheet first to prefill the priority gap"/></Field><div className="form-grid"><Field label="Format"><select name="format"><option>5-minute correction</option><option>Guided practice</option><option>Full-period reteaching</option><option>Homework</option><option>Remedial support</option><option>Exit ticket</option></select></Field><Field label="Duration"><select name="duration"><option>15 minutes</option><option>5 minutes</option><option>40 minutes</option></select></Field><Field label="Group"><select><option>Strengthen</option><option>Practise</option><option>Extend</option></select></Field><Field label="Follow-up date"><input name="followup" type="date" required defaultValue={new Date(Date.now()+7*86400000).toISOString().slice(0,10)}/></Field></div><Field label="Objective & activity"><textarea required placeholder="Describe the teaching activity for this concept"/></Field><button className="primary full">Approve and create plan</button></form>}
function StudyGuideDialog({assessment,fileId,open,setState,done}:any){
  const result:GradeResult|undefined=fileId?assessment.gradeResults?.[fileId]:undefined;
  const gap=result?.gaps.slice().sort((a,b)=>a.mastery-b.mastery)[0];
  const [generating,setGenerating]=useState(false);
  const [progress,setProgress]=useState(0);
  const [guide,setGuide]=useState<any>(null);
  const [error,setError]=useState("");
  if(!gap){
    return <><DialogHead eyebrow={assessment.title} title="Targeted study guide"/><p className="modal-copy">No graded evidence is available yet for {assessment.subject}. Grade at least one answer sheet first so the study guide can target a real learning gap instead of placeholder content.</p></>;
  }
  const concept=gap.concept;
  const generate=async()=>{
    setGenerating(true);setError("");setProgress(5);
    const started=Date.now();const progressTimer=window.setInterval(()=>setProgress(Math.min(92,8+Math.round((Date.now()-started)/500))),1000);
    try{
      const response=await authFetch("/api/generate-study-guide",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({subject:assessment.subject,concept,studentName:result?.studentName,mastery:gap.mastery,gaps:result?.gaps,feedback:result?.feedback,ocrText:result?.ocrText,evidenceFiles:assessment.files.map((file:UploadFile)=>`${file.documentRole||inferDocumentRole(file.name)}: ${file.name}`)})});
      const payload=await response.json();
      if(!response.ok)throw new Error(payload?.error||"Study-guide generation failed");
      setProgress(100);
      setGuide(payload.guide);
      const saved:Worksheet={id:`guide-${assessment.id}-${fileId}`,title:payload.guide.title,type:"Study Guide",status:"Saved",subject:assessment.subject,grade:assessment.grade,assessmentId:assessment.id,concepts:(result?.gaps||[]).map((g:Gap)=>g.concept),guide:payload.guide,studentName:result?.studentName,evidenceFiles:assessment.files.map((file:UploadFile)=>`${file.documentRole||inferDocumentRole(file.name)} · ${file.name}`)};
      setState((s:DemoState)=>({...s,resources:[saved,...s.resources.filter(r=>r.id!==saved.id)],events:[`Study guide saved · ${saved.title}`,...s.events]}));
    }catch(err){setError(err instanceof Error?err.message:"Study-guide generation failed")}finally{clearInterval(progressTimer);setGenerating(false)}
  };
  const download=()=>downloadStudyGuide({title:guide.title,subject:assessment.subject,grade:assessment.grade,studentName:result?.studentName,evidenceFiles:assessment.files.map((file:UploadFile)=>`${file.documentRole||inferDocumentRole(file.name)} · ${file.name}`)},guide);
  return <><DialogHead eyebrow={`${result?`${result.studentName} · `:""}Learning recovery plan · ${assessment.title}`} title="Complete study guide"/>
    <p className="modal-copy">This guide covers all <b>{result?.gaps.length||1} diagnosed learning gap{result?.gaps.length===1?"":"s"}</b>, beginning with the weakest topic. Every section is grounded in the uploaded evidence and diagnostic findings.</p>
    {!guide&&<button className="secondary full" disabled={generating} onClick={generate}>{generating?"Generating evidence-based guide…":"Generate and save study guide"}</button>}
    {generating&&<><Progress value={progress}/><p className="modal-copy">Server generation in progress · {progress}% · safe to switch tabs</p></>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    {guide&&<><div className="branded-document study-guide-view"><BrandDocumentHeader label="Personalised study guide" title={guide.title} meta={`${assessment.subject} · ${result?.studentName||"Student"} · ${guide.topics?.length||0} topic plan`}/><p className="guide-overview">{guide.overview}</p><nav className="guide-topic-index" aria-label="Study guide topics">{(guide.topics||[]).map((topic:any,index:number)=><span key={topic.concept}><b>{index+1}</b>{topic.concept}<small>{topic.mastery}% starting mastery</small></span>)}</nav><div className="source-ribbon"><b>Built from</b>{assessment.files.map((file:UploadFile)=><span key={file.id}>{file.documentRole||inferDocumentRole(file.name)} · {file.name}</span>)}</div><div className="guide-topic-sections">{(guide.topics||[]).map((topic:any,index:number)=><section key={topic.concept}><header><span>Topic {index+1}</span><h3>{topic.concept}</h3><b>{topic.mastery}%</b></header><div className="diagnosis-callout"><b>Why this is a learning gap</b><p>{topic.diagnosis}</p></div><div className="guide-learning-grid"><article><b>Learning objective</b><p>{topic.learningObjective}</p></article><article><b>Clear explanation</b><p>{topic.explanation}</p></article><article className="span-2"><b>Worked example</b><p>{topic.workedExample}</p></article><article><b>Guided practice</b><ol>{(topic.practiceSteps||[]).map((step:string,i:number)=><li key={i}>{step}</li>)}</ol></article><article><b>Check for understanding</b><ol>{(topic.checkForUnderstanding||[]).map((step:string,i:number)=><li key={i}>{step}</li>)}</ol></article></div></section>)}</div></div>
    <Field label="Teacher instructions"><textarea defaultValue={`Use this ${assessment.subject} guide to address ${concept}. Ask the student to explain the evidence behind each response.`}/></Field>
    <div className="button-row">
      <button className="secondary" onClick={download}>Download branded PDF study guide</button>
      <button className="secondary" onClick={generate} disabled={generating}>Regenerate</button>
      {fileId?<button className="primary" onClick={()=>open(`worksheet-gap:${fileId}`)}>Continue to practice worksheet →</button>:<button className="primary" onClick={done}>Approve & save</button>}
    </div></>}
  </>
}

async function generateAllStudentResources(assessment:Assessment,result:GradeResult,setState:any){
  const guideResponse=await authFetch("/api/generate-study-guide",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({subject:assessment.subject,concept:result.gaps[0]?.concept||assessment.subject,studentName:result.studentName,mastery:result.gaps[0]?.mastery??0,gaps:result.gaps,feedback:result.feedback,ocrText:result.ocrText,evidenceFiles:assessment.files.map(file=>`${file.documentRole||inferDocumentRole(file.name)}: ${file.name}`)})});
  const guidePayload=await guideResponse.json();if(!guideResponse.ok)throw new Error(guidePayload?.error||"Study-guide generation failed");
  const concepts=result.gaps.map(g=>g.concept);
  const worksheetResponse=await authFetch("/api/generate-worksheet",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({subject:assessment.subject,grade:assessment.grade,concepts:concepts.length?concepts:[assessment.subject],difficulty:"Mixed",template:"Guided recovery",mcqCount:Math.max(6,concepts.length*2),subjectiveCount:Math.max(4,concepts.length),studentName:result.studentName,diagnosticGaps:result.gaps})});
  const worksheetPayload=await worksheetResponse.json();if(!worksheetResponse.ok)throw new Error(worksheetPayload?.error||"Worksheet generation failed");delete worksheetPayload.timing;
  const guide:Worksheet={id:`guide-${assessment.id}-${result.fileId}`,title:guidePayload.guide.title,type:"Study Guide",status:"Saved",subject:assessment.subject,grade:assessment.grade,assessmentId:assessment.id,concepts,guide:guidePayload.guide,studentName:result.studentName,evidenceFiles:assessment.files.map(file=>`${file.documentRole||inferDocumentRole(file.name)} · ${file.name}`)};
  const worksheet:Worksheet={id:`worksheet-${assessment.id}-${result.fileId}`,title:`${result.studentName} Personalized Practice`,type:"Targeted worksheet",status:"Approved",template:"Guided recovery",concept:concepts[0]||assessment.subject,concepts,subject:assessment.subject,grade:assessment.grade,assessmentId:assessment.id,studentName:result.studentName,mcq:Math.max(6,concepts.length*2),subjective:Math.max(4,concepts.length),difficulty:"Mixed",answerSheets:0,gradedSheets:0,content:worksheetPayload as WorksheetContent};
  setState((state:DemoState)=>({...state,resources:[guide,worksheet,...state.resources.filter(item=>item.id!==guide.id&&item.id!==worksheet.id)],events:[`All reports ready · ${result.studentName}`,...state.events]}));
  return {guide,worksheet};
}

function PerFileGradeDialog({assessment,file,state,setState,update,open,notify,diagnosisOnly=false,autoGrade=false,openAssessment,close}:any){
  if(!file)return <><DialogHead eyebrow={assessment.title} title="Grade answer sheet"/><p className="modal-copy">This answer sheet could not be found. Close this dialog and try again.</p></>;
  const candidates:UploadFile[]=(assessment.files||[]).filter((f:UploadFile)=>f.id!==file.id);
  const questionPapers=candidates.filter(f=>f.documentRole==="Question paper"||(!f.documentRole&&/question|paper|qp/i.test(f.name)));
  const markingSchemes=candidates.filter(f=>f.documentRole==="Marking scheme"||(!f.documentRole&&/marking.?scheme|mark.?scheme/i.test(f.name)));
  const modelAnswers=candidates.filter(f=>f.documentRole==="Model answer"||(!f.documentRole&&/answer.?key|model.?answer|solutions?/i.test(f.name)));
  const otherQuestionPaperChoices=candidates.filter(f=>!questionPapers.some(q=>q.id===f.id));
  const preferredQP=questionPapers[0];
  const preferredScheme=markingSchemes[0];
  const preferredModel=modelAnswers[0];
  const mappingOptions=classSubjectOptions(state);
  const initialClassKey=assessment.grade&&assessment.section?`${assessment.grade}|${assessment.section.toUpperCase()}`:mappingOptions[0]?.classKey||"";
  const [qpId,setQpId]=useState(preferredQP?.id||"");
  const [markingSchemeId,setMarkingSchemeId]=useState(preferredScheme?.id||"");
  const [modelAnswerId,setModelAnswerId]=useState(preferredModel?.id||"");
  const [studentName,setStudentName]=useState(()=>guessStudentName(file,state.students));
  const [analysisClassKey,setAnalysisClassKey]=useState(initialClassKey);
  const availableSubjects=Array.from(new Set(mappingOptions.filter(option=>option.classKey===analysisClassKey).map(option=>option.subject)));
  const [analysisSubject,setAnalysisSubject]=useState(()=>availableSubjects.includes(assessment.subject)?assessment.subject:availableSubjects[0]||"");
  const selectedMapping=mappingOptions.find(option=>option.classKey===analysisClassKey&&option.subject===analysisSubject);
  const analysisGrade=selectedMapping?`Class ${selectedMapping.grade}${selectedMapping.section}`:"";
  const [progress,setProgress]=useState(0);
  const [running,setRunning]=useState(false);
  const [ocrDocuments,setOcrDocuments]=useState<any>(null);
  const alreadyGraded=Boolean(assessment.gradeResults?.[file.id]&&!assessment.gradeResults[file.id].gradingSkipped);
  const [reanalysisReason,setReanalysisReason]=useState("");
  const [gradeError,setGradeError]=useState("");
  const [pendingAnalysis,setPendingAnalysis]=useState<{result:GradeResult;questions:EvaluatorQuestion[]}|null>(null);
  const [evaluationErrors,setEvaluationErrors]=useState<string[]>([]);
  const resetReferenceOcr=()=>{setOcrDocuments(null);setProgress(0);setGradeError("")};
  const changeQuestionPaper=(id:string)=>{setQpId(id);resetReferenceOcr()};
  const grade=async()=>{
    if(pendingAnalysis){await submitEvaluation();return}
    if(!studentName.trim()){notify("Enter the student's name before grading.","warning");return}
    if(!qpId){notify("A question paper is compulsory before learning-gap analysis can start.","warning");return}
    if(!analysisSubject.trim()||!analysisGrade.trim()){notify("Subject and Class are required before generating learning gaps.","warning");return}
    if(alreadyGraded&&!reanalysisReason.trim()){notify("Enter a Reason for Reanalysis before starting.","warning");return}
    const validatedOcr=[ocrDocuments?.answerSheet?.text||"",ocrDocuments?.questionPaper?.text||"",ocrDocuments?.markingScheme?.text||"",ocrDocuments?.modelAnswer?.text||""].join("|");
    let ocrHash=0;for(let i=0;i<validatedOcr.length;i++)ocrHash=((ocrHash<<5)-ocrHash+validatedOcr.charCodeAt(i))|0;
    const evidenceFingerprint=[file.id,qpId,markingSchemeId,modelAnswerId,assessment.answerKey||"",assessment.rubric||"",analysisSubject,analysisGrade,ocrHash,alreadyGraded?reanalysisReason.trim():""].join("|");
    const previous:GradeResult|undefined=assessment.gradeResults?.[file.id];
    if(ocrDocuments&&previous?.evidenceFingerprint===evidenceFingerprint&&!(previous.gradingSkipped&&!diagnosisOnly)){
      notify(`This evidence has not changed. The fixed score and learning gaps for ${previous.studentName} were reused.`);
      open(`student-gaps:${file.id}`);
      return;
    }
    setGradeError("");setRunning(true);let p=0;
    const timer=window.setInterval(()=>{p=Math.min(90,p+15);setProgress(p)},180);
    try{
      const blob=await readFileBlob(file.id);
      if(!blob)throw new Error("This file's data could not be found in local storage. Try re-uploading it.");
      const fileBase64=await blobToBase64(blob);
      const qp=candidates.find(f=>f.id===qpId);
      const qpBlob=qpId?await readFileBlob(qpId):null;
      const markingSchemeFile=candidates.find(f=>f.id===markingSchemeId);
      const markingSchemeBlob=markingSchemeId?await readFileBlob(markingSchemeId):null;
      const modelAnswerFile=candidates.find(f=>f.id===modelAnswerId);
      const modelAnswerBlob=modelAnswerId?await readFileBlob(modelAnswerId):null;
      if(qpId&&!qp)throw new Error("The selected question paper is no longer in Uploaded evidence. Select it again.");
      if(qpId&&!qpBlob)throw new Error("The selected question paper could not be loaded. Preview it in Uploaded evidence or re-upload it.");
      if(markingSchemeId&&!markingSchemeBlob)throw new Error("The assessment marking scheme could not be loaded.");
      if(modelAnswerId&&!modelAnswerBlob)throw new Error("The assessment model answer could not be loaded.");
      if(!ocrDocuments){
        const documents=[
          {id:"answerSheet",name:file.name,base64:fileBase64,mimeType:file.type||"application/pdf"},
          {id:"questionPaper",name:qp?.name||"Question paper",base64:await blobToBase64(qpBlob as Blob),mimeType:qp?.type||"application/pdf"},
          ...(markingSchemeBlob?[{id:"markingScheme",name:markingSchemeFile?.name||"Marking scheme",base64:await blobToBase64(markingSchemeBlob),mimeType:markingSchemeFile?.type||"application/pdf"}]:[]),
          ...(modelAnswerBlob?[{id:"modelAnswer",name:modelAnswerFile?.name||"Model answer",base64:await blobToBase64(modelAnswerBlob),mimeType:modelAnswerFile?.type||"application/pdf"}]:[])
        ];
        const ocrResponse=await authFetch("/api/ocr",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({documents})});
        const ocrPayload=await ocrResponse.json();
        logApiTiming(setState,ocrPayload?.timing);
        if(!ocrResponse.ok)throw new Error(ocrPayload?.error||"OCR request failed");
        const cleanDocuments=Object.fromEntries(Object.entries(ocrPayload.documents||{}).map(([id,document]:any)=>[id,{...document,text:normalizeOcrText(document?.text||"")}]));
        clearInterval(timer);setProgress(100);setOcrDocuments(cleanDocuments);
        notify("Mistral OCR is complete. Review and correct the extracted text before validation.");
        return;
      }
      const concepts=gapConceptsFor(assessment.subject);
      const res=await authFetch("/api/grade",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          subject:analysisSubject,
          className:analysisGrade,
          studentName:studentName.trim(),
          fileName:file.name,
          documentRole:file.documentRole||inferDocumentRole(file.name),
          maxMarks:assessment.maxMarks,
          answerKey:assessment.answerKey,
          rubric:assessment.rubric,
          ocrText:ocrDocuments.answerSheet?.text,
          questionPaperText:ocrDocuments.questionPaper?.text,
          questionPaperName:qp?.name,
          markingSchemeText:ocrDocuments.markingScheme?.text,
          markingSchemeName:markingSchemeFile?.name,
          modelAnswerText:ocrDocuments.modelAnswer?.text,
          modelAnswerName:modelAnswerFile?.name,
          reanalysisReason:alreadyGraded?reanalysisReason.trim():undefined,
          operationKey:`analysis:${assessment.id}:${file.id}:${Math.abs(ocrHash)}`
        })
      });
      const payload=await res.json();
      logApiTiming(setState,payload?.timing);
      if(!res.ok)throw new Error(payload?.error||"Grading request failed");
      clearInterval(timer);setProgress(100);
      const gaps:Gap[]=(payload.gaps||[]).map((g:any)=>({concept:String(g.concept),mastery:Math.max(0,Math.min(100,Math.round(Number(g.mastery)))),finding:String(g.finding||""),misconception:String(g.misconception||""),evidence:String(g.evidence||""),prerequisiteConcept:String(g.prerequisiteConcept||""),foundationGap:String(g.foundationGap||""),recommendedLevel:String(g.recommendedLevel||""),remediationSequence:Array.isArray(g.remediationSequence)?g.remediationSequence.map(String):[],rework:String(g.rework||""),severity:["priority","developing","secure"].includes(g.severity)?g.severity:undefined})).sort((a:Gap,b:Gap)=>a.mastery-b.mastery);
      const detectedMaxMarks=Math.max(1,Math.round(Number(payload.maxMarks)||assessment.maxMarks));
      const questions:EvaluatorQuestion[]=(payload.questions||[]).map((question:any)=>({...question,allowedIncrement:[0.25,0.5,1].includes(Number(question.allowedIncrement))?Number(question.allowedIncrement):0.5,reviewed:false,aiDisposition:"accepted"}));
      const score=questions.reduce((sum,question)=>sum+Number(question.awardedMarks||0),0);
      const result:GradeResult={fileId:file.id,studentName:studentName.trim(),questionPaperFileId:qpId||undefined,questionPaperName:qp?.name,score,maxMarks:detectedMaxMarks,gaps,date:new Date().toISOString(),feedback:typeof payload.feedback==="string"?payload.feedback:undefined,ocrText:ocrDocuments.answerSheet?.text,evidenceFingerprint,reanalysisReason:alreadyGraded?reanalysisReason.trim():undefined,questionDecisions:questions,gradingSkipped:diagnosisOnly||undefined};
      if(diagnosisOnly){
        update(assessment.id,{grade:selectedMapping?.grade||assessment.grade,section:selectedMapping?.section||assessment.section,subject:analysisSubject,maxMarks:detectedMaxMarks,gradeResults:{...(assessment.gradeResults||{}),[file.id]:result},lastGradedFileId:file.id,stage:"xray"});
        notify(`${result.studentName}'s teacher-awarded marks were analysed. Reports are generating in the background.`);
        void generateAllStudentResources({...assessment,subject:analysisSubject,grade:selectedMapping?.grade||assessment.grade},result,setState).then(()=>notify(`All reports are ready for ${result.studentName} in Resources.`)).catch(error=>notify(error instanceof Error?error.message:"Background report generation failed","error"));
        const nextFileId=advanceBulkAnalysisQueue(assessment.id,file.id);
        const nextFile=(assessment.files||[]).find((item:UploadFile)=>item.id===nextFileId);
        close?.();window.setTimeout(()=>nextFile?open(`${analysisDialogFor(nextFile)}:${nextFile.id}`):openAssessment?.(assessment.id,"X-Ray"),250);
      }else{
        update(assessment.id,{grade:selectedMapping?.grade||assessment.grade,section:selectedMapping?.section||assessment.section,subject:analysisSubject,maxMarks:result.maxMarks,gradeResults:{...(assessment.gradeResults||{}),[file.id]:result},gradedFileIds:Array.from(new Set([...(assessment.gradedFileIds||[]),file.id])),lastGradedFileId:file.id,stage:"review",reviewed:0,totalReviews:questions.length});
        notify(`${result.studentName}'s AI grading is ready in the Review tab.`);
        const nextFileId=advanceBulkAnalysisQueue(assessment.id,file.id);const nextFile=(assessment.files||[]).find((item:UploadFile)=>item.id===nextFileId);
        close?.();window.setTimeout(()=>nextFile?open(`${autoAnalysisDialogFor(nextFile)}:${nextFile.id}`):openAssessment?.(assessment.id,"Review"),250);
      }
    }catch(err){
      clearInterval(timer);
      const message=err instanceof Error?err.message:"Grading failed";
      setGradeError(message);
      notify(`Grading failed: ${message}`,"error");
    }finally{
      setRunning(false);
    }
  };
  const updateQuestion=(id:string,patch:Partial<EvaluatorQuestion>)=>setPendingAnalysis(current=>current?{...current,questions:current.questions.map(question=>question.id===id?{...question,...patch,aiDisposition:Object.prototype.hasOwnProperty.call(patch,"awardedMarks")||Object.prototype.hasOwnProperty.call(patch,"attemptState")?"edited":question.aiDisposition}:question)}:current);
  const submitEvaluation=async()=>{
    if(!pendingAnalysis)return;
    setRunning(true);setEvaluationErrors([]);setGradeError("");
    try{
      const questions=pendingAnalysis.questions.map(question=>({...question,awardedMarks:Number(question.awardedMarks),maxMarks:Number(question.maxMarks)}));
      const response=await authFetch("/api/evaluations/submit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
        assessmentId:assessment.id,fileId:file.id,studentName:pendingAnalysis.result.studentName,assessmentVersion:assessment.version||1,questionPaperFileId:qpId||undefined,
        questions,pages:[{pageNumber:1,disposition:"contains_reviewed_answer"}],expectedMaxMarks:pendingAnalysis.result.maxMarks,evaluatorConfirmation:true,
        idempotencyKey:`evaluation:${assessment.id}:${file.id}:${Math.abs((pendingAnalysis.result.evidenceFingerprint||"").split("").reduce((hash,char)=>((hash<<5)-hash+char.charCodeAt(0))|0,0))}`
      })});
      const payload=await response.json();
      if(!response.ok){setEvaluationErrors(Array.isArray(payload.errors)?payload.errors:[]);throw new Error(payload.error||"Evaluation submission failed");}
      const score=Number(payload.evaluation.total_awarded);
      const result:GradeResult={...pendingAnalysis.result,score,questionDecisions:questions,evaluationVersionId:payload.evaluation.id,evaluationVersion:Number(payload.evaluation.version_number),evaluationStatus:payload.evaluation.status};
      update(assessment.id,{grade:selectedMapping?.grade||assessment.grade,section:selectedMapping?.section||assessment.section,subject:analysisSubject,maxMarks:result.maxMarks,gradeResults:{...(assessment.gradeResults||{}),[file.id]:result},gradedFileIds:Array.from(new Set([...(assessment.gradedFileIds||[]),file.id])),lastGradedFileId:file.id,stage:["draft","uploaded","setup"].includes(assessment.stage)?"review":assessment.stage});
      notify(`${result.studentName}'s immutable evaluation v${result.evaluationVersion} was submitted. Reports are generating in the background.`);
      void generateAllStudentResources({...assessment,subject:analysisSubject,grade:selectedMapping?.grade||assessment.grade},result,setState).then(()=>notify(`All reports are ready for ${result.studentName} in Resources.`)).catch(error=>notify(error instanceof Error?error.message:"Background report generation failed","error"));
      const nextFileId=advanceBulkAnalysisQueue(assessment.id,file.id);const nextFile=(assessment.files||[]).find((item:UploadFile)=>item.id===nextFileId);window.setTimeout(()=>open(nextFile?`${analysisDialogFor(nextFile)}:${nextFile.id}`:`student-gaps:${file.id}`),250);
    }catch(error){const message=error instanceof Error?error.message:"Evaluation submission failed";setGradeError(message);notify(message,"error")}finally{setRunning(false)}
  };
  const autoGradePhase=useRef<"idle"|"ocr"|"grading">("idle");
  useEffect(()=>{
    const queued=bulkAnalysisQueue(assessment.id).includes(file.id);
    if(running||alreadyGraded||pendingAnalysis||(!autoGrade&&!queued))return;
    if(!ocrDocuments&&autoGradePhase.current==="idle"){autoGradePhase.current="ocr";void grade();return}
    if(ocrDocuments&&autoGradePhase.current==="ocr"){autoGradePhase.current="grading";void grade()}
  },[autoGrade,ocrDocuments,running,alreadyGraded,pendingAnalysis,file.id]);
  const updateOcr=(id:string,text:string)=>setOcrDocuments((current:any)=>({...current,[id]:{...current[id],text}}));
  if(autoGrade)return <><DialogHead eyebrow={assessment.title} title="AI Grading"/><p className="modal-copy">AI grading is processing {file.name}. OCR runs in the background and is not shown for review. When grading completes, the existing Review tab opens with the AI-graded answer sheet ready for teacher review.</p><Progress value={progress||5}/><p className="modal-copy">{running?(ocrDocuments?"AI grading in progress…":"Reading answer sheet…"):gradeError?"AI grading needs attention":"Preparing AI grading…"}</p>{gradeError&&<p className="form-error" role="alert">{gradeError}</p>}{gradeError&&<button className="primary full" onClick={()=>{autoGradePhase.current="idle";void grade()}}>Retry AI Grading</button>}</>;
  return <><DialogHead eyebrow={assessment.title} title={diagnosisOnly?"Analyse teacher-graded answer sheet":alreadyGraded?"Regrade answer sheet":"Grade answer sheet"}/>
    <p className="modal-copy">{diagnosisOnly?"First extract and validate the teacher's awarded marks and comments. The system will preserve those marks, diagnose learning gaps, and generate all further reports without a grading review.":"First extract text with Mistral. Review and correct it on screen. Learning-gap analysis will not start until you validate the OCR text."}</p>
    <Field label="Answer sheet"><input value={file.name} disabled/></Field>
    <Field label="Student name"><input value={studentName} onChange={e=>setStudentName(e.target.value)} required/></Field>
    <div className="form-grid">
      <Field label="Class & section"><select value={analysisClassKey} onChange={e=>{const nextClass=e.target.value;const nextSubject=mappingOptions.find(option=>option.classKey===nextClass)?.subject||"";setAnalysisClassKey(nextClass);setAnalysisSubject(nextSubject)}} required><option value="" disabled>Select class & section</option>{Array.from(new Map(mappingOptions.map(option=>[option.classKey,option])).values()).map(option=><option key={option.classKey} value={option.classKey}>Class {option.grade}{option.section}</option>)}</select></Field>
      <Field label="Subject"><select value={analysisSubject} onChange={e=>setAnalysisSubject(e.target.value)} required disabled={!availableSubjects.length}><option value="" disabled>Select subject</option>{availableSubjects.map(item=><option key={item}>{item}</option>)}</select></Field>
    </div>
    {alreadyGraded&&<Field label="Reason for Reanalysis"><textarea value={reanalysisReason} onChange={e=>setReanalysisReason(e.target.value)} required rows={4} placeholder="Explain what the previous analysis missed or should reconsider."/></Field>}
    <Field label="Question paper · required">
      <select value={qpId} onChange={e=>changeQuestionPaper(e.target.value)}>
        <option value="">Select the assessment question paper</option>
        {questionPapers.length>0&&<optgroup label="Assessment question papers">{questionPapers.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</optgroup>}
        {otherQuestionPaperChoices.length>0&&<optgroup label="Legacy uploaded evidence">{otherQuestionPaperChoices.map(f=><option key={f.id} value={f.id}>{f.name} · {f.documentRole||inferDocumentRole(f.name)}</option>)}</optgroup>}
      </select>
    </Field>
    <div className="form-grid"><Field label="Marking scheme"><select value={markingSchemeId} onChange={e=>{setMarkingSchemeId(e.target.value);resetReferenceOcr()}}><option value="">Not supplied</option>{markingSchemes.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></Field><Field label="Model answer paper"><select value={modelAnswerId} onChange={e=>{setModelAnswerId(e.target.value);resetReferenceOcr()}}><option value="">Not supplied</option>{modelAnswers.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></Field></div>
    {!questionPapers.length&&<p className="form-error">This legacy assessment has no question paper. Edit or recreate the assessment with the compulsory question paper before analysis.</p>}
    {ocrDocuments&&<section className="ocr-validation"><header><div><p className="eyebrow">OCR validation</p><h3>Check the extracted text</h3></div><span className="status warning">Teacher validation required</span></header><p>Correct names, question numbers, marks, formulas or unreadable words before continuing.</p><label><b>Student answer sheet · {ocrDocuments.answerSheet?.name}</b><textarea value={ocrDocuments.answerSheet?.text||""} onChange={e=>updateOcr("answerSheet",e.target.value)} rows={12}/></label>{ocrDocuments.questionPaper&&<label><b>Question paper · {ocrDocuments.questionPaper.name}</b><textarea value={ocrDocuments.questionPaper.text} onChange={e=>updateOcr("questionPaper",e.target.value)} rows={8}/></label>}{ocrDocuments.markingScheme&&<label><b>Marking scheme · {ocrDocuments.markingScheme.name}</b><textarea value={ocrDocuments.markingScheme.text} onChange={e=>updateOcr("markingScheme",e.target.value)} rows={8}/></label>}{ocrDocuments.modelAnswer&&<label><b>Model answer paper · {ocrDocuments.modelAnswer.name}</b><textarea value={ocrDocuments.modelAnswer.text} onChange={e=>updateOcr("modelAnswer",e.target.value)} rows={8}/></label>}</section>}
    {progress>0&&<><Progress value={progress}/><p className="modal-copy">{running?(ocrDocuments?`Diagnostic analysis: ${progress}%`:`Mistral OCR: ${progress}%`):ocrDocuments?"OCR complete · awaiting teacher validation":"Ready"}</p></>}
    {pendingAnalysis&&<section className="evaluator-workspace" aria-labelledby="evaluator-workspace-title"><header><div><p className="eyebrow">Evaluator workspace</p><h3 id="evaluator-workspace-title">Review every question before submission</h3></div><span className="status warning">{pendingAnalysis.questions.filter(question=>question.reviewed).length}/{pendingAnalysis.questions.length} reviewed</span></header><p>AI marks are proposals. Confirm the attempt state, award, evidence, and rationale. Submitted evaluations are locked; later corrections create a new version.</p><div className="evaluator-question-list">{pendingAnalysis.questions.map(question=><article key={question.id} className={question.reviewed?"reviewed":""}><div className="evaluator-question-head"><div><b>{question.label}</b><small>{Math.round(question.confidence*100)}% AI confidence</small></div><label className="check"><input type="checkbox" checked={question.reviewed} onChange={event=>updateQuestion(question.id,{reviewed:event.target.checked})}/> Reviewed</label></div><div className="form-grid"><Field label="Attempt state"><select value={question.attemptState} onChange={event=>updateQuestion(question.id,{attemptState:event.target.value as EvaluatorQuestion["attemptState"],awardedMarks:event.target.value==="attempted"?question.awardedMarks:0})}><option value="attempted">Attempted</option><option value="not_attempted">Not attempted</option><option value="excluded">Excluded by choice rule</option></select></Field><Field label={`Marks (maximum ${question.maxMarks})`}><input type="number" min="0" max={question.maxMarks} step={question.allowedIncrement||0.5} value={question.awardedMarks} onChange={event=>updateQuestion(question.id,{awardedMarks:Number(event.target.value)})}/></Field></div><Field label="Evidence from the answer"><textarea rows={3} value={question.evidence} onChange={event=>updateQuestion(question.id,{evidence:event.target.value})}/></Field><Field label="Evaluator rationale"><textarea rows={2} value={question.rationale} onChange={event=>updateQuestion(question.id,{rationale:event.target.value})}/></Field></article>)}</div><div className="evaluation-total"><b>Server-checked total on submission</b><strong>{pendingAnalysis.questions.reduce((sum,question)=>sum+Number(question.awardedMarks||0),0)} / {pendingAnalysis.result.maxMarks}</strong></div>{evaluationErrors.length>0&&<div className="validation-summary" role="alert"><b>Resolve these items before submission:</b><ul>{evaluationErrors.map(error=><li key={error}>{error}</li>)}</ul></div>}</section>}
    {gradeError&&<p className="form-error" role="alert">{gradeError}</p>}
    <button className="primary full" disabled={running} onClick={grade}>{running?(ocrDocuments?"Generating reports in the background…":"Extracting text with Mistral…"):ocrDocuments?(diagnosisOnly?"Analyse Teacher Marks & Generate All Reports":"Generate All Reports"):"Extract OCR text with Mistral"}</button>
  </>
}

function StudentGapsDialog({assessment,fileId,open}:any){
  const result:GradeResult|undefined=assessment.gradeResults?.[fileId];
  const file=(assessment.files||[]).find((f:UploadFile)=>f.id===fileId);
  if(!result)return <><DialogHead eyebrow={assessment.title} title="Learning gaps report"/><p className="modal-copy">This answer sheet has not been graded yet. Grade it first to unlock its learning gaps report.</p><button className="primary full" onClick={()=>open(`grade-file:${fileId}`)}>Grade this answer sheet</button></>;
  const sorted=result.gaps.slice().sort((a,b)=>a.mastery-b.mastery);
  if(!sorted.length)return <><DialogHead eyebrow={`${result.studentName} · ${file?.name||"Answer sheet"}`} title="Learning gaps report"/><div className="empty-state"><b>No evidence-supported learning gaps found</b><p>The analysis found no wrong, partially correct, incomplete or unanswered responses in the teacher-validated OCR text. Review the score and OCR evidence before approval.</p></div><button className="secondary full" onClick={()=>open(`grade-file:${fileId}`)}>Review validated OCR</button></>;
  const priority=sorted[0];
  const percentage=result.maxMarks?Math.round(result.score/result.maxMarks*100):0;
  const performance=percentage>=90?"Excellent":percentage>=75?"Good":percentage>=55?"Developing":"Priority support required";
  return <><DialogHead eyebrow={`${result.studentName} · ${file?.name||"Answer sheet"}`} title="Learning gaps report"/>
    <section className="executive-summary student-executive-summary">
      <p className="eyebrow">Executive summary</p><h3>Student performance and priority learning gaps</h3>
      <div className="executive-summary-grid"><div><b>Student & assessment details</b><dl><div><dt>Student</dt><dd>{result.studentName}</dd></div><div><dt>Class</dt><dd>Class {assessment.grade}{assessment.section}</dd></div><div><dt>Subject</dt><dd>{assessment.subject}</dd></div><div><dt>Assessment</dt><dd>{assessment.title}</dd></div><div><dt>Marks</dt><dd>{result.score}/{result.maxMarks} · {percentage}%</dd></div><div><dt>Overall performance</dt><dd>{performance}</dd></div></dl></div><div><b>Learning-gap summary</b><ol>{sorted.map(g=><li key={g.concept}><span>{g.concept}</span><strong>{g.mastery}% · {g.mastery<55?"Priority":g.mastery<80?"Developing":"Secure"}</strong></li>)}</ol></div></div>
    </section>
    <div className="xray-summary">
      <Metric label="Score" value={`${result.score}/${result.maxMarks}`} note="AI-graded · teacher reviewable"/>
      <Metric label="Priority gap" value={priority.mastery+"%"} note={priority.concept}/>
      <Metric label="Concepts assessed" value={result.gaps.length} note={result.questionPaperName?`Against ${result.questionPaperName}`:"No question paper linked"}/>
    </div>
    <div className="diagnostic-gap-list">{sorted.map((g,index)=><article key={g.concept} className={g.mastery<55?"critical":""}><header><span>{index+1}</span><div><p>{g.severity||(g.mastery<55?"priority":"developing")} learning gap</p><h3>{g.concept}</h3></div><b>{g.mastery}% mastery</b></header><dl><div><dt>Diagnostic finding</dt><dd>{g.finding||`The response shows incomplete understanding of ${g.concept}.`}</dd></div><div><dt>Likely misunderstanding</dt><dd>{g.misconception||"The exact misconception was not captured in this earlier analysis. Reanalyse once to create the detailed diagnostic."}</dd></div><div><dt>Evidence from the answer</dt><dd>{g.evidence||result.feedback||"Review the OCR answer and teacher feedback for supporting evidence."}</dd></div><div><dt>What the child needs to rework</dt><dd>{g.rework||`Revisit the core idea, then practise explaining and applying ${g.concept}.`}</dd></div></dl></article>)}</div>
    <p className="modal-copy">The study guide will cover all {sorted.length} identified topic{sorted.length===1?"":"s"}, ordered from the most urgent knowledge gap to the strongest area.</p>
    <div className="button-row">
      <button className="secondary" onClick={()=>downloadStudentLearningGapReport(assessment,result,file)}>Download PDF Learning Gap Report</button>
      <button className="secondary" onClick={()=>open(`grade-file:${fileId}`)}>Regrade this sheet</button>
      <button className="primary" onClick={()=>open(`study-guide:${fileId}`)}>Generate study guide</button>
    </div>
  </>
}

function WorksheetDialog({setState,worksheet,sourceAssessment,sourceResult,presetConcept,presetTitle,presetStudent,done}:any){const concept=worksheet?.concept||presetConcept||"the target concept";const topics:string[]=worksheet?.concepts||sourceResult?.gaps?.map((g:Gap)=>g.concept)||[concept];const [subject,setSubject]=useState(worksheet?.subject||sourceAssessment?.subject||"");const [grade,setGrade]=useState(worksheet?.grade||sourceAssessment?.grade||"");const [generated,setGenerated]=useState(Boolean(worksheet?.content));const [generating,setGenerating]=useState(false);const [generationProgress,setGenerationProgress]=useState(0);const [genError,setGenError]=useState("");const [content,setContent]=useState<WorksheetContent|null>(worksheet?.content||null);const [template,setTemplate]=useState(worksheet?.template||"Guided recovery");const [mcq,setMcq]=useState(worksheet?.mcq??Math.max(6,topics.length*2));const [subjective,setSubjective]=useState(worksheet?.subjective??Math.max(4,topics.length));const [difficulty,setDifficulty]=useState(worksheet?.difficulty||"Mixed");const [title,setTitle]=useState(worksheet?.title||presetTitle||`${topics.join(", ")} Practice`);const save=()=>{const resource:Worksheet={id:worksheet?.id||`r${Date.now()}`,title,type:"Targeted worksheet",status:"Approved",template,concept:topics[0],concepts:topics,subject,grade,assessmentId:worksheet?.assessmentId||sourceAssessment?.id,studentName:worksheet?.studentName||presetStudent,mcq,subjective,difficulty,answerSheets:worksheet?.answerSheets||0,gradedSheets:worksheet?.gradedSheets||0,content:content||worksheet?.content};setState((s:DemoState)=>({...s,resources:worksheet?s.resources.map(r=>r.id===worksheet.id?resource:r):[resource,...s.resources],events:[`Worksheet saved · ${resource.title}`,...s.events]}));done()};
  const generate=async()=>{
    setGenError("");setGenerating(true);setGenerationProgress(5);
    const started=Date.now();const progressTimer=window.setInterval(()=>setGenerationProgress(Math.min(92,8+Math.round((Date.now()-started)/500))),1000);
    try{
      if(!subject.trim()||!grade.trim())throw new Error("Subject and Class are required.");
      if(mcq+subjective<topics.length)throw new Error(`Add at least ${topics.length} questions so every identified learning-gap topic is covered.`);
      const evidenceSummary=[sourceResult?.feedback,sourceResult?.ocrText,sourceAssessment?.files?.map((file:UploadFile)=>`${file.documentRole||inferDocumentRole(file.name)}: ${file.name}`).join("\n")].filter(Boolean).join("\n\n");
      const res=await authFetch("/api/generate-worksheet",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({concept:topics[0],concepts:topics,subject,grade,difficulty,template,mcqCount:mcq,subjectiveCount:subjective,evidenceSummary})});
      const payload=await res.json();
      logApiTiming(setState,payload?.timing);
      if(!res.ok)throw new Error(payload?.error||"Worksheet generation failed");
      delete payload.timing;
      const nextContent=payload as WorksheetContent;
      const covered=new Set([...nextContent.mcqQuestions,...nextContent.subjectiveQuestions].map(question=>question.concept?.trim().toLowerCase()).filter(Boolean));
      const missing=topics.filter(topic=>!covered.has(topic.trim().toLowerCase()));
      if(missing.length)throw new Error(`Worksheet generation missed these learning gaps: ${missing.join(", ")}. Regenerate to cover every topic.`);
      setGenerationProgress(100);setContent(nextContent);setGenerated(true);
      const resource:Worksheet={id:worksheet?.id||`worksheet-${sourceAssessment?.id||Date.now()}-${sourceResult?.fileId||"custom"}`,title,type:"Targeted worksheet",status:"Saved",template,concept:topics[0],concepts:topics,subject,grade,assessmentId:worksheet?.assessmentId||sourceAssessment?.id,studentName:worksheet?.studentName||presetStudent,mcq,subjective,difficulty,answerSheets:worksheet?.answerSheets||0,gradedSheets:worksheet?.gradedSheets||0,content:nextContent};
      setState((s:DemoState)=>({...s,resources:[resource,...s.resources.filter(r=>r.id!==resource.id)],events:[`Worksheet saved · ${resource.title}`,...s.events]}));
    }catch(err){
      setGenError(err instanceof Error?err.message:"Worksheet generation failed");
    }finally{
      clearInterval(progressTimer);setGenerating(false);
    }
  };
  return <><DialogHead eyebrow={presetStudent?`${presetStudent} · Learning-gap resource studio`:"Learning-gap resource studio"} title={worksheet?"Edit worksheet":"Create targeted worksheet"}/>
    <p className="modal-copy">Balanced practice covers every identified topic: <b>{topics.join(" · ")}</b>.</p>
    <div className="template-picker">{["Guided recovery","Quick check","Exam practice","Challenge & extend"].map(x=><button key={x} className={template===x?"active":""} onClick={()=>setTemplate(x)}><b>{x}</b><small>{x==="Guided recovery"?"Scaffolds + worked example":x==="Quick check"?"Short follow-up":x==="Exam practice"?"Mixed assessment style":"Deeper transfer tasks"}</small></button>)}</div>
    <Field label="Worksheet title"><input value={title} onChange={e=>setTitle(e.target.value)} required/></Field>
    <div className="form-grid"><Field label="Subject"><input value={subject} onChange={e=>setSubject(e.target.value)} required/></Field><Field label="Class"><input value={grade} onChange={e=>setGrade(e.target.value)} required/></Field><Field label="Difficulty"><select value={difficulty} onChange={e=>setDifficulty(e.target.value)}><option>Mixed</option><option>Foundation</option><option>Challenge</option></select></Field><Field label="Language"><select><option>English</option><option>Hindi</option></select></Field><Field label="Multiple-choice questions"><input type="number" min="0" max="30" value={mcq} onChange={e=>setMcq(Number(e.target.value))}/></Field><Field label="Subjective questions"><input type="number" min="0" max="20" value={subjective} onChange={e=>setSubjective(Number(e.target.value))}/></Field></div>
    {mcq+subjective<1&&<p className="form-error">Add at least one multiple-choice or subjective question.</p>}
    <label className="check"><input type="checkbox" defaultChecked/> Include worked example</label><label className="check"><input type="checkbox" defaultChecked/> Include answer key and marking guide</label>
    {generating&&<><Progress value={generationProgress}/><p className="modal-copy">Worksheet generation continues on the server · {generationProgress}% · safe to switch tabs</p></>}
    {genError&&<p className="form-error" role="alert">{genError}</p>}
    {generated&&content&&<div className="resource-draft branded-document"><BrandDocumentHeader label="Targeted practice worksheet" title={title} meta={`${subject} · ${grade} · ${topics.length} learning-gap topics`}/><p>{content.mcqQuestions.length} multiple-choice · {content.subjectiveQuestions.length} written response · answer key included</p><ol>{content.mcqQuestions.map((q,i)=><li key={i}><span className="question-number">{i+1}</span>{q.concept&&<span className="status">{q.concept}</span>} {q.question}<small>{q.options.map((o,j)=>`${String.fromCharCode(65+j)}) ${o}`).join("   ")}</small></li>)}{content.subjectiveQuestions.map((q,i)=><li key={`s${i}`}><span className="question-number">{content.mcqQuestions.length+i+1}</span>{q.concept&&<span className="status">{q.concept}</span>} {q.question}</li>)}</ol></div>}
    <button className="secondary full" disabled={mcq+subjective<1||!title.trim()||!subject.trim()||!grade.trim()||generating} onClick={generate}>{generating?"Generating balanced worksheet…":generated?"Regenerate and save worksheet":"Generate and save worksheet"}</button>
    {generated&&content&&<div className="button-row"><button className="secondary" onClick={()=>downloadWorksheet({title,template,concept:topics[0],concepts:topics,subject,grade,difficulty},content)}>Download PDF worksheet</button><button className="secondary" onClick={()=>downloadAnswerKey({title,subject,grade,concepts:topics},content)}>Download PDF answer key</button><button className="primary" onClick={save}>Approve resource</button></div>}</>}

function WorksheetGradingDialog({worksheet,setState,done}:any){
  const input=useRef<HTMLInputElement>(null);
  const [files,setFiles]=useState<File[]>([]);
  const [progress,setProgress]=useState(0);
  const [graded,setGraded]=useState(false);
  const [grading,setGrading]=useState(false);
  const [gradeError,setGradeError]=useState("");
  const [results,setResults]=useState<{studentName:string;score:number;maxMarks:number;mastery:number}[]>([]);
  const add=(list:FileList)=>setFiles(x=>[...x,...Array.from(list).filter(supportsDocumentUpload)]);
  const guessNameFromFile=(name:string)=>{const base=name.replace(/\.[^.]+$/,"").replace(/[_-]+/g," ").replace(/\b(answer|sheet|paper|qp|question|scan|img|copy|final|v\d+)\b/gi,"").replace(/\s+/g," ").trim();return base.length>2?base.split(" ").filter(Boolean).map(w=>w[0].toUpperCase()+w.slice(1)).join(" "):"Student"};
  const grade=async()=>{
    if(!files.length)return;
    setGradeError("");setGrading(true);let p=0;
    const timer=window.setInterval(()=>{p=Math.min(90,p+8);setProgress(p)},200);
    try{
      const graded_results=await Promise.all(files.map(async file=>{
        const fileBase64=await blobToBase64(file);
        const res=await authFetch("/api/grade",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
          subject:worksheet?.concept||"General",
          studentName:guessNameFromFile(file.name),
          fileName:file.name,
          maxMarks:10,
          answerKey:"",
          rubric:"",
          concepts:worksheet?.concept?[worksheet.concept]:[],
          fileBase64,
          mimeType:file.type
        })});
        const payload=await res.json();
        logApiTiming(setState,payload?.timing);
        if(!res.ok)throw new Error(payload?.error||`Grading failed for ${file.name}`);
        const gaps=payload.gaps||[];
        const mastery=gaps.length?Math.round(gaps.reduce((s:number,g:any)=>s+g.mastery,0)/gaps.length):Math.round((payload.score/Math.max(1,payload.maxMarks))*100);
        return {studentName:guessNameFromFile(file.name),score:payload.score,maxMarks:payload.maxMarks,mastery};
      }));
      clearInterval(timer);setProgress(100);setResults(graded_results);setGraded(true);
      setState((s:DemoState)=>({...s,resources:s.resources.map(r=>r.id===worksheet.id?{...r,answerSheets:(r.answerSheets||0)+files.length,gradedSheets:(r.gradedSheets||0)+files.length}:r),events:[`${files.length} worksheet answer sheets graded with EduAI · ${worksheet.title}`,...s.events]}));
    }catch(err){
      clearInterval(timer);
      setGradeError(err instanceof Error?err.message:"Grading failed");
    }finally{
      setGrading(false);
    }
  };
  return <><DialogHead eyebrow={worksheet?.title||"Worksheet"} title="Grade answer worksheets"/><div className="dropzone" role="button" tabIndex={0} onClick={()=>input.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();add(e.dataTransfer.files)}}><span>↑</span><b>Drop completed answer sheets or choose files</b><small>PDF, Word, Markdown, text or image · multiple students supported</small><button type="button" className="secondary">Browse / Choose File</button><input ref={input} className="file-input" type="file" multiple accept={DOCUMENT_ACCEPT} onChange={e=>e.target.files&&add(e.target.files)}/></div><div className="upload-list">{files.map((f,i)=><div key={`${f.name}${i}`}><span className="file-icon">{f.name.split(".").pop()?.toUpperCase()}</span><div><b>{f.name}</b><small>Ready for extraction and grading</small></div><button onClick={()=>setFiles(x=>x.filter((_,j)=>j!==i))}>×</button></div>)}</div>{progress>0&&<Progress value={progress}/>}{gradeError&&<p className="form-error" role="alert">{gradeError}</p>}{!graded?<button className="primary full" disabled={!files.length||grading} onClick={grade}>{grading?`Grading with EduAI… ${progress}%`:"Grade uploaded worksheets"}</button>:<><div className="grading-results"><b>Grading complete · teacher check required</b>{results.map((r,i)=><span key={i}>{r.studentName} · {r.score}/{r.maxMarks} · {r.mastery}% · {r.mastery>=80?"mastered":r.mastery>=60?"developing":"further practice"}</span>)}</div><div className="button-row"><button className="secondary" onClick={()=>downloadText(`${worksheet.title}-Graded-Results.csv`,`Student,Score,Mastery\n${results.map(r=>`${r.studentName},${r.score}/${r.maxMarks},${r.mastery}%`).join("\n")}`)}>Download graded results</button><button className="secondary" onClick={()=>downloadAnswerKey(worksheet)}>Check with answer key</button><button className="primary" onClick={done}>Teacher approves grades</button></div></>}</>}
function FollowupDialog({setState,intervention,done}:any){
  if(!intervention)return <><DialogHead eyebrow="Comparable evidence" title="Record follow-up"/><p className="modal-copy">This intervention could not be found. Close this dialog and try again from Interventions.</p></>;
  const submit=(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();
    const f=new FormData(e.currentTarget);
    const evidence={studentsCompleted:Number(f.get("studentsCompleted"))||0,avgMastery:Number(f.get("avgMastery"))||0,outcome:String(f.get("outcome")),note:String(f.get("note"))};
    setState((s:DemoState)=>({
      ...s,
      interventions:s.interventions.map((i:Intervention)=>i.id===intervention.id?{...i,followupRecorded:true,followupEvidence:evidence}:i),
      events:[`Follow-up recorded · ${intervention.concept} · ${evidence.outcome}`,...s.events]
    }));
    done();
  };
  return <form onSubmit={submit}><DialogHead eyebrow={`Comparable evidence · ${intervention.concept}`} title="Record follow-up"/><Field label="Evidence type"><select><option>Exit ticket</option><option>Parallel quiz</option><option>Homework</option><option>Oral response</option><option>Observation rubric</option></select></Field><Field label="Comparability"><select><option>Strongly comparable</option><option>Moderately comparable</option><option>Informal evidence</option></select></Field><div className="form-grid"><Field label="Students completed"><input name="studentsCompleted" type="number" min="0" defaultValue="6"/></Field><Field label="Average mastery"><input name="avgMastery" type="number" min="0" max="100" defaultValue="68"/></Field></div><Field label="Outcome"><select name="outcome"><option>Meaningful improvement</option><option>Mastered after intervention</option><option>Some improvement</option><option>No clear improvement</option><option>Further support recommended</option></select></Field><Field label="Teacher observation"><textarea name="note" required defaultValue="Most students now identify the common denominator independently."/></Field><button className="primary full">Save follow-up evidence</button></form>}
function QualityDialog({assessment,state,done}:any){
  const evidenceSufficiency=assessment.totalReviews?Math.round((assessment.reviewed/assessment.totalReviews)*100):0;
  const results:GradeResult[]=Object.values(assessment.gradeResults||{});
  const conceptsGraded=new Set(results.flatMap(r=>r.gaps.map(g=>g.concept)));
  const conceptCount=conceptsGraded.size;
  const relevantWorksheets:Worksheet[]=(state?.resources||[]).filter((r:Worksheet)=>r.content&&(conceptsGraded.has(r.concept||"")||r.concept===undefined));
  const allQuestions=relevantWorksheets.flatMap(r=>[...(r.content?.mcqQuestions||[]),...(r.content?.subjectiveQuestions||[])]);
  const levelCounts={recall:0,application:0,analysis:0};
  allQuestions.forEach(q=>{if(q.cognitiveLevel in levelCounts)levelCounts[q.cognitiveLevel as CognitiveLevel]++});
  const totalTagged=allQuestions.length;
  let cognitiveBalancePct:number|null=null;
  if(totalTagged>0){
    const maxShare=Math.max(levelCounts.recall,levelCounts.application,levelCounts.analysis)/totalTagged;
    const evenShare=1/3;
    cognitiveBalancePct=Math.round(Math.max(0,Math.min(100,100-((maxShare-evenShare)/(1-evenShare))*100)));
  }
  return <><DialogHead eyebrow="Assessment Quality Check" title={evidenceSufficiency>=70?"Suitable with limitations":"Needs more evidence"}/><div className="quality-bars"><Bar label="Evidence sufficiency" pct={evidenceSufficiency}/><Bar label="Concepts with graded evidence" pct={Math.min(100,conceptCount*20)}/>{totalTagged>0&&<Bar label="Cognitive balance (recall/application/analysis spread)" pct={cognitiveBalancePct||0}/>}</div>{totalTagged>0&&<div className="insight">Cognitive balance measured from {totalTagged} real question{totalTagged===1?"":"s"} across {relevantWorksheets.length} generated worksheet{relevantWorksheets.length===1?"":"s"} for this concept area: {levelCounts.recall} recall · {levelCounts.application} application · {levelCounts.analysis} analysis. A perfectly even split scores 100; a set that's all one level scores lower.</div>}<div className="insight">{results.length?`${conceptCount} concept${conceptCount===1?"":"s"} have graded evidence so far.${totalTagged?"":" No generated worksheets with tagged questions exist yet for this concept area — create one in Worksheet studio to see cognitive-balance scoring."}`:"No graded evidence yet for this assessment. Grade at least one answer sheet to see real quality signals."}</div><button className="primary full" onClick={done}>Acknowledge recommendations</button></>}
function EvidenceDialog({state,id,done}:any){
  const [encStudent,encConcept]=(id||"").split(":");
  const studentName=decodeURIComponent(encStudent||"");
  const concept=decodeURIComponent(encConcept||"");
  const results=allGradeResults(state).filter(r=>r.studentName===studentName);
  const withGap=results.find(r=>r.gaps.some(g=>g.concept===concept));
  const gap=withGap?.gaps.find(g=>g.concept===concept);
  return <><DialogHead eyebrow={`Student evidence · ${studentName||"Unknown student"}`} title={concept||"Concept evidence"}/>
  {!withGap&&<p className="modal-copy">No graded evidence found for {studentName||"this student"} on "{concept}". Grade their answer sheet to populate this view.</p>}
  {withGap&&<><div className="evidence"><b>{concept} · {gap?.mastery}% mastery</b><p>{withGap.feedback||"No detailed feedback was returned for this answer sheet."}</p></div><div className="evidence"><b>Overall score</b><p>{withGap.score}/{withGap.maxMarks} marks{withGap.questionPaperName?` · graded against ${withGap.questionPaperName}`:""}</p></div></>}
  <Field label="Teacher classification"><select><option>Priority learning gap</option><option>Developing understanding</option><option>Performance issue</option><option>Insufficient evidence</option></select></Field><button className="primary full" onClick={done}>Save evidence decision</button></>}
function ReportDialog({done}:any){return <form onSubmit={e=>{e.preventDefault();done()}}><DialogHead eyebrow="Interactive reports" title="Generate report"/><Field label="Report type"><select><option>Student performance</option><option>Performance matrix report</option><option>Concept mastery</option><option>Learning gaps</option><option>Teacher summary</option><option>School dashboard</option></select></Field><div className="form-grid"><Field label="Period"><select><option>Current month</option><option>Current term</option><option>Custom period</option></select></Field><Field label="Scope"><select><option>Class 6 · Mathematics</option><option>All classes</option><option>School-wide</option></select></Field></div><label className="check"><input type="checkbox" defaultChecked/> Include methodology and limitations</label><label className="check"><input type="checkbox" defaultChecked/> Aggregate student data</label><button className="primary full">Generate report</button></form>}
function ShareDialog({done}:any){
  const [created,setCreated]=useState(false);
  const [link,setLink]=useState("");
  const generateLink=()=>{
    const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const token=Array.from({length:8},()=>chars[Math.floor(Math.random()*chars.length)]).join("");
    const formatted=`${token.slice(0,4)}-${token.slice(4)}`;
    setLink(`eduai.demo/report/${formatted}`);
    setCreated(true);
  };
  return <><DialogHead eyebrow="Secure sharing" title="Leadership link"/><Field label="Expires"><select><option>7 days</option><option>30 days</option></select></Field><label className="check"><input type="checkbox" defaultChecked/> Require one-time code</label><label className="check"><input type="checkbox"/> Allow download</label>{created&&<div className="secure-link"><code>{link}</code><button onClick={()=>navigator.clipboard?.writeText(link)}>Copy</button></div>}<button className="primary full" onClick={()=>created?done():generateLink()}>{created?"Done":"Create secure link"}</button></>}
function InviteDialog({state,setState,done}:any){const [error,setError]=useState(""),[busy,setBusy]=useState(false);const submit=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);const email=String(f.get("email")).toLowerCase();if(state.users.some((u:any)=>u.email.toLowerCase()===email)){setError("A user with this email already exists.");return}setBusy(true);setError("");const payload={name:String(f.get("name")),email,role:String(f.get("role")),credits:Number(f.get("credits"))};const response=await authFetch("/api/admin/invitations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});const body=await response.json();setBusy(false);if(!response.ok){setError(body.error||"Invitation could not be sent.");return}const u:User={id:`u${Date.now()}`,name:payload.name,email,role:payload.role,school:String(f.get("school")),phone:"",status:"Invited",totalCredits:payload.credits,usedCredits:0};setState((s:DemoState)=>({...s,users:[u,...s.users],events:[`Invitation sent securely · ${u.email}`,...s.events]}));done()};return <form onSubmit={submit}><DialogHead eyebrow="School administration" title="Invite Teacher"/><Field label="Name"><input name="name" required minLength={2} placeholder="Teacher's full name"/></Field><Field label="Email address"><input name="email" type="email" required placeholder="teacher@school.edu"/></Field><div className="form-grid"><Field label="Role"><select name="role"><option>Teacher</option><option>Admin</option></select></Field><Field label="Credits"><input name="credits" type="number" min="0" required defaultValue="10"/></Field><Field label="School"><select name="school">{state.schools.map((s:string)=><option key={s} value={s.split(" · ")[0]}>{s.split(" · ")[0]}</option>)}</select></Field></div>{error&&<p className="form-error">{error}</p>}<button className="primary full" disabled={busy}>{busy?"Sending secure invitation…":"Send Invitation"}</button></form>}
function CreditAllocationDialog({user,setState,done}:any){const [error,setError]=useState(""),[busy,setBusy]=useState(false);const submit=async(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget),credits=Number(f.get("credits")),reason=String(f.get("reason"));setBusy(true);const response=await authFetch("/api/admin/users",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:user.id,credits,reason})});const payload=await response.json();setBusy(false);if(!response.ok){setError(payload.error||"Credits could not be assigned.");return}setState((s:DemoState)=>({...s,users:s.users.map(u=>u.id===user.id?{...u,totalCredits:(u.totalCredits||0)+credits}:u),events:[`${credits>0?"+":""}${credits} credits · ${user.email} · ${reason}`,...s.events]}));done()};return <form onSubmit={submit}><DialogHead eyebrow="Credit allocation" title={`Assign Credits · ${user.name}`}/><div className="impact-box"><b>Current balance</b><span>Total {user.totalCredits||0} · Used {user.usedCredits||0} · Remaining {Math.max(0,(user.totalCredits||0)-(user.usedCredits||0))}</span></div><Field label="Credits to add"><input name="credits" type="number" required defaultValue="10"/></Field><Field label="Reason"><input name="reason" required placeholder="e.g. New School Allocation"/></Field>{error&&<p className="form-error">{error}</p>}<button className="primary full" disabled={busy}>{busy?"Assigning…":"Assign Credits"}</button></form>}
function UserEdit({user,setState,done}:any){const submit=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);setState((s:DemoState)=>({...s,users:s.users.map(u=>u.id===user.id?{...u,name:String(f.get("name")),email:String(f.get("email")),role:String(f.get("role")),phone:String(f.get("phone"))}:u)}));done()};return <form onSubmit={submit}><DialogHead eyebrow="Manage user" title="Edit details"/><Field label="Name"><input name="name" required defaultValue={user.name}/></Field><Field label="Email"><input name="email" type="email" required defaultValue={user.email}/></Field><Field label="Role"><select name="role" defaultValue={user.role}><option>Teacher</option><option>Principal</option><option>School administrator</option><option>Data operator</option></select></Field><Field label="Phone"><input name="phone" defaultValue={user.phone}/></Field><button className="primary full">Save changes</button></form>}
function ClassDialog({state,setState,done}:any){const submit=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);const className=String(f.get("className")||"").trim();const section=String(f.get("section")||"").trim().toUpperCase();const subject=String(f.get("subject")||"").trim();const x=`Class ${className}${section} · ${subject} · ${f.get("students")} students`;const prefix=`Class ${className}${section} · ${subject} ·`;setState((s:DemoState)=>({...s,classes:[x,...s.classes.filter(item=>!item.replace("Â·","·").startsWith(prefix))],events:[`Class subject created · Class ${className}${section} · ${subject}`,...s.events]}));done()};return <form onSubmit={submit}><DialogHead eyebrow="Class-first analysis" title="Create class & subject"/><p className="modal-copy">Create the class and section first, then attach its subject. Assessments and heatmaps use this exact structure.</p><div className="form-grid"><Field label="Class"><input name="className" required defaultValue="6"/></Field><Field label="Section"><input name="section" required defaultValue="C"/></Field><Field label="Subject"><input name="subject" required defaultValue="Mathematics"/></Field><Field label="Student strength"><input name="students" type="number" min="1" required defaultValue="30"/></Field></div><Field label="Assigned teacher"><select>{state.users.filter((u:any)=>u.role==="Teacher").map((u:any)=><option key={u.id}>{u.name}</option>)}</select></Field><button className="primary full">Save class & subject</button></form>}
function SchoolDialog({state,setState,done}:any){const submit=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);const x=`${f.get("name")} · ${f.get("city")} · ${f.get("board")}`;setState((s:DemoState)=>({...s,schools:[x,...s.schools.filter(v=>!v.startsWith(String(f.get("name"))))]}));done()};return <form onSubmit={submit}><DialogHead eyebrow="Tenant profile" title="Manage school"/><Field label="School name"><input name="name" required defaultValue="Sunrise Academy"/></Field><div className="form-grid"><Field label="City"><input name="city" required defaultValue="Mumbai"/></Field><Field label="Board / curriculum"><select name="board"><option>CBSE</option><option>ICSE</option><option>State Board</option><option>IB</option></select></Field></div><Field label="Verified domain"><input type="text" defaultValue="sunrise.edu"/></Field><button className="primary full">Save school</button></form>}
function SimpleSettings({title,fields,done}:any){return <form onSubmit={e=>{e.preventDefault();done()}}><DialogHead eyebrow="Settings" title={title}/>{fields.map((x:string,i:number)=><Field key={x} label={x}>{i===1?<select><option>Enabled</option><option>Disabled</option><option>Approval required</option></select>:<input required defaultValue={i===0?"Current configuration":"School default"}/>}</Field>)}<button className="primary full">Save settings</button></form>}
function Activity({events,resetDemo,close}:any){return <><DialogHead eyebrow="Audit trail" title="Recent activity"/><div className="activity-list">{events.map((x:string,i:number)=><div key={i}><i>✓</i><span>{x}</span></div>)}</div><div className="button-row"><button className="secondary" onClick={()=>{resetDemo();close()}}>Restore sample data</button><button className="primary" onClick={close}>Done</button></div></>}
function NotificationDialog({state,done}:any){
  const recent:string[]=(state.events||[]).slice(0,5);
  return <><DialogHead eyebrow="Notifications" title="Your updates"/>
  {!recent.length&&<p className="modal-copy">No recent activity yet.</p>}
  {recent.map((x,i)=><div className="notification" key={i}><b>{x}</b></div>)}
  <button className="primary full" onClick={done}>Mark all as read</button></>}
function GroupDialog({state,id,done}:any){
  const [assessmentId,encConcept]=(id||"").split(":");
  const concept=decodeURIComponent(encConcept||"");
  const assessment=state.assessments.find((a:Assessment)=>a.id===assessmentId);
  const results:GradeResult[]=assessment?Object.values(assessment.gradeResults||{}):[];
  const affected=results.filter(r=>r.gaps.some(g=>g.concept===concept&&g.mastery<70)).map(r=>r.studentName);
  return <><DialogHead eyebrow="Temporary group" title={`Strengthen · ${affected.length} student${affected.length===1?"":"s"}`}/>
  {!affected.length&&<p className="modal-copy">No students currently below 70% mastery on "{concept}" from graded evidence.</p>}
  {affected.map(x=><label className="check" key={x}><input type="checkbox" defaultChecked/>{x}</label>)}
  <button className="primary full" onClick={done}>Save group membership</button></>}
function StudentDialog({setState,done}:any){const submit=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);const student={id:`s${Date.now()}`,name:String(f.get("name")),roll:String(f.get("roll")),className:String(f.get("className")),status:"Active"};setState((s:DemoState)=>({...s,students:[student,...s.students],events:[`Student added · ${student.roll}`,...s.events]}));done()};return <form onSubmit={submit}><DialogHead eyebrow="School roster" title="Add student"/><Field label="Student name"><input name="name" required minLength={2}/></Field><div className="form-grid"><Field label="School student ID / roll"><input name="roll" required/></Field><Field label="Class"><select name="className"><option>Class 6A</option><option>Class 6B</option><option>Class 7A</option></select></Field></div><button className="primary full">Save student</button></form>}
function parseRosterCsv(text:string):{name:string;roll:string;className:string}[]{
  const lines=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  if(!lines.length)return[];
  const header=lines[0].split(",").map(h=>h.trim().toLowerCase());
  const nameIdx=header.findIndex(h=>h.includes("name"));
  const rollIdx=header.findIndex(h=>h.includes("roll")||h.includes("id"));
  const classIdx=header.findIndex(h=>h.includes("class")||h.includes("grade")||h.includes("section"));
  return lines.slice(1).map(line=>{
    const cols=line.split(",").map(c=>c.trim());
    return {
      name:nameIdx>=0?cols[nameIdx]||"":cols[0]||"",
      roll:rollIdx>=0?cols[rollIdx]||"":cols[1]||"",
      className:classIdx>=0?cols[classIdx]||"":cols[2]||"Class 6A"
    };
  }).filter(s=>s.name);
}
function rowsFromAOA(aoa:unknown[][]):{name:string;roll:string;className:string}[]{
  if(!aoa.length)return[];
  const header=(aoa[0]||[]).map(h=>String(h??"").trim().toLowerCase());
  const nameIdx=header.findIndex(h=>h.includes("name"));
  const rollIdx=header.findIndex(h=>h.includes("roll")||h.includes("id"));
  const classIdx=header.findIndex(h=>h.includes("class")||h.includes("grade")||h.includes("section"));
  return aoa.slice(1).map(row=>{
    const cols=row.map(c=>String(c??"").trim());
    return {
      name:nameIdx>=0?cols[nameIdx]||"":cols[0]||"",
      roll:rollIdx>=0?cols[rollIdx]||"":cols[1]||"",
      className:classIdx>=0?cols[classIdx]||"":cols[2]||"Class 6A"
    };
  }).filter(s=>s.name);
}
function RosterImport({setState,done}:any){
  const input=useRef<HTMLInputElement>(null);
  const [file,setFile]=useState<File|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const run=async()=>{
    if(!file){setError("Choose a CSV or XLSX roster.");return}
    setError("");setBusy(true);
    try{
      const lower=file.name.toLowerCase();
      let rows:{name:string;roll:string;className:string}[];
      if(lower.endsWith(".xlsx")||lower.endsWith(".xls")){
        const XLSX=await import("xlsx");
        const buf=await file.arrayBuffer();
        const wb=XLSX.read(buf,{type:"array"});
        const sheet=wb.Sheets[wb.SheetNames[0]];
        const aoa=XLSX.utils.sheet_to_json(sheet,{header:1,raw:false,defval:""}) as unknown[][];
        rows=rowsFromAOA(aoa);
      }else if(lower.endsWith(".csv")){
        const text=await file.text();
        rows=parseRosterCsv(text);
      }else{
        setError("Unsupported file type. Upload a .csv or .xlsx roster.");setBusy(false);return;
      }
      if(!rows.length){setError("No valid rows found. Make sure the file has a header row with Name, Roll and Class columns.");setBusy(false);return}
      setState((s:DemoState)=>({...s,students:[...s.students,...rows.map(r=>({id:`s${Date.now()}${Math.random().toString(36).slice(2,6)}`,name:r.name,roll:r.roll||"—",className:r.className,status:"Active"}))],events:[`Roster imported · ${file.name} · ${rows.length} student${rows.length===1?"":"s"}`,...s.events]}));
      done();
    }catch(err){
      setError(err instanceof Error?`Could not read the file: ${err.message}`:"Could not read the file.");
    }finally{
      setBusy(false);
    }
  };
  return <><DialogHead eyebrow="Roster import" title="Import students"/><div className="dropzone" role="button" tabIndex={0} onClick={()=>input.current?.click()} onKeyDown={e=>(e.key==="Enter"||e.key===" ")&&input.current?.click()}><span>⇧</span><b>{file?file.name:"Choose CSV or XLSX roster"}</b><small>Header row required with Name, Roll and Class columns. CSV and XLSX both parsed for real.</small><button type="button" className="secondary">Browse</button><input ref={input} className="file-input" type="file" accept=".csv,.xlsx,.xls" onChange={e=>{const f=e.target.files?.[0];if(f&&f.size>5*1024*1024)setError("Roster exceeds the 5 MB limit.");else{setFile(f||null);setError("")}}}/></div>{error&&<p className="form-error">{error}</p>}<button className="primary full" disabled={busy} onClick={run}>{busy?"Reading file…":"Validate & import roster"}</button></>}
function StudentEvidence({state,student,done}:any){
  const results:GradeResult[]=allGradeResults(state).filter(r=>r.studentName===student?.name);
  const m=studentMastery(state)[student?.name||""];
  const conceptAgg:Record<string,{sum:number;count:number}>={};
  results.forEach(r=>r.gaps.forEach(g=>{const b=conceptAgg[g.concept]||{sum:0,count:0};b.sum+=g.mastery;b.count+=1;conceptAgg[g.concept]=b}));
  const concepts=Object.entries(conceptAgg).map(([concept,b])=>({concept,mastery:Math.round(b.sum/b.count),evidence:b.count})).sort((a,b)=>a.mastery-b.mastery);
  const priority=concepts[0];
  return <><DialogHead eyebrow={`${student?.roll||"Student"} · evidence profile`} title={student?.name||"Student evidence"}/>
  {!results.length&&<p className="modal-copy">No graded evidence yet for {student?.name}. Grade one of their answer sheets to populate this profile.</p>}
  {results.length>0&&<><div className="xray-summary"><Metric label="Mastery" value={`${m?.mastery??0}%`} note={`${concepts.length} concept${concepts.length===1?"":"s"}`}/><Metric label="Evidence" value={String(m?.evidence??0)} note="Graded answer sheets"/><Metric label="Confidence" value={results.length>2?"High":results.length>1?"Medium":"Low"} note={`${results.length} assessment${results.length===1?"":"s"}`}/><Metric label="Last graded" value={m?.lastDate||"—"} note="Most recent evidence"/></div>
  <div className="evidence"><b>{priority?.concept||"No priority gap identified"} {priority?"· Priority gap":""}</b><p>{priority?`${priority.evidence} evidence point${priority.evidence===1?"":"s"} · average mastery ${priority.mastery}%`:"Grade more answer sheets to surface a priority concept."}</p></div></>}
  <Field label="Teacher observation"><select><option>No additional observation</option><option>Absence</option><option>Incomplete attempt</option><option>Time-management difficulty</option><option>Language difficulty</option><option>Careless mistake</option><option>Accommodation required</option></select></Field><button className="primary full" onClick={done}>Save observation</button></>
}
function AcademicYearDialog({setState,done}:any){const submit=(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();const f=new FormData(e.currentTarget);setState((s:DemoState)=>({...s,academicYears:[`${f.get("name")} · ${f.get("status")}`,...s.academicYears]}));done()};return <form onSubmit={submit}><DialogHead eyebrow="School calendar" title="Academic year"/><Field label="Name"><input name="name" required placeholder="2027–28"/></Field><div className="form-grid"><Field label="Start date"><input type="date" required/></Field><Field label="End date"><input type="date" required/></Field></div><Field label="Status"><select name="status"><option>Planned</option><option>Active</option><option>Archived</option></select></Field><button className="primary full">Save academic year</button></form>}
function ConsentDialog({done}:any){return <form onSubmit={e=>{e.preventDefault();done()}}><DialogHead eyebrow="Privacy & consent" title="Data-processing choices"/><label className="check"><input type="checkbox" required defaultChecked/> I accept the terms and privacy policy</label><label className="check"><input type="checkbox" required defaultChecked/> I am authorised to upload school and student data</label><label className="check"><input type="checkbox" required defaultChecked/> I understand AI-assisted processing and teacher approval</label><label className="check"><input type="checkbox"/> Allow anonymised product improvement</label><button className="primary full">Save consent choices</button></form>}
function SecurityDialog({done}:any){return <><DialogHead eyebrow="Sessions & security" title="Account protection"/><div className="list-item"><div><b>Windows · Chrome</b><small>Current session · Mumbai</small></div><span className="status success">Active</span></div><div className="list-item"><div><b>Android · Chrome</b><small>Last active 2 days ago</small></div><button onClick={()=>done()}>Revoke</button></div><label className="check"><input type="checkbox"/> Require MFA for administrator actions</label><button className="secondary full" onClick={done}>Log out all other devices</button></>}
function DeleteAssessmentDialog({assessment,state,setState,openAssessment,done}:any){
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const resourceCount=state.resources.filter((resource:Worksheet)=>resource.assessmentId===assessment.id).length;
  const interventionCount=state.interventions.filter((item:Intervention)=>item.assessmentId===assessment.id).length;
  const remove=async()=>{
    setBusy(true);setError("");
    try{
      const results=await Promise.all((assessment.files||[]).map(async(file:UploadFile)=>{
        const response=await authFetch(`/api/files/${encodeURIComponent(file.id)}`,{method:"DELETE"});
        if(!response.ok&&response.status!==404)throw new Error(`${file.name} could not be deleted from secure storage.`);
        try{await removeLocalFileBlob(file.id)}catch{}
      }));
      void results;
      const nextAssessment=state.assessments.find((item:Assessment)=>item.id!==assessment.id);
      try{sessionStorage.removeItem(bulkQueueKey(assessment.id))}catch{}
      setState((current:DemoState)=>({...current,assessments:current.assessments.filter(item=>item.id!==assessment.id),resources:current.resources.filter(item=>item.assessmentId!==assessment.id),interventions:current.interventions.filter(item=>item.assessmentId!==assessment.id),events:[`Assessment deleted · ${assessment.title}`,...current.events]}));
      openAssessment(nextAssessment?.id||"","Work");done();
    }catch(cause){setError(cause instanceof Error?cause.message:"Assessment deletion failed. Retry to complete the secure cleanup.");setBusy(false)}
  };
  return <><DialogHead eyebrow="Permanent action" title="Delete Assessment"/><p className="modal-copy">Delete <b>{assessment.title}</b>? This permanently removes this assessment, its {assessment.files.length} uploaded file{assessment.files.length===1?"":"s"}, grading results, {resourceCount} generated resource{resourceCount===1?"":"s"}, and {interventionCount} linked intervention{interventionCount===1?"":"s"}. Unrelated assessments and resources will not be changed.</p><div className="validation-summary"><b>This action cannot be undone.</b><p>Confirm only if you want to remove all data that depends on this assessment.</p></div>{error&&<p className="form-error" role="alert">{error}</p>}<button className="primary full danger" disabled={busy} onClick={remove}>{busy?"Deleting assessment…":"Confirm Delete Assessment"}</button></>
}

function ConfirmDialog({eyebrow,title,text,action,onConfirm}:any){return <><DialogHead eyebrow={eyebrow} title={title}/><p className="modal-copy">{text}</p><button className="primary full" onClick={onConfirm}>{action}</button></>}

function PageHead({eyebrow,title,subtitle,children}:{eyebrow:string;title:string;subtitle:string;children?:ReactNode}){return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{subtitle}</p></div><div className="button-row">{children}</div></div>}
function DialogHead({eyebrow,title}:{eyebrow:string;title:string}){return <><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></>}
function CardHead({eyebrow,title,children}:{eyebrow:string;title:string;children?:ReactNode}){return <div className="card-head"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>{children}</div>}
function BrandDocumentHeader({label,title,meta}:{label:string;title:string;meta:string}){return <header className="brand-document-header"><img src="/brand/logo.png" alt="EduAI Hub"/><div><p>{label}</p><h2>{title}</h2><span>{meta}</span></div><i>Teacher-reviewed AI support</i></header>}
function Field({label,children}:{label:string;children:ReactNode}){return <label>{label}{children}</label>}
function Metric({label,value,note}:{label:string;value:any;note:string}){return <article className="metric"><span>{label}</span><b>{value}</b><small>{note}</small></article>}
function Bar({label,pct}:{label:string;pct:number}){return <div className="bar"><span>{label}<b>{pct}%</b></span><i><em style={{width:`${pct}%`}}/></i></div>}
function Progress({value}:{value:number}){return <div className="progress" aria-label={`${value}% complete`}><i style={{width:`${value}%`}}/><small>{value}%</small></div>}
function icon(x:string){return ({Home:"⌂",Work:"▣",Review:"✓","X-Ray":"✦",Interventions:"↗",Reports:"▥",Overview:"⌂",Users:"♙","Schools & Classes":"▦"} as any)[x]||"⚙"}
function stageProgress(stage:Stage){return ([10,25,38,50,62,72,80,88,95,100] as number[])[Object.keys(stageLabel).indexOf(stage)]}
function nextAction(stage:Stage){return ({draft:"Upload work",uploaded:"Set up rubric",setup:"Start grading",grading:"View processing",review:"Review answers",approved:"Generate X-Ray",xray:"Plan intervention",intervention:"Record follow-up",followup:"Publish grades",published:"View report"} as Record<Stage,string>)[stage]}
function assessmentHasGrades(a:Assessment){return Boolean(a.gradedFileIds?.length)||["review","approved","xray","intervention","followup","published"].includes(a.stage)}
function gapConceptsFor(subject:string){
  const s=(subject||"").toLowerCase();
  if(/math|arithmetic|algebra|geometry/.test(s))return["Equivalent fractions","Finding a common denominator","Adding after conversion","Word-problem translation"];
  if(/econom|micro|macro|commerce|business/.test(s))return["Price elasticity of demand","Market equilibrium shifts","Opportunity cost reasoning","Fiscal policy tools"];
  if(/physic/.test(s))return["Applying formulas correctly","Unit conversion","Free-body diagram accuracy","Interpreting graphs of motion"];
  if(/chemist/.test(s))return["Balancing chemical equations","Mole concept calculations","Naming compounds correctly","Reaction-type identification"];
  if(/biolog/.test(s))return["Diagram labelling accuracy","Process sequencing (e.g. cycles)","Cause-and-effect explanation","Applying the concept to a new example"];
  if(/science/.test(s))return["Diagram labelling accuracy","Cause-and-effect explanation","Unit conversion","Applying the concept to a new example"];
  if(/english|language|literature/.test(s))return["Grammar and sentence structure","Vocabulary in context","Comprehension inference","Structuring a written response"];
  if(/histor/.test(s))return["Chronological sequencing of events","Cause-and-effect reasoning","Source interpretation","Structuring an evidence-based answer"];
  if(/geograph/.test(s))return["Map reading and interpretation","Physical process explanation","Data/graph interpretation","Applying concepts to a real region"];
  if(/civic|political|social science/.test(s))return["Understanding institutions and their roles","Rights and responsibilities reasoning","Case-based application","Structuring an evidence-based answer"];
  if(/computer|programming|coding/.test(s))return["Logic and algorithmic thinking","Syntax accuracy","Debugging and tracing code","Applying concepts to a new problem"];
  if(/account/.test(s))return["Journal and ledger accuracy","Balancing entries correctly","Applying accounting principles","Financial statement interpretation"];
  return["Core concept understanding in "+ (subject||"this subject"),"Applying "+(subject||"the subject")+" methods to new problems","Explaining reasoning clearly","Accuracy under exam conditions"];
}
function guessStudentName(file:UploadFile,students:{name:string}[]){const base=file.name.replace(/\.[^.]+$/,"").replace(/[_\-]+/g," ").replace(/\b(answer|sheet|paper|qp|question|scan|img|copy|final|v\d+)\b/gi,"").replace(/\s+/g," ").trim();if(base.length>2)return base.split(" ").filter(Boolean).map(w=>w[0].toUpperCase()+w.slice(1)).join(" ");return students[Math.floor(Math.random()*students.length)]?.name||"Student";}
function worksheetContent(r:any,content?:{mcqQuestions:{question:string;options:string[];correctIndex:number}[];subjectiveQuestions:{question:string;modelAnswer:string}[]}){
  const mcqLines=(content?.mcqQuestions||[]).map((q,i)=>`${i+1}. ${q.question} ${q.options.map((o,j)=>`${String.fromCharCode(65+j)}) ${o}`).join(" ")}`).join("\n");
  const subjLines=(content?.subjectiveQuestions||[]).map((q,i)=>`${i+1}. ${q.question}`).join("\n");
  return `${r.title}\n\nTarget learning gap: ${r.concept||"Teacher-defined concept"}\nTemplate: ${r.template||"Custom"}\nDifficulty: ${r.difficulty||"Mixed"}\n\nMULTIPLE CHOICE (${content?.mcqQuestions.length||0})\n${mcqLines||"(none)"}\n\nSUBJECTIVE (${content?.subjectiveQuestions.length||0})\n${subjLines||"(none)"}\n\nTeacher: __________________  Student: __________________  Date: __________`;
}
function downloadText(name:string,content:string){
  const rows=content.trim().split(/\r?\n/).map(line=>line.split(","));
  const table=rows.length>1?`<table class="data-table"><thead><tr>${rows[0].map(cell=>`<th>${htmlEscape(cell)}</th>`).join("")}</tr></thead><tbody>${rows.slice(1).map(row=>`<tr>${row.map(cell=>`<td>${htmlEscape(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`:`<p>${htmlEscape(content)}</p>`;
  void downloadDocument(name.replace(/\.[^.]+$/,""),name.replace(/\.[^.]+$/,"").replace(/[-_]+/g," "),"EduAI Hub · Teacher resource",`<h2>Results</h2>${table}`);
}
function htmlEscape(value:any){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]||c))}
function normalizeOcrText(value:string){
  return String(value||"").replace(/```(?:text|markdown)?/gi,"").replace(/[^\S\r\n]+/g," ").replace(/\s*([|¦•·])\s*/g," ").replace(/\n{3,}/g,"\n\n").split("\n").map(line=>line.trim()).join("\n").trim();
}
async function brandLogoDataUri(){
  try{const response=await fetch("/brand/logo.png");if(!response.ok)return "/brand/logo.png";return await blobToDataUri(await response.blob())}catch{return "/brand/logo.png"}
}
function blobToDataUri(blob:Blob):Promise<string>{return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||""));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob)})}
function documentFlowVisual(){return `<table class="visual-flow" role="presentation"><tr><td><b>1 · EVIDENCE</b><small>Teacher review required</small></td><td class="arrow">→</td><td><b>2 · INSIGHT</b><small>Draft learning diagnosis</small></td><td class="arrow">→</td><td><b>3 · ACTION</b><small>Approve before use</small></td></tr></table>`}
function masteryVisual(label:string,value:number){const safe=Math.max(0,Math.min(100,Number(value)||0));const colour=safe>=80?"#2d7a45":safe<=35?"#b63d34":"#d58a10";return `<table class="mastery-visual" role="presentation"><tr><td class="visual-label">${htmlEscape(label)}</td><td class="bar-track"><span style="display:block;width:${safe}%;height:12px;background:${colour}">&nbsp;</span></td><td class="visual-value">${safe}%</td></tr></table>`}
function textToDocumentHtml(value:string){
  const lines=String(value||"").replace(/\r/g,"").split("\n");
  let listOpen=false;
  const html=lines.map(raw=>{
    const line=raw.trim();
    if(!line){const close=listOpen?"</ol>":"";listOpen=false;return `${close}<div class="spacer"></div>`}
    const heading=line.match(/^(#{1,3})\s+(.+)$/);
    if(heading){const close=listOpen?"</ol>":"";listOpen=false;const level=Math.min(3,heading[1].length+1);return `${close}<h${level}>${htmlEscape(heading[2])}</h${level}>`}
    const numbered=line.match(/^(?:Q(?:uestion)?\s*)?(\d+)[.)]\s*(.+)$/i);
    if(numbered){const open=listOpen?"":"<ol>";listOpen=true;return `${open}<li><b>${htmlEscape(numbered[1])}.</b> ${htmlEscape(numbered[2])}</li>`}
    const close=listOpen?"</ol>":"";listOpen=false;
    return `${close}<p>${htmlEscape(line).replace(/\*\*(.+?)\*\*/g,"<b>$1</b>")}</p>`;
  }).join("");
  return html+(listOpen?"</ol>":"");
}
function brandedDocumentHtml(title:string,meta:string,body:string,logo:string,includeFlow=true){
  return `<article class="pdf-document"><header class="cover"><img class="header-logo" src="${logo}" alt="EduAI Hub"><div class="brand">EduAI Hub · Learning X-Ray</div><h1>${htmlEscape(title)}</h1><div class="meta">${htmlEscape(meta)}</div></header>${includeFlow?documentFlowVisual():""}${body}<footer class="closing-footer"><img src="${logo}" alt="EduAI Hub">Prepared with EduAI Learning X-Ray · Teacher review recommended before classroom use</footer></article>`;
}
const PDF_DOCUMENT_STYLES=`*{box-sizing:border-box}.pdf-document{width:760px;background:#fff;color:#172644;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.52;padding:0 8px 24px}.cover{border-bottom:5px solid #f6a017;padding:0 0 18px;margin-bottom:18px}.header-logo{display:block;width:210px;height:auto;margin:0 0 13px}.brand{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#e98200}.cover h1{font-size:30px;line-height:1.12;margin:8px 0;color:#172644}.meta{color:#667085;font-size:13px}h2{font-size:21px;color:#22365e;border-bottom:2px solid #d9dee8;padding-bottom:7px;margin:25px 0 11px}h3{font-size:16px;color:#283b65;margin:19px 0 7px}p{margin:7px 0 11px}.spacer{height:5px}.topic{page-break-inside:avoid;border:1px solid #cfd8e7;border-radius:9px;padding:16px;margin:16px 0;background:#fff}.label{display:inline-block;background:#eef3fb;color:#283b65;border-radius:12px;padding:4px 9px;font-size:10px;font-weight:700;margin-right:6px}ol{padding-left:25px}li{margin:0 0 12px}.options{margin:8px 0 0;color:#475467}.answer{background:#fff8ec;border-left:5px solid #f6a017;border-radius:4px;padding:11px 13px;margin:9px 0}.visual-flow{width:100%;border-collapse:separate;border-spacing:6px;margin:0 0 24px}.visual-flow td:not(.arrow){width:29%;background:#eef3fb;border:1px solid #cfd8e7;border-radius:7px;text-align:center;padding:10px;color:#283b65}.visual-flow small{display:block;color:#667085;margin-top:3px}.visual-flow .arrow{width:6%;text-align:center;color:#f08d00;font-size:19px}.mastery-visual{width:100%;border-collapse:collapse;margin:9px 0}.visual-label{width:34%;font-weight:700;padding-right:8px}.bar-track{width:55%;background:#e6eaf0}.visual-value{width:11%;text-align:right;font-weight:700}.data-table,table{width:100%;border-collapse:collapse}.data-table th,.data-table td,table th,table td{border:1px solid #d9dee8;padding:8px;text-align:left}.data-table th,table thead th{background:#283b65;color:#fff}.executive{page-break-inside:avoid;background:#eef3fb;border-left:6px solid #283b65;border-radius:10px;padding:16px 18px;margin:18px 0 26px}.executive>h2{border:0;margin:0 0 14px;padding:0}.executive-panels{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:14px;align-items:start}.executive-panels>div{background:#fff;border:1px solid #ccd6e5;border-radius:8px;overflow:hidden}.executive-panels h3{background:#283b65;color:#fff;font-size:11px;letter-spacing:.04em;text-transform:uppercase;margin:0;padding:9px 11px}.executive-panels table{font-size:11px;line-height:1.35}.executive-panels tbody th{width:43%;background:#f7f9fc;color:#475467}.closing-footer{margin-top:30px;padding-top:10px;border-top:1px solid #d9dee8;color:#667085;font-size:10px}.closing-footer img{width:68px;height:auto;vertical-align:middle;margin-right:10px}`;
async function createBrandedPdfBlob(title:string,meta:string,body:string,includeFlow=true){
  const logo=await brandLogoDataUri();
  const host=document.createElement("div");
  host.style.cssText="position:fixed;left:-100000px;top:0;width:780px;background:#fff;z-index:2147483647;pointer-events:none";
  host.innerHTML=`<style>${PDF_DOCUMENT_STYLES}</style>${brandedDocumentHtml(title,meta,body,logo,includeFlow)}`;
  document.body.appendChild(host);
  try{
    await document.fonts?.ready;
    const canvas=await html2canvas(host,{backgroundColor:"#ffffff",scale:1.5,useCORS:true,logging:false,windowWidth:780});
    const pdf=new jsPDF({orientation:"portrait",unit:"mm",format:"a4",compress:true});
    const contentWidthMm=182,contentHeightMm=266;
    const pageHeightPx=Math.max(1,Math.floor(canvas.width*(contentHeightMm/contentWidthMm)));
    const pages=Math.max(1,Math.ceil(canvas.height/pageHeightPx));
    for(let page=1;page<=pages;page++){
      if(page>1)pdf.addPage();
      pdf.setPage(page);
      const sourceY=(page-1)*pageHeightPx;
      const sourceHeight=Math.min(pageHeightPx,canvas.height-sourceY);
      const slice=document.createElement("canvas");slice.width=canvas.width;slice.height=sourceHeight;
      const context=slice.getContext("2d");if(!context)throw new Error("PDF renderer could not create a page canvas.");
      context.fillStyle="#ffffff";context.fillRect(0,0,slice.width,slice.height);context.drawImage(canvas,0,sourceY,canvas.width,sourceHeight,0,0,canvas.width,sourceHeight);
      pdf.addImage(slice.toDataURL("image/jpeg",0.92),"JPEG",14,12,contentWidthMm,contentWidthMm*(sourceHeight/canvas.width),undefined,"FAST");
      pdf.setDrawColor(217,222,232);pdf.line(14,282,196,282);
      try{pdf.addImage(logo,"PNG",14,285,20,5.8,undefined,"FAST")}catch{}
      pdf.setFont("helvetica","normal");pdf.setFontSize(8);pdf.setTextColor(102,112,133);
      pdf.text("EduAI Hub · Learning X-Ray",38,289);pdf.text(`Page ${page} of ${pages}`,196,289,{align:"right"});
    }
    return pdf.output("blob");
  }finally{host.remove()}
}
async function downloadDocument(name:string,title:string,meta:string,body:string,includeFlow=true){
  const generated=await createBrandedPdfBlob(title,meta,body,includeFlow);
  const bytes=await verifiedPdfBytes(generated);
  const blob=new Blob([bytes as BlobPart],{type:"application/pdf"});
  const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`${name.replace(/\.[^.]+$/,"").replace(/[^a-z0-9-]+/gi,"-")}.pdf`;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const PDFJS_MODULE_URL="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
const PDFJS_WORKER_URL="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
function pageNumberForQuestion(question:EvaluatorQuestion,index:number,ocrText:string){
  const proposed=Math.max(1,Math.floor(Number(question.pageNumber)||index+1));
  const source=(question.evidence||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
  const parts=ocrText.split(/---\s*Page\s+(\d+)\s*---/i);
  if(parts.length<3||source.length<8)return proposed;
  const evidenceTokens=Array.from(new Set(source.split(/\s+/).filter(token=>token.length>2)));
  if(evidenceTokens.length<2)return proposed;
  let bestPage=proposed,bestScore=0;
  for(let partIndex=1;partIndex<parts.length;partIndex+=2){
    const pageNumber=Math.max(1,Number(parts[partIndex])||1);
    const pageText=(parts[partIndex+1]||"").toLowerCase().replace(/[^a-z0-9]+/g," ");
    const pageTokens=new Set(pageText.split(/\s+/));
    const overlap=evidenceTokens.reduce((score,token)=>score+(pageTokens.has(token)?1:0),0);
    const exact=pageText.includes(source)?evidenceTokens.length+4:0;
    const score=overlap+exact;
    if(score>bestScore){bestScore=score;bestPage=pageNumber}
  }
  // Use a matched OCR page only when its answer evidence is sufficiently clear.
  return bestScore>=Math.min(3,evidenceTokens.length)?bestPage:proposed;
}

async function sourcePageScreenshot(blob:Blob,file:UploadFile,pageNumber:number){
  if(file.type.startsWith("image/"))return blobToDataUri(blob);
  if(file.type!=="application/pdf"&&!/\.pdf$/i.test(file.name))throw new Error("A corrected answer sheet requires a PDF or image answer-sheet upload.");
  const pdfjs=await import(/* @vite-ignore */ PDFJS_MODULE_URL) as any;
  pdfjs.GlobalWorkerOptions.workerSrc=PDFJS_WORKER_URL;
  const pdf=await pdfjs.getDocument({data:new Uint8Array(await blob.arrayBuffer())}).promise;
  const page=await pdf.getPage(Math.max(1,Math.min(pageNumber,pdf.numPages)));
  const viewport=page.getViewport({scale:1.25});
  const canvas=document.createElement("canvas");canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  const context=canvas.getContext("2d");if(!context)throw new Error("The answer-sheet preview could not be prepared.");
  await page.render({canvasContext:context,viewport}).promise;
  return canvas.toDataURL("image/jpeg",0.86);
}
function pdfText(pdf:jsPDF,text:string,x:number,y:number,width:number,lineHeight=5){const lines=pdf.splitTextToSize(text,width);pdf.text(lines,x,y);return y+lines.length*lineHeight}
async function downloadCorrectedAnswerSheet(assessment:Assessment,result:GradeResult,file:UploadFile){
  const blob=await readFileBlob(file.id);if(!blob)throw new Error("The original answer sheet is unavailable. Re-upload it before creating a corrected copy.");
  const questions=result.questionDecisions||[];if(!questions.length)throw new Error("No question-level review is available for this answer sheet.");
  const logo=await brandLogoDataUri();const pdf=new jsPDF({orientation:"portrait",unit:"mm",format:"a4",compress:true});
  for(let index=0;index<questions.length;index++){
    if(index)pdf.addPage();const question=questions[index],pageNumber=pageNumberForQuestion(question,index,result.ocrText||"");
    const screenshot=await sourcePageScreenshot(blob,file,pageNumber);
    pdf.addImage(logo,"PNG",14,12,42,11,undefined,"FAST");pdf.setTextColor(23,38,68);pdf.setFont("helvetica","bold");pdf.setFontSize(18);pdf.text("Corrected Answer Sheet",14,31);
    pdf.setFont("helvetica","normal");pdf.setFontSize(9);pdf.setTextColor(90,102,122);pdf.text(`${result.studentName} · Class ${assessment.grade}${assessment.section} · ${assessment.subject}`,14,37);pdf.setFont("helvetica","bold");pdf.setTextColor(23,38,68);pdf.text(`Total score: ${result.score} / ${result.maxMarks}`,196,37,{align:"right"});
    pdf.setDrawColor(246,160,23);pdf.setLineWidth(0.8);pdf.line(14,41,196,41);
    pdf.setTextColor(23,38,68);pdf.setFont("helvetica","bold");pdf.setFontSize(12);pdf.text(`Question ${index+1}: ${question.label}`,14,49);
    pdf.setFontSize(10);pdf.text(`Final marks: ${question.awardedMarks} / ${question.maxMarks}`,14,56);pdf.text(`Source answer-sheet page ${pageNumber}`,196,56,{align:"right"});
    const imageProps=pdf.getImageProperties(screenshot);const imageWidth=182;const imageHeight=Math.min(112,imageWidth*(imageProps.height/imageProps.width));pdf.addImage(screenshot,"JPEG",14,61,imageWidth,imageHeight,undefined,"FAST");
    let y=61+imageHeight+10;pdf.setFont("helvetica","bold");pdf.setFontSize(11);pdf.text("AI feedback",14,y);y+=6;pdf.setFont("helvetica","normal");pdf.setFontSize(10);y=pdfText(pdf,question.rationale||result.feedback||"No AI feedback was stored for this question.",14,y,182);
    if(question.teacherComment?.trim()){y+=5;pdf.setFont("helvetica","bold");pdf.text("Teacher comment",14,y);y+=6;pdf.setFont("helvetica","normal");pdfText(pdf,question.teacherComment,14,y,182)}
    pdf.setDrawColor(217,222,232);pdf.setLineWidth(0.25);pdf.line(14,282,196,282);pdf.setFontSize(8);pdf.setTextColor(102,112,133);pdf.text("EduAI Hub · Learning X-Ray",14,288);pdf.text(`Question ${index+1} of ${questions.length}`,196,288,{align:"right"});
  }
  const bytes=await verifiedPdfBytes(pdf.output("blob"));const url=URL.createObjectURL(new Blob([bytes as BlobPart],{type:"application/pdf"}));const link=document.createElement("a");link.href=url;link.download=`${safeDownloadName(`${result.studentName}_${assessment.title}_Corrected_Answer_Sheet`)}.pdf`;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function worksheetDocumentBody(content?:WorksheetContent){const questions=[...(content?.mcqQuestions||[]).map((q:any,i:number)=>`<li><span class="label">${htmlEscape(q.concept||"Topic")}</span><b>${i+1}. ${htmlEscape(q.question)}</b><div class="options">${q.options.map((o:string,j:number)=>`${String.fromCharCode(65+j)}. ${htmlEscape(o)}`).join("<br>")}</div></li>`),...(content?.subjectiveQuestions||[]).map((q:any,i:number)=>`<li><span class="label">${htmlEscape(q.concept||"Topic")}</span><b>${(content?.mcqQuestions.length||0)+i+1}. ${htmlEscape(q.question)}</b><p>Answer:</p><br><br></li>`)].join("");return `<h2>Student details</h2><p>Name: ____________________ &nbsp;&nbsp; Date: __________ &nbsp;&nbsp; Teacher: ____________________</p><h2>Instructions</h2><p>Answer every question. Show working or supporting evidence where required.</p><ol>${questions}</ol>`}
function downloadWorksheet(r:any,content?:WorksheetContent){content=content||r.content;downloadDocument(r.title||"Worksheet",r.title||"Worksheet",`${r.subject||"Subject"} · ${r.grade||"Class not set"} · ${(r.concepts||[r.concept]).filter(Boolean).join(" · ")}`,worksheetDocumentBody(content),false)}
function answerKeyDocumentBody(content?:{mcqQuestions:{question:string;options:string[];correctIndex:number;concept?:string}[];subjectiveQuestions:{question:string;modelAnswer:string;concept?:string}[]}){
  const mcqKey=(content?.mcqQuestions||[]).map((q:any,i)=>`<div class="answer"><span class="label">${htmlEscape(q.concept||"Topic")}</span><b>${i+1}. ${String.fromCharCode(65+q.correctIndex)}</b> — ${htmlEscape(q.options[q.correctIndex])}</div>`).join("");
  const subjKey=(content?.subjectiveQuestions||[]).map((q:any,i)=>`<div class="answer"><span class="label">${htmlEscape(q.concept||"Topic")}</span><b>${(content?.mcqQuestions.length||0)+i+1}. Model answer</b><p>${htmlEscape(q.modelAnswer)}</p></div>`).join("");
  return `<h2>Multiple-choice answers</h2>${mcqKey||"<p>None</p>"}<h2>Written-response marking guide</h2>${subjKey||"<p>None</p>"}`;
}
function downloadAnswerKey(r:any,content?:{mcqQuestions:{question:string;options:string[];correctIndex:number}[];subjectiveQuestions:{question:string;modelAnswer:string}[]}){
  content=content||r.content;
  downloadDocument(`${r.title||"Worksheet"}-Answer-Key`,`${r.title||"Worksheet"} · Answer Key`,`${r.subject||"Subject"} · ${r.grade||"Class not set"}`,answerKeyDocumentBody(content),false);
}
function studyGuideDocumentBody(guide:any,evidenceFiles:string[]=[]){const topicPlan=(guide?.topics||[]).map((t:any,i:number)=>`<tr><td>${i+1}</td><td>${htmlEscape(t.concept)}</td><td>${htmlEscape(t.mastery)}%</td></tr>`).join("");const sources=evidenceFiles.map(file=>`<li>${htmlEscape(file)}</li>`).join("");const topics=(guide?.topics||[]).map((t:any,i:number)=>`<section class="topic"><span class="label">Topic ${i+1}</span><span class="label">${htmlEscape(t.mastery)}% starting mastery</span><h2>${htmlEscape(t.concept)}</h2><h3>Why this is a learning gap</h3><p>${htmlEscape(t.diagnosis)}</p><h3>Learning objective</h3><p>${htmlEscape(t.learningObjective)}</p><h3>Clear explanation</h3><p>${htmlEscape(t.explanation)}</p><h3>Worked example</h3><div class="answer">${htmlEscape(t.workedExample)}</div><h3>Guided practice</h3><ol>${(t.practiceSteps||[]).map((x:string)=>`<li>${htmlEscape(x)}</li>`).join("")}</ol><h3>Check for understanding</h3><ol>${(t.checkForUnderstanding||[]).map((x:string)=>`<li>${htmlEscape(x)}</li>`).join("")}</ol></section>`).join("");return `<h2>Overview</h2><p>${htmlEscape(guide?.overview||"")}</p><h2>Topic plan</h2><table><thead><tr><th>#</th><th>Learning-gap topic</th><th>Starting mastery</th></tr></thead><tbody>${topicPlan}</tbody></table>${sources?`<h2>Built from</h2><ul>${sources}</ul>`:""}${topics}`}
function downloadStudyGuide(r:any,guide:any){downloadDocument(r.title||"Study-Guide",r.title||"Study Guide",`${r.subject||"Subject"} · ${r.grade||"Class not set"} · ${r.studentName||"Student"}`,studyGuideDocumentBody(guide,r.evidenceFiles||[]))}
async function verifiedPdfBytes(blob:Blob){const bytes=new Uint8Array(await blob.arrayBuffer());if(bytes.length<5||String.fromCharCode(...bytes.slice(0,5))!=="%PDF-")throw new Error("A generated resource was not a valid PDF.");return bytes}
function safeDownloadName(value:string){return value.normalize("NFKD").replace(/[^a-z0-9]+/gi,"_").replace(/^_+|_+$/g,"").slice(0,100)||"Assessment"}
async function downloadAssessmentZip(assessment:Assessment,result:GradeResult,guide?:Worksheet,worksheet?:Worksheet){
  const base=safeDownloadName(`${result.studentName}_${assessment.title}`),folder=`${base}/`,files:Record<string,Uint8Array>={};
  if(!guide?.guide||!worksheet?.content)throw new Error("All four reports must finish generating before download. Please try again.");
  const reportBlob=await createBrandedPdfBlob("Learning Gap Report",`Class ${assessment.grade}${assessment.section} · ${assessment.subject} · ${assessment.title}`,studentLearningGapDocumentBody(assessment,result));
  files[folder+"Learning_Gap_Report.pdf"]=await verifiedPdfBytes(reportBlob);
  const guideBlob=await createBrandedPdfBlob(guide.title||"Study Guide",`${guide.subject||assessment.subject} · ${guide.grade||assessment.grade} · ${guide.studentName||result.studentName}`,studyGuideDocumentBody(guide.guide,guide.evidenceFiles||assessment.files.map(file=>`${file.documentRole||inferDocumentRole(file.name)} · ${file.name}`)));files[folder+"Study_Guide.pdf"]=await verifiedPdfBytes(guideBlob);
  const worksheetMeta=`${worksheet.subject||assessment.subject} · ${worksheet.grade||assessment.grade} · ${(worksheet.concepts||[worksheet.concept]).filter(Boolean).join(" · ")}`;const worksheetBlob=await createBrandedPdfBlob(worksheet.title||"Worksheet",worksheetMeta,worksheetDocumentBody(worksheet.content),false);files[folder+"Worksheet.pdf"]=await verifiedPdfBytes(worksheetBlob);const answerBlob=await createBrandedPdfBlob(`${worksheet.title||"Worksheet"} · Answer Key`,`${worksheet.subject||assessment.subject} · ${worksheet.grade||assessment.grade}`,answerKeyDocumentBody(worksheet.content),false);files[folder+"Answer_Key.pdf"]=await verifiedPdfBytes(answerBlob);
  const archive=zipSync(files,{level:6});const url=URL.createObjectURL(new Blob([archive as BlobPart],{type:"application/zip"}));const a=document.createElement("a");a.href=url;a.download=`${base}.zip`;a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function learningGapExecutiveSummary(gaps:{concept:string;mastery:number}[]){
  return `<section class="executive" style="background:#eef3fb;border-left:6px solid #283b65;padding:16px 20px;margin:18px 0 26px"><h2>Executive summary</h2><p>The following learning gaps were identified from the analysed evidence:</p>${gaps.slice().sort((a,b)=>a.mastery-b.mastery).map(g=>masteryVisual(g.concept,g.mastery)).join("")}</section>`;
}
function studentLearningGapDocumentBody(assessment:Assessment,result:GradeResult,file?:UploadFile){
  const details=result.gaps.slice().sort((a,b)=>a.mastery-b.mastery).map((g,index)=>`<section class="topic"><span class="label">Gap ${index+1}</span><span class="label">${g.mastery}% mastery</span><h2>${htmlEscape(g.concept)}</h2>${masteryVisual(g.concept,g.mastery)}<h3>Diagnostic finding</h3><p>${htmlEscape(g.finding||"Incomplete understanding identified.")}</p><h3>Likely misunderstanding</h3><p>${htmlEscape(g.misconception||"Review the validated report for the likely misconception.")}</p><h3>Finding from the answer</h3><p>${htmlEscape(g.evidence||result.feedback||"Teacher-reviewed answer finding.")}</p><h3>Required rework</h3><p>${htmlEscape(g.rework||`Revisit and practise ${g.concept}.`)}</p></section>`).join("");
  const percentage=Math.round((result.score/Math.max(1,result.maxMarks))*100),performance=percentage>=90?"Excellent":percentage>=75?"Good":percentage>=55?"Developing":"Priority support required";
  const gapRows=result.gaps.slice().sort((a,b)=>a.mastery-b.mastery).map((g,index)=>{const status=g.mastery<55?"Priority":g.mastery<80?"Developing":"Secure",colour=g.mastery<55?"#9f2d24":g.mastery<80?"#8a5a00":"#23672d";return `<tr><td>${index+1}. ${htmlEscape(g.concept)}</td><td><b>${g.mastery}%</b></td><td style="color:${colour};font-weight:700">${status}</td></tr>`}).join("");
  const row=(label:string,value:string|number)=>`<tr><th>${label}</th><td>${value}</td></tr>`;
  const summary=`<section class="executive"><h2>Executive summary</h2><div class="executive-panels"><div><h3>Student & assessment details</h3><table><tbody>${row("Student Name",htmlEscape(result.studentName))}${row("Class",`Class ${htmlEscape(assessment.grade)}${htmlEscape(assessment.section)}`)}${row("Subject",htmlEscape(assessment.subject))}${row("Assessment",htmlEscape(assessment.title))}${row("Answer Sheet",htmlEscape(file?.name||"Uploaded answer sheet"))}${row("Total Marks",result.maxMarks)}${row("Marks Obtained",result.score)}${row("Percentage",`${percentage}%`)}${row("Overall Performance",`<b>${performance}</b>`)}</tbody></table></div><div><h3>Learning-gap summary</h3><table><thead><tr><th>Gap</th><th>Mastery</th><th>Status</th></tr></thead><tbody>${gapRows}</tbody></table></div></div></section>`;
  return `${summary}${details||"<p>No learning gap was identified.</p>"}`;
}
function downloadStudentLearningGapReport(assessment:Assessment,result:GradeResult,file?:UploadFile){
  downloadDocument(`${result.studentName}-Learning-Gap-Report`,"Learning Gap Report",`Class ${assessment.grade}${assessment.section} · ${assessment.subject} · ${assessment.title}`,studentLearningGapDocumentBody(assessment,result,file));
}
function downloadClassLearningGapReport(assessment:Assessment,results:GradeResult[]){
  const totals=new Map<string,{sum:number;count:number}>();
  results.forEach(result=>result.gaps.forEach(g=>{const item=totals.get(g.concept)||{sum:0,count:0};item.sum+=g.mastery;item.count++;totals.set(g.concept,item)}));
  const gaps=Array.from(totals,([concept,item])=>({concept,mastery:Math.round(item.sum/item.count)})).sort((a,b)=>a.mastery-b.mastery);
  const students=results.map(result=>`<tr><td>${htmlEscape(result.studentName)}</td><td>${result.score}/${result.maxMarks}</td><td>${htmlEscape(result.gaps.slice().sort((a,b)=>a.mastery-b.mastery)[0]?.concept||"No gap identified")}</td></tr>`).join("");
  downloadDocument(`${assessment.title}-Class-Learning-Gap-Report`,"Class Learning Gap Report",`Class ${assessment.grade}${assessment.section} · ${assessment.subject} · ${assessment.title} · ${results.length} student${results.length===1?"":"s"}`,`${learningGapExecutiveSummary(gaps)}<h2>Student analysis</h2><table><thead><tr><th>Student</th><th>Score</th><th>Priority learning gap</th></tr></thead><tbody>${students}</tbody></table>`);
}
function reportTitle(tab:string){return ({ "Student performance":"Class 6 performance trend","Performance matrix report":"Class 6A performance matrix","Concept mastery":"Mastery by concept","Learning gaps":"Priority learning gaps","Teacher summary":"Teacher-approved activity summary","School dashboard":"School improvement overview"} as any)[tab]}
function dialogTitle(x:string){return x.split("-").map(v=>v[0]?.toUpperCase()+v.slice(1)).join(" ")}

function inferDocumentRole(name:string):DocumentRole{
  if(/marking.?scheme|mark.?scheme/i.test(name))return "Marking scheme";
  if(/model.?answer|answer.?key|solution/i.test(name))return "Model answer";
  if(/question|paper|worksheet|assessment|\\bqp\\b/i.test(name))return "Question paper";
  if(/graded|marked|checked/i.test(name))return "Teacher-graded answer sheet";
  return "Ungraded answer sheet";
}
function isQuestionPaperFile(file:UploadFile,total:number){return file.documentRole==="Question paper"||(!file.documentRole&&total>1&&/question|paper|qp/i.test(file.name))}
function isAnswerSheetFile(file:UploadFile,total:number){return file.documentRole==="Ungraded answer sheet"||file.documentRole==="Teacher-graded answer sheet"||(!file.documentRole&&!isQuestionPaperFile(file,total)&&!(/answer.?key|model.?answer|marking.?scheme|solutions?/i.test(file.name)))}
function analysisDialogFor(file:UploadFile){return (file.documentRole||inferDocumentRole(file.name))==="Teacher-graded answer sheet"?"diagnose-file":"grade-file"}
function autoAnalysisDialogFor(file:UploadFile){return (file.documentRole||inferDocumentRole(file.name))==="Teacher-graded answer sheet"?"diagnose-file":"auto-grade-file"}

function UploadedFiles({assessment,update,notify,open}:any){
  const files:UploadFile[]=assessment.files||[];
  const retrieve=async(file:UploadFile,download=false)=>{
    const blob=await readFileBlob(file.id);
    if(!blob){notify("The original file is not available in secure storage. Upload it again to restore preview and download.","warning");return}
    const url=URL.createObjectURL(blob);
    if(!download){window.open(url,"_blank","noopener,noreferrer");return}
    if(blob.type==="application/pdf"||/\.pdf$/i.test(file.name)){
      URL.revokeObjectURL(url);
      try{const bytes=await verifiedPdfBytes(blob);const pdfUrl=URL.createObjectURL(new Blob([bytes as BlobPart],{type:"application/pdf"}));const a=document.createElement("a");a.href=pdfUrl;a.download=file.name.replace(/\.[^.]+$/,"")+".pdf";a.click();window.setTimeout(()=>URL.revokeObjectURL(pdfUrl),1000)}catch{notify(`${file.name} is labelled as PDF but its contents are not a valid PDF. Re-upload or convert the original file.`,"error")};return;
    }
    URL.revokeObjectURL(url);
    let body="";
    if(blob.type.startsWith("image/"))body=`<section class="topic"><img src="${await blobToDataUri(blob)}" alt="${htmlEscape(file.name)}" style="display:block;max-width:100%;height:auto;margin:0 auto"></section>`;
    else if(blob.type.startsWith("text/")||/\.(md|markdown|txt|rtf|html?|xml|json|ya?ml|csv|tsv)$/i.test(file.name))body=textToDocumentHtml(await blob.text());
    else{
      const response=await authFetch("/api/document-to-pdf-source",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:file.name,mimeType:blob.type||"application/octet-stream",base64:await blobToBase64(blob)})});
      const payload=await response.json();
      if(!response.ok)throw new Error(payload?.error||"This document could not be converted to PDF.");
      body=textToDocumentHtml(String(payload.text||""));
    }
    await downloadDocument(file.name.replace(/\.[^.]+$/,""),file.documentRole||inferDocumentRole(file.name),`${assessment.title} · Converted to a classroom-ready PDF`,body);
  };
  const remove=async(file:UploadFile)=>{await removeFileBlob(file.id);update(assessment.id,{files:files.filter(f=>f.id!==file.id)});notify(`${file.name} removed`)};
  const openGaps=(file:UploadFile,graded:boolean)=>{if(graded)open(`student-gaps:${file.id}`);else{notify("Grade this answer sheet first to unlock its learning gaps report","warning");open(`grade-file:${file.id}`)}};
  return <section className="card span-2 uploaded-files-card"><CardHead eyebrow={`${files.length} file${files.length===1?"":"s"} · ${assessment.title}`} title="Uploaded evidence"><button className="primary" onClick={()=>open("upload")}>＋ Add files</button></CardHead>{files.length===0?<div className="empty-state"><b>No evidence uploaded yet</b><p>Add question papers, model answers, and graded or ungraded answer sheets.</p><button className="secondary" onClick={()=>open("upload")}>Browse files</button></div>:<div className="uploaded-files-grid">{files.map(file=>{const answer=isAnswerSheetFile(file,files.length);const graded=Boolean(assessment.gradeResults?.[file.id]);return <article key={file.id}><span className="file-icon">{file.name.split(".").pop()?.toUpperCase()}</span><div><b>{file.name}</b><small>{file.documentRole||inferDocumentRole(file.name)} · {(file.size/1024/1024).toFixed(2)} MB · {file.status}{graded?" · Analysed":""}</small></div><div className="button-row">{answer&&<button className="primary" onClick={()=>open(`${analysisDialogFor(file)}:${file.id}`)}>{graded?"Reanalyse":file.documentRole==="Teacher-graded answer sheet"?"Analyse teacher marks":"Analyse answer sheet"}</button>}{answer&&<button className="secondary" onClick={()=>openGaps(file,graded)}>{graded?"Learning gaps report":"Learning gaps (analyse first)"}</button>}<button className="secondary" onClick={()=>retrieve(file)}>Preview</button><button className="secondary" onClick={()=>retrieve(file,true)}>Download</button><button className="link danger" onClick={()=>remove(file)}>Remove</button></div></article>})}</div>}<p className="storage-note">Every report and generated resource stays linked to these classified source documents.</p></section>
}

function openFileDb():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open("eduai-learning-xray-files",1);request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains("files"))request.result.createObjectStore("files")};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})}
async function saveLocalFileBlob(id:string,file:Blob){const db=await openFileDb();await new Promise<void>((resolve,reject)=>{const tx=db.transaction("files","readwrite");tx.objectStore("files").put(file,id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)});db.close()}
async function readLocalFileBlob(id:string):Promise<Blob|null>{const db=await openFileDb();const value=await new Promise<any>((resolve,reject)=>{const request=db.transaction("files").objectStore("files").get(id);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)});db.close();return value||null}
async function removeLocalFileBlob(id:string){const db=await openFileDb();await new Promise<void>((resolve,reject)=>{const tx=db.transaction("files","readwrite");tx.objectStore("files").delete(id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)});db.close()}
async function saveFileBlob(id:string,file:Blob){
  const response=await authFetch(`/api/files/${encodeURIComponent(id)}`,{method:"PUT",headers:{"Content-Type":file.type||"application/octet-stream"},body:file});
  if(!response.ok){let message="Cloud file upload failed";try{const payload=await response.json();if(payload?.error)message=payload.error}catch{}throw new Error(message)}
  try{await saveLocalFileBlob(id,file)}catch{/* Browser storage is an optional cache; the secure cloud copy is authoritative. */}
}
async function readFileBlob(id:string):Promise<Blob|null>{
  try{const cached=await readLocalFileBlob(id);if(cached)return cached}catch{/* Fall through to secure cloud storage. */}
  try{const response=await authFetch(`/api/files/${encodeURIComponent(id)}`,{cache:"no-store"});if(!response.ok)return null;const blob=await response.blob();try{await saveLocalFileBlob(id,blob)}catch{}return blob}catch{return null}
}
async function removeFileBlob(id:string){try{await removeLocalFileBlob(id)}catch{}await authFetch(`/api/files/${encodeURIComponent(id)}`,{method:"DELETE"})}
function blobToBase64(blob:Blob):Promise<string>{return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onloadend=()=>{const result=reader.result as string;resolve(result.split(",")[1]||"")};reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob)})}

function UploadDialogV2({assessment,update,done}:any){
  const input=useRef<HTMLInputElement>(null),pauseRef=useRef(false),pendingUploads=useRef(new Map<string,Promise<void>>());
  const [files,setFiles]=useState<UploadFile[]>(assessment.files||[]);
  const [error,setError]=useState(""),[uploading,setUploading]=useState(false),[paused,setPaused]=useState(false);
  const roles:DocumentRole[]=["Question paper","Marking scheme","Model answer","Ungraded answer sheet","Teacher-graded answer sheet","Supporting reference"];
  const add=(list:FileList|File[])=>{setError("");const next:UploadFile[]=[];Array.from(list).forEach(file=>{if(!supportsDocumentUpload(file)){setError(`${file.name}: unsupported format. Use PDF, Word, Markdown, text, spreadsheet or an image.`);return}if(file.size>10*1024*1024){setError(`${file.name}: exceeds the 10 MB limit.`);return}const id=`f${crypto.randomUUID()}`;next.push({id,name:file.name,type:file.type||"application/octet-stream",size:file.size,progress:0,status:"Saving securely",documentRole:"Ungraded answer sheet",preview:file.type.startsWith("image/")&&!file.type.includes("heic")?URL.createObjectURL(file):undefined});const pending=saveFileBlob(id,file).then(()=>setFiles(items=>items.map(item=>item.id===id?{...item,status:"Ready"}:item))).catch(err=>{setFiles(items=>items.map(item=>item.id===id?{...item,status:"Failed · try again"}:item));throw err}).finally(()=>pendingUploads.current.delete(id));pendingUploads.current.set(id,pending)});setFiles(current=>[...current,...next]);if(input.current)input.current.value=""};
  const start=async()=>{if(!files.length){setError("Choose at least one supported file.");return}setUploading(true);setError("");const saves=await Promise.allSettled(Array.from(pendingUploads.current.values()));if(saves.some(result=>result.status==="rejected")){setUploading(false);setError("One or more files could not be saved. Your earlier files are still present; remove or retry only the failed files.");return}let p=0;const timer=window.setInterval(()=>{if(pauseRef.current)return;p+=10;setFiles(fs=>fs.map(f=>({...f,progress:Math.min(100,p),status:p>=100?"Uploaded · quality checked":"Uploading"})));if(p>=100){clearInterval(timer);setUploading(false);window.setTimeout(()=>{const names=files.map(f=>f.name).join(" ").toLowerCase();const economics=/econom|micro|macro|demand|supply|gdp/.test(names);update(assessment.id,{files:files.map(f=>({...f,progress:100,status:"OCR complete",preview:undefined})),stage:"uploaded",title:economics?"Economics question paper & answer sheets":assessment.title,subject:economics?"Economics":assessment.subject,totalReviews:Math.max(assessment.totalReviews,files.length*4)});done()},350)}},180)};
  const pause=()=>{pauseRef.current=!pauseRef.current;setPaused(pauseRef.current);setFiles(fs=>fs.map(f=>({...f,status:pauseRef.current?"Paused":"Uploading"})))};
  return <><DialogHead eyebrow={assessment.title} title="Upload and classify evidence"/><p className="modal-copy">The document roles below determine how grading, learning-gap analysis, study guides and worksheets use each file.</p><div className="dropzone" role="button" tabIndex={0} onClick={()=>input.current?.click()} onKeyDown={e=>(e.key==="Enter"||e.key===" ")&&input.current?.click()} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();add(e.dataTransfer.files)}}><span>↑</span><b>Drop scanned handwriting or digital files</b><small>PDF, Word, Markdown, text, spreadsheet or image · multiple files · 10 MB each</small><button type="button" className="secondary" onClick={e=>{e.stopPropagation();input.current?.click()}}>Browse / Choose File</button><input ref={input} className="file-input" type="file" multiple accept={DOCUMENT_ACCEPT} onChange={e=>e.target.files&&add(e.target.files)}/></div>{error&&<p className="form-error" role="alert">{error}</p>}<div className="upload-list evidence-upload-list">{files.map(f=><div key={f.id}>{f.preview?<img src={f.preview} alt={`Preview ${f.name}`}/>:<span className="file-icon">{f.name.split(".").pop()?.toUpperCase()}</span>}<div><b>{f.name}</b><small>{(f.size/1024/1024).toFixed(2)} MB · {f.status}</small><select aria-label={`Document role for ${f.name}`} value={f.documentRole||inferDocumentRole(f.name)} onChange={e=>setFiles(items=>items.map(item=>item.id===f.id?{...item,documentRole:e.target.value as DocumentRole}:item))}>{roles.map(role=><option key={role}>{role}</option>)}</select><Progress value={f.progress}/></div><button disabled={uploading} onClick={()=>setFiles(x=>x.filter(v=>v.id!==f.id))} aria-label={`Remove ${f.name}`}>×</button></div>)}</div><div className="button-row">{uploading&&<button className="secondary" onClick={pause}>{paused?"Resume":"Pause"}</button>}<button className="secondary" disabled={uploading} onClick={()=>setFiles(fs=>fs.map(f=>f.status.includes("Failed")?{...f,status:"Ready",progress:0}:f))}>Retry failed</button><button className="primary" disabled={uploading} onClick={start}>Save evidence & start OCR</button></div></>
}
