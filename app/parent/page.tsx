"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { landingPath } from "../../lib/roles";

/**
 * Parent landing page.
 *
 * The destination the role-aware redirect needs, and the first screen to read
 * the normalized read model rather than a teacher's workspace snapshot. It
 * shows only teacher-approved output: /api/parent/children is built field by
 * field in the database, so OCR transcripts, AI rationale and other people's
 * children are structurally absent rather than filtered here.
 *
 * The full portal is Week 3. This is deliberately the minimum that proves the
 * path end to end.
 */
type Child = {
  studentId:string; studentName:string; rollNumber:string|null;
  className:string; schoolName:string;
  results:{assessmentId:string;title:string;subject:string;date:string;score:number;maxMarks:number;feedback:string|null;gaps:{concept:string;mastery:number}[]}[];
  resources:{id:string;title:string;type:string}[];
};

export default function ParentPage(){
  const [children,setChildren]=useState<Child[]|null>(null);
  const [error,setError]=useState("");

  useEffect(()=>{let alive=true;void(async()=>{
    try{
      const config=await (await fetch("/api/auth/config",{cache:"no-store"})).json();
      const supabase=createClient(config.url,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
      const {data}=await supabase.auth.getSession();
      const token=data.session?.access_token;
      if(!token){location.replace("/signin");return}

      const response=await fetch("/api/parent/children",{cache:"no-store",headers:{Authorization:`Bearer ${token}`}});
      if(response.status===403){
        // Signed in, but not a parent. Send them to their own landing rather
        // than showing an error for a page that was never theirs.
        const profile=await (await fetch("/api/profile",{cache:"no-store",headers:{Authorization:`Bearer ${token}`}})).json().catch(()=>({}));
        location.replace(landingPath(profile?.profile));
        return;
      }
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error||"Your children's reports could not be loaded.");
      if(alive)setChildren(payload.children||[]);
    }catch(cause){ if(alive)setError(cause instanceof Error?cause.message:"Something went wrong.") }
  })();return()=>{alive=false}},[]);

  if(error)return <main className="parent-dashboard"><section className="parent-card"><h1>Reports unavailable</h1><p>{error}</p></section></main>;
  if(!children)return <main className="app-loading"><img src="/brand/logo.png" alt="EduAI Hub"/><b>Loading your children's reports…</b></main>;

  return <main className="parent-dashboard">
    <header className="parent-hero">
      <img src="/brand/logo.png" alt="EduAI Hub"/>
      <p>Parent dashboard</p>
      <h1>{children.length?`${children.length} linked child${children.length===1?"":"ren"}`:"No children linked yet"}</h1>
      <span>Teacher-approved reports only</span>
    </header>

    {!children.length&&<section className="parent-card">
      <h2>Nothing here yet</h2>
      <p>Ask your child's teacher for an invite code. Once it is redeemed, their teacher-approved learning reports appear here automatically.</p>
    </section>}

    {children.map(child=><section className="parent-card" key={child.studentId}>
      <header><h2>{child.studentName}</h2><span>{child.className}{child.rollNumber?` · ${child.rollNumber}`:""} · {child.schoolName}</span></header>

      {!child.results.length&&<p>No published assessments yet for {child.studentName}.</p>}

      {child.results.map(result=>{
        const percentage=Math.round(Number(result.score)/Math.max(1,Number(result.maxMarks))*100);
        return <article className="parent-gap" key={`${child.studentId}-${result.assessmentId}`}>
          <header><b>{result.title}</b><span>{result.score}/{result.maxMarks} · {percentage}%</span></header>
          <small>{result.subject} · {result.date}</small>
          {result.feedback&&<p>{result.feedback}</p>}
          {Boolean(result.gaps?.length)&&<ul>{result.gaps.map(gap=><li key={gap.concept}>{gap.concept} — {gap.mastery}% mastery</li>)}</ul>}
        </article>;
      })}

      {Boolean(child.resources.length)&&<>
        <h3>Learning materials</h3>
        <ul>{child.resources.map(resource=><li key={resource.id}>{resource.title} <small>({resource.type})</small></li>)}</ul>
      </>}
    </section>)}

    <footer className="parent-card"><small>These reports are prepared and approved by your child's teacher. They do not show other students, and they are not used for ranking.</small></footer>
  </main>;
}
