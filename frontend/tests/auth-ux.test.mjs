import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const signin = read("app/signin/page.tsx");
const roles  = read("lib/roles.ts");
const parent = read("app/parent/page.tsx");
const appUi  = read("app/ui/FunctionalEduAIApp.tsx");

test("/signin performs real authentication instead of linking to /app", () => {
  // All four buttons used to be decorative links to /app, where the actual
  // authentication lived.
  assert.doesNotMatch(signin, /href="\/app"/);
  assert.match(signin, /signInWithPassword/);
  assert.match(signin, /signInWithOAuth/);
  assert.match(signin, /signUp/);
});

test("both OAuth providers are wired", () => {
  assert.match(signin, /oauth\("google"\)/);
  assert.match(signin, /oauth\("azure"\)/);
  assert.match(signin, /Continue with Google/);
  assert.match(signin, /Continue with Microsoft/);
  assert.match(signin, /Use email and password/);
});

test("OAuth returns to /signin so the role redirect stays in one place", () => {
  // Returning straight to /app would put the routing decision in two places.
  assert.match(signin, /redirectTo: `\$\{location\.origin\}\/signin`/);
});

test("the landing map is shared, not duplicated at each redirect site", () => {
  assert.match(roles, /export const LANDING/);
  assert.match(roles, /Parent:\s+"\/parent"/);
  for (const r of ["SuperAdmin","SchoolAdmin","Teacher"]) {
    assert.match(roles, new RegExp(`${r}:\\s+"/app"`));
  }
  // Pre-M7 value must not fall through to Teacher and lose an admin's access.
  assert.match(roles, /if \(role === "Admin"\) return "SchoolAdmin"/);
});

test("a signed-in user with no profile is sent to /app, not a role landing", () => {
  // Until a profile row exists the role is unknown, and /app owns the
  // profile-completion form.
  assert.match(roles, /if \(!profile\) return "\/app"/);
});

test("/app sends anonymous visitors to /signin", () => {
  assert.match(appUi, /if\(!session\)return <RedirectToSignIn/);
  assert.match(appUi, /function RedirectToSignIn/);
  // The profile-completion step stays in /app.
  assert.match(appUi, /if\(needsProfile\|\|!profile\)return <TeacherAuth/);
});

test("signing out lands on the public sign-in page", () => {
  assert.match(appUi, /signOut\(\);[\s\S]{0,120}location\.replace\("\/signin"\)/);
});

test("/parent exists and reads the read model, not a workspace blob", () => {
  assert.ok(existsSync(new URL("../app/parent/page.tsx", import.meta.url)));
  assert.match(parent, /\/api\/parent\/children/);
  assert.doesNotMatch(parent, /workspace_snapshots|\/api\/workspace/);
});

test("/parent redirects a non-parent to their own landing", () => {
  // A teacher reaching /parent should be routed, not shown an error for a page
  // that was never theirs.
  assert.match(parent, /response\.status===403/);
  assert.match(parent, /landingPath\(profile\?\.profile\)/);
});

test("/signin renders its form on first paint", () => {
  // It briefly gated everything behind a session check, so the page
  // server-rendered as a spinner.
  assert.doesNotMatch(signin, /if \(checking\)/);
  assert.match(signin, /resuming/);
});
