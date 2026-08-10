export default function SignInPage() {
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
          <p className="eyebrow">Welcome back</p>
          <h2>Sign in to Learning X-Ray</h2>
          <p>Use your verified account to securely access your school workspace.</p>
          <a data-testid="sign-in" className="signin-primary" href="/app"><span>✦</span> Sign in securely</a>
          <div className="login-divider"><span>School identity providers</span></div>
          <div className="provider-grid" aria-label="Supported school sign-in providers">
            <a href="/app"><b>G</b><span>Continue with Google</span></a>
            <a href="/app"><b>⊞</b><span>Continue with Microsoft</span></a>
            <a href="/app"><b>@</b><span>Use email and password</span></a>
          </div>
          <p className="login-note"><span>●</span> Secure sign-in · Session protection · Audit history</p>
          <footer><a href="/">Home</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><span>© 2026 EduAI Hub</span></footer>
        </div>
      </section>
    </main>
  );
}
