import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const filesUnder = dir => readdirSync(new URL(`../${dir}`, import.meta.url), { recursive: true, withFileTypes: true })
  .filter(e => e.isFile() && /\.(ts|tsx)$/.test(e.name))
  .map(e => `${e.parentPath.split("/frontend/")[1]}/${e.name}`);

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const client = read("lib/django-api.ts");
const register = read("app/register-school/page.tsx");
const app = read("app/ui/FunctionalEduAIApp.tsx");
const config = read("app/api/auth/config/route.ts");

// ---------------------------------------------------------------- API client

test("the Django client sends the Supabase access token", () => {
  assert.match(client, /Authorization: `Bearer \$\{token\}`/);
  assert.match(client, /auth\.getSession\(\)/);
});

test("the Django client refuses to guess a base URL", () => {
  // A wrong guess would send bearer tokens to whatever host resolved.
  assert.match(client, /if \(!djangoApiUrl\)/);
  assert.match(client, /not_configured/);
  assert.doesNotMatch(client, /localhost:8000|127\.0\.0\.1:8000/);
});

test("a request without a session fails before it is sent", () => {
  assert.match(client, /if \(!token\) throw new ApiError/);
});

test("the base URL is served from the server, never hardcoded in the bundle", () => {
  assert.match(config, /process\.env\.DJANGO_API_URL/);
  assert.match(client, /fetch\("\/api\/auth\/config"/);
});

test("the error envelope is unwrapped rather than shown raw", () => {
  for (const part of ["envelope?.detail", "class ApiError", "fields"]) {
    assert.ok(client.includes(part), `missing ${part}`);
  }
});

// ---------------------------------------------------------------- register

test("registration never lets the caller choose status or role", () => {
  // The server ignores them anyway; sending them would imply otherwise.
  const body = register.slice(register.indexOf("djangoApi.post"), register.indexOf("setSubmitted"));
  for (const forbidden of ["status", "role"]) {
    assert.ok(!body.includes(`${forbidden}:`), `register posts ${forbidden}`);
  }
});

test("an anonymous visitor is sent to sign in first", () => {
  // Django cannot create the identity: public.users.id references auth.users.id.
  assert.match(register, /accessToken\(\)/);
  assert.match(register, /\/signin\?next=\/register-school/);
});

test("registration shows the pending state rather than a workspace", () => {
  assert.match(register, /Awaiting review/);
  assert.match(register, /schools\/mine/);
});

// ---------------------------------------------------------------- directory

test("the school directory only offers transitions the API allows", () => {
  const actions = app.slice(app.indexOf("const SCHOOL_ACTIONS"), app.indexOf("const SCHOOL_STATUS_TONE"));
  assert.match(actions, /Pending:\[\{verb:"approve"[\s\S]*verb:"reject"/);
  assert.match(actions, /Active:\[\{verb:"suspend"/);
  assert.match(actions, /Suspended:\[\{verb:"reactivate"/);
  assert.match(actions, /Closed:\[\]/);
});

test("reject, suspend and reactivate require a written reason", () => {
  const section = app.slice(app.indexOf("const SCHOOL_ACTIONS"), app.indexOf("function AppDialog("));
  // Approve is the only transition that needs no justification.
  assert.match(section, /verb:"reject",label:"Reject",needsReason:true/);
  assert.match(section, /verb:"suspend",label:"Suspend",needsReason:true/);
  assert.match(section, /verb:"reactivate",label:"Reactivate",needsReason:true/);
  assert.match(section, /verb:"approve",label:"Approve",needsReason:false/);
  assert.match(section, /reason\.trim\(\)\.length<10/);
});

test("the directory reads the platform API, not the workspace snapshot", () => {
  const panel = app.slice(app.indexOf("function SchoolDirectory("), app.indexOf("function AppDialog("));
  assert.match(panel, /djangoApi\.get<\{results:DirectorySchool\[\]\}>/);
  assert.doesNotMatch(panel, /state\.schools/);
});

test("the Schools module renders the directory instead of placeholders", () => {
  assert.match(app, /module==="Schools"\?<SchoolDirectory notify=\{notify\}\/>/);
});

// ---------------------------------------------------------------- styling

test("new surfaces introduce no new CSS classes", () => {
  // The visual language is fixed: new screens compose from the existing design
  // system rather than adding to it.
  const css = ["app/globals.css", "app/marketing.css", "app/persistence.css"]
    .map(read).join("\n");
  const defined = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m => m[1]));

  const panel = app.slice(app.indexOf("function SchoolDirectory("), app.indexOf("function AppDialog("));
  const used = new Set();
  for (const source of [register, panel]) {
    for (const m of source.matchAll(/className="([^"$]*)"/g)) {
      for (const name of m[1].split(/\s+/).filter(Boolean)) used.add(name);
    }
  }
  const missing = [...used].filter(name => !defined.has(name));
  assert.deepEqual(missing, [], `new UI needs undefined classes: ${missing.join(", ")}`);
});

// ---------------------------------------------------------------- credentials

test("the frontend holds no AI provider credential", () => {
  // The keys live in the Django service. A route that reads one again would
  // reintroduce a second place to rotate and a second place to leak from.
  const sources = ["app", "lib"].flatMap(dir => filesUnder(dir));
  const offenders = sources.filter(file => {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    return /OPENAI_API_KEY|MISTRAL_API_KEY|api\.openai\.com|api\.mistral\.ai/.test(src);
  });
  assert.deepEqual(offenders, [], `provider credentials reappeared in: ${offenders.join(", ")}`);
});

test("AI calls go through the analysis service", () => {
  for (const route of ["app/api/grade/route.ts", "app/api/generate-worksheet/route.ts",
                       "app/api/generate-study-guide/route.ts", "app/api/generate-assessment/route.ts"]) {
    assert.match(read(route), /from "\.\.\/\.\.\/\.\.\/lib\/ai-proxy"/, `${route} bypasses the proxy`);
  }
});

test("the grading prompt's student name is redacted before it leaves", () => {
  // The confirmed finding: grade/route.ts embeds the real student name. The
  // proxy swaps it for a placeholder and maps it back on the response.
  const grade = read("app/api/grade/route.ts");
  assert.match(grade, /redact: body\.studentName\?\.trim\(\)/);
  // The "Student" fallback is a label, not an identity - redacting it would
  // mangle every other use of the word in the prompt.
  assert.match(grade, /\? \{ student_name: body\.studentName\.trim\(\) \} : \{\}/);
});
