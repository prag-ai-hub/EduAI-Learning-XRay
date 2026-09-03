"use client";

import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { landingPath } from "../../lib/roles";

/**
 * The real sign-in page.
 *
 * It was previously a static shell whose four buttons all linked to /app, where
 * the actual authentication lived. Authentication now happens here and /app
 * redirects anonymous visitors back, so there is one entry point and the
 * post-login destination can depend on the role.
 */
export default function SignInPage() {
  const [client, setClient] = useState<any>(null);
  const [mode, setMode] = useState<"login"|"signup">("login");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [resuming, setResuming] = useState(false);

  // Resolve the role, then send the visitor where that role belongs.
  const routeByRole = async (accessToken:string) => {
    try{
      const response = await fetch("/api/profile", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = await response.json().catch(() => ({}));
      location.replace(landingPath(response.ok ? payload.profile : null));
    }catch{
      // A profile lookup failure must not strand a signed-in user on the login
      // page; /app can recover and will ask them to complete their profile.
      location.replace("/app");
    }
  };

  useEffect(() => {
    let alive = true;
    void (async () => {
      try{
        const response = await fetch("/api/auth/config", { cache: "no-store" });
        const config = await response.json();
        if (!response.ok) throw new Error(config.error || "Authentication is unavailable.");
        const supabase = createClient(config.url, config.publishableKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        });
        if (!alive) return;
        setClient(supabase);
        // Covers both an existing session and the return hop from an OAuth
        // provider, which lands back here rather than deep in the app.
        const { data } = await supabase.auth.getSession();
        if (data.session?.access_token) {
          setResuming(true);
          await routeByRole(data.session.access_token);
          return;
        }
      }catch(cause){
        if (alive) setMessage(cause instanceof Error ? cause.message : "Authentication is unavailable.");
      }
    })();
    return () => { alive = false; };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client) return;
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") || "").trim().toLowerCase();
    const password = String(data.get("password") || "");
    setBusy(true); setMessage(""); setNotice("");
    const result = mode === "signup"
      ? await client.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/signin` } })
      : await client.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (result.error) { setMessage(result.error.message); return; }
    if (mode === "signup" && !result.data.session) {
      setNotice("Check your email to confirm your account, then sign in.");
      return;
    }
    if (result.data.session?.access_token) await routeByRole(result.data.session.access_token);
  };

  const oauth = async (provider: "google" | "azure") => {
    if (!client) { setMessage("Authentication is still loading."); return; }
    setMessage("");
    // Returns here, not to /app, so the role-aware redirect stays in one place.
    const { error } = await client.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${location.origin}/signin`, ...(provider === "azure" ? { scopes: "email" } : {}) },
    });
    if (error) setMessage(error.message);
  };

  return (
    <main className="login-page">
      <section className="login-story" aria-label="EduAI Learning X-Ray introduction">
        <div className="login-story-inner">
          <img className="login-logo" src="/brand/logo.png" alt="EduAI Hub" />
          <p className="eyebrow">EduAI Learning X-Ray</p>
          <h1>Turn learning evidence into the right next step.</h1>
          <p className="login-lead">Teacher-approved grading, clear concept diagnosis and practical interventions - without rankings or surveillance.</p>
          <div className="login-proof">
            <article><span>01</span><div><b>Evidence first</b><small>Every insight links back to approved student work.</small></div></article>
            <article><span>02</span><div><b>Teacher authority</b><small>AI suggestions stay drafts until you approve them.</small></div></article>
            <article><span>03</span><div><b>Action ready</b><small>Move from a gap to a focused intervention in minutes.</small></div></article>
          </div>
        </div>
      </section>

      <section className="login-panel" aria-label="Sign in">
        <div className="login-card">
          <img className="login-mobile-logo" src="/brand/logo.png" alt="EduAI Hub" />
          <p className="eyebrow">{mode === "login" ? "Welcome back" : "Create your account"}</p>
          <h2>{mode === "login" ? "Sign in to Learning X-Ray" : "Create your Learning X-Ray account"}</h2>
          <p>Use your school account to securely access your workspace.</p>
          {resuming && <p className="insight" role="status">You are already signed in. Taking you to your workspace…</p>}

          <div className="provider-grid" aria-label="Supported school sign-in providers">
            <button type="button" onClick={() => void oauth("google")} disabled={!client}><b>G</b><span>Continue with Google</span></button>
            <button type="button" onClick={() => void oauth("azure")} disabled={!client}><b>⊞</b><span>Continue with Microsoft</span></button>
            <button type="button" onClick={() => document.querySelector<HTMLInputElement>('input[name="email"]')?.focus()}><b>@</b><span>Use email and password</span></button>
          </div>

          <div className="login-divider"><span>or sign in with email</span></div>

          <form onSubmit={submit}>
            <label>Email address<input name="email" type="email" autoComplete="email" required/></label>
            <label>Password<input name="password" type="password" minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} required/></label>
            {message && <p className="form-error" role="alert">{message}</p>}
            {notice && <p className="insight" role="status">{notice}</p>}
            <button className="primary full" data-testid="sign-in" disabled={busy || !client}>
              {busy ? "Please wait…" : mode === "login" ? "Sign in securely" : "Create account"}
            </button>
          </form>

          <button className="secondary full" type="button" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setMessage(""); setNotice(""); }}>
            {mode === "login" ? "New teacher? Create an account" : "Already have an account? Sign in"}
          </button>

          <p className="login-note"><span>●</span> Secure sign-in · Session protection · Audit history</p>
          <footer><a href="/">Home</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><span>© 2026 EduAI Hub</span></footer>
        </div>
      </section>
    </main>
  );
}
