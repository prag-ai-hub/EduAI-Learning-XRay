"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { ApiError, accessToken, djangoApi } from "../../lib/django-api";

/**
 * 'Register your school'.
 *
 * Signup happens in Supabase first - Django cannot create an identity, because
 * `public.users.id` references `auth.users.id` - so an anonymous visitor is
 * sent to /signin and comes back here with a session. This page then creates
 * the school and the caller's SchoolAdmin profile in one Django call.
 *
 * A new school is always Pending. Approval is a Super Admin decision, so the
 * success state is a waiting room, not a workspace.
 */

type School = { id:string; name:string; status:string; city:string|null; board:string|null };

export default function RegisterSchoolPage(){
  const [ready,setReady]=useState(false);
  const [existing,setExisting]=useState<School|null>(null);
  const [submitted,setSubmitted]=useState<School|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");

  useEffect(()=>{let alive=true;void(async()=>{
    try{
      if(!await accessToken()){location.replace("/signin?next=/register-school");return}
      // Already registered? Show where that application stands instead of
      // offering to start a second one.
      const {school}=await djangoApi.get<{school:School|null}>("/api/v1/schools/mine");
      if(alive){setExisting(school);setReady(true)}
    }catch(cause){
      if(alive){
        setMessage(cause instanceof ApiError?cause.message:"Registration is unavailable right now.");
        setReady(true);
      }
    }
  })();return()=>{alive=false}},[]);

  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    setBusy(true);setMessage("");
    const form=new FormData(event.currentTarget);
    try{
      const {school}=await djangoApi.post<{school:School}>("/api/v1/schools/register",{
        name:String(form.get("name")||"").trim(),
        city:String(form.get("city")||"").trim(),
        board:String(form.get("board")||"").trim(),
        admin_name:String(form.get("admin_name")||"").trim(),
        phone:String(form.get("phone")||"").trim(),
      });
      setSubmitted(school);
    }catch(cause){
      setMessage(cause instanceof ApiError?cause.message:"Registration failed. Please try again.");
    }finally{setBusy(false)}
  };

  const pending=submitted||existing;

  return (
    <main className="login-page">
      <section className="login-story" aria-label="Why schools register">
        <div className="login-story-inner">
          <img className="login-logo" src="/brand/logo.png" alt="EduAI Hub" />
          <p className="eyebrow">EduAI Learning X-Ray</p>
          <h1>Bring Learning X-Ray to your school.</h1>
          <p className="login-lead">Register once. We review every school before it goes live, so staff and student data are only ever opened to a verified institution.</p>
          <div className="login-proof">
            <article><span>01</span><div><b>Register</b><small>Tell us about your school and who administers it.</small></div></article>
            <article><span>02</span><div><b>We review</b><small>A verification check, usually within two working days.</small></div></article>
            <article><span>03</span><div><b>Invite your teachers</b><small>Once approved, add staff and start your first assessment.</small></div></article>
          </div>
        </div>
      </section>

      <section className="login-panel" aria-label="Register your school">
        <div className="login-card">
          <img className="login-mobile-logo" src="/brand/logo.png" alt="EduAI Hub" />

          {!ready&&<p className="insight" role="status">Checking your account…</p>}

          {ready&&pending&&(
            <>
              <p className="eyebrow">{pending.status==="Pending"?"Awaiting review":"Your school"}</p>
              <h2>{pending.name}</h2>
              {pending.status==="Pending"&&<p>Your registration is with our team. We will email the administrator address as soon as it is reviewed — you do not need to do anything else.</p>}
              {pending.status==="Active"&&<p>Your school is approved and active. You can invite teachers and start work.</p>}
              {pending.status==="Suspended"&&<p>This school is currently suspended. Contact support to discuss reactivating it.</p>}
              {pending.status==="Closed"&&<p>This registration was not approved. Contact support if you believe that is a mistake.</p>}
              <p className="insight" role="status">
                Status: <b>{pending.status}</b>
              </p>
              {pending.status==="Active"
                ?<Link className="primary full" href="/app">Open your workspace</Link>
                :<Link className="secondary full" href="/">Back to home</Link>}
            </>
          )}

          {ready&&!pending&&(
            <>
              <p className="eyebrow">Register your school</p>
              <h2>Tell us about your school</h2>
              <p>You will become its administrator. Nothing goes live until our team has reviewed the registration.</p>
              <form onSubmit={submit}>
                <label>School name<input name="name" required minLength={3} autoComplete="organization" placeholder="Nehru Vidyalaya"/></label>
                <div className="form-grid">
                  <label>City<input name="city" autoComplete="address-level2" placeholder="Pune"/></label>
                  <label>Board<input name="board" placeholder="CBSE"/></label>
                </div>
                <label>Your full name<input name="admin_name" required minLength={2} autoComplete="name"/></label>
                <label>Phone<input name="phone" type="tel" autoComplete="tel"/></label>
                {message&&<p className="form-error" role="alert">{message}</p>}
                <button className="primary full" disabled={busy}>
                  {busy?"Submitting…":"Submit registration"}
                </button>
              </form>
            </>
          )}

          <p className="login-note"><span>●</span> Reviewed before activation · Audit history · Your data stays yours</p>
          <footer><Link href="/">Home</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><span>© 2026 EduAI Hub</span></footer>
        </div>
      </section>
    </main>
  );
}
