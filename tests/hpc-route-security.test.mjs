import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

// Execute real route handlers against an in-memory database double. These are
// integration regressions, not claims of live cross-tenant acceptance testing.
function database(tables){
 const writes=[];
 return {writes,from(table){
  let filters=[],single=false,operation='',value;
  const q={lte(k,v){filters.push(r=>r[k]<=v);return q},gte(k,v){filters.push(r=>r[k]>=v);return q},select(){return q},order(){return q},limit(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},is(k,v){filters.push(r=>(r[k]??null)===v);return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},maybeSingle(){single=true;return q},single(){single=true;return q},insert(v){operation='insert';value=v;return q},update(v){operation='update';value=v;return q},upsert(v){operation='upsert';value=v;return q},then(resolve,reject){
   let rows=(tables[table]||[]).filter(r=>filters.every(f=>f(r)));
   if(operation){writes.push({table,operation,value});rows=operation==='update'?rows.map(r=>({...r,...value})):(Array.isArray(value)?value:[value]).map((v,i)=>({id:`saved-${i}`,...v}));}
   return Promise.resolve({data:single?rows[0]||null:rows,error:null,count:rows.length}).then(resolve,reject);
  }};return q;
 }};
}
function moduleAt(path,dependencies){
 const source=fs.readFileSync(new URL(path,import.meta.url),'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const exports={};new Function('require','exports','process',js)(name=>{for(const [suffix,value]of Object.entries(dependencies))if(name.endsWith(suffix))return value;throw Error(`Unexpected dependency ${name}`)},exports,dependencies.process||process);return exports;
}
const profile={id:'teacher',school_id:'school',role:'Teacher',status:'Active'};

for(const [kind,table,status]of [['barriers','hpc_applied_learning_barriers','resolved'],['milestones','hpc_applied_learning_milestones','completed']]){
 test(`${kind} status changes are scoped to the authorized parent record`,async()=>{
  const db=database({hpc_applied_learning_records:[{id:'mine',school_id:'school'},{id:'foreign',school_id:'other'}],[table]:[{id:'item',applied_learning_record_id:'mine',status:'planned'},{id:'unrelated',applied_learning_record_id:'different',status:'planned'}]});
  const route=moduleAt(`../app/api/hpc/applied-learning/[recordId]/${kind}/route.ts`,{'authorization':{getAuthorizedProfile:async()=>profile},'supabase-server':{getSupabaseServer:()=>db}});
  const call=(recordId,body)=>route.PATCH(request(kind,body),{params:Promise.resolve({recordId})});
  const saved=await call('mine',{id:'item',status});assert.equal(saved.status,200);assert.equal((await saved.json()).item.status,status);
  assert.equal((await call('mine',{id:'item',status:'invented'})).status,400);
  assert.equal((await call('mine',{id:'unrelated',status})).status,404);
  const count=db.writes.length;assert.equal((await call('foreign',{id:'item',status})).status,404);assert.equal(db.writes.length,count);
 });
}
test('portfolio download uses recorded uploader and preserves bytes',async()=>{
 const db=database({hpc_evidence:[{id:'e',school_id:'school',contributor_user_id:'uploader',attachment_reference:JSON.stringify({fileId:'file',fileName:'sample.txt'})}]});
 let requested;db.storage={from:()=>({download:async path=>{requested=path;return {data:new Blob(['synthetic portfolio'],{type:'text/plain'}),error:null}}})};
 const route=moduleAt('../app/api/hpc/evidence/[evidenceId]/file/route.ts',{'authorization':{getAuthorizedProfile:async()=>profile},'supabase-server':{getSupabaseServer:()=>db,SUPABASE_FILES_BUCKET:'private'}});
 const response=await route.GET(request('evidence/e/file'),{params:Promise.resolve({evidenceId:'e'})});assert.equal(response.status,200);assert.equal(await response.text(),'synthetic portfolio');assert.equal(requested,'uploader/uploads/file');
});
test('foreign portfolio and certificate downloads are denied before storage access',async()=>{
 const db=database({hpc_evidence:[{id:'e',school_id:'other'}],hpc_applied_learning_records:[{id:'r',school_id:'other'}]});
 for(const [path,param]of [['evidence/[evidenceId]/file',{evidenceId:'e'}],['applied-learning/[recordId]/course-proof/file',{recordId:'r'}]]){
  const route=moduleAt(`../app/api/hpc/${path}/route.ts`,{'authorization':{getAuthorizedProfile:async()=>profile},'supabase-server':{getSupabaseServer:()=>db}});assert.equal((await route.GET(request('files'),{params:Promise.resolve(param)})).status,404);
 }
});
test('certificate download preserves bytes and uploader ownership',async()=>{
 const db=database({hpc_applied_learning_records:[{id:'r',school_id:'school'}],hpc_applied_learning_course_proofs:[{applied_learning_record_id:'r',uploaded_by:'uploader',proof_reference:JSON.stringify({fileId:'certificate',fileName:'certificate.pdf'})}]});
 db.storage={from:()=>({download:async path=>{assert.equal(path,'uploader/uploads/certificate');return {data:new Blob(['%PDF-1.7 synthetic'],{type:'application/pdf'}),error:null}}})};
 const route=moduleAt('../app/api/hpc/applied-learning/[recordId]/course-proof/file/route.ts',{'authorization':{getAuthorizedProfile:async()=>profile},'supabase-server':{getSupabaseServer:()=>db}});
 const response=await route.GET(request('proof'),{params:Promise.resolve({recordId:'r'})});assert.equal(await response.text(),'%PDF-1.7 synthetic');
});
test('course proof rejects negative hours and retains zero',async()=>{
 const db=database({hpc_applied_learning_records:[{id:'r',school_id:'school',record_type:'online_course'}]});
 const route=moduleAt('../app/api/hpc/applied-learning/[recordId]/course-proof/route.ts',{'authorization':{getAuthorizedProfile:async()=>profile},'supabase-server':{getSupabaseServer:()=>db}});
 for(const hours of [-1,0]){const response=await route.POST(request('proof',{providerName:'Synthetic',courseName:'Test course',proofReference:'{}',completionStatus:'in_progress',hoursCompleted:hours}),{params:Promise.resolve({recordId:'r'})});assert.equal(response.status,hours<0?400:200);if(hours===0)assert.equal((await response.json()).proof.hours_completed,0)}
});
const request=(path,body)=>new Request(`https://hpc.invalid/api/hpc/${path}`,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
test('bulk observations keep individual values and stable IDs on retries',async()=>{
 const db=database({hpc_learner_profiles:[{id:'l1',school_id:'school',grade:7,academic_year:'2026-27'},{id:'l2',school_id:'school',grade:8,academic_year:'2026-27'}],hpc_stage_templates:[{framework_version_id:'fw',is_active:true,'hpc_framework_versions.status':'approved',grade_from:6,grade_to:8}]});
 const route=moduleAt('../app/api/hpc/observations/bulk/route.ts',{'authorization':{getAuthorizedProfile:async()=>profile},'supabase-server':{getSupabaseServer:()=>db}});
 const body={batchId:'11111111-1111-4111-a111-111111111111',entries:[{learnerId:'l1',note:'First synthetic observation',confidence:'high'},{learnerId:'l2',note:'Second synthetic observation',confidence:'low'}]};
 for(let n=0;n<2;n++){const response=await route.POST(request('observations/bulk',body));assert.equal(response.status,200);assert.equal((await response.json()).results.length,2)}
 const evidence=db.writes.filter(w=>w.table==='hpc_evidence');assert.equal(evidence[0].value.id,evidence[2].value.id);assert.equal(evidence[1].value.id,evidence[3].value.id);assert.notEqual(evidence[0].value.id,evidence[1].value.id);
 assert.equal(evidence[0].value.review_status,'teacher_review_required');assert.equal(evidence[1].value.content,'Second synthetic observation');
 const details=db.writes.filter(w=>w.table==='hpc_teacher_observations');assert.equal(details[0].value.confidence,'high');assert.equal(details[1].value.confidence,'low');
});
test('bulk invalid or foreign learners fail without writes',async()=>{
 const db=database({});const route=moduleAt('../app/api/hpc/observations/bulk/route.ts',{'authorization':{getAuthorizedProfile:async()=>profile},'supabase-server':{getSupabaseServer:()=>db}});
 for(const entries of [[null],[{learnerId:'foreign',note:'Test',confidence:'high'}]]){const r=await route.POST(request('observations/bulk',{batchId:'11111111-1111-4111-a111-111111111111',entries}));assert.ok([400,403].includes(r.status))}assert.equal(db.writes.length,0);
});
test('Interventions list contains only current teachers same-school actions',async()=>{
 const db=database({hpc_holistic_support_actions:[{id:'mine',school_id:'school',created_by:'teacher'},{id:'other-teacher',school_id:'school',created_by:'other'},{id:'other-school',school_id:'elsewhere',created_by:'teacher'}]});
 const route=moduleAt('../app/api/hpc/support-actions/route.ts',{'authorization':{getAuthorizedProfile:async()=>profile},'supabase-server':{getSupabaseServer:()=>db}});
 const r=await route.GET(request('support-actions'));assert.deepEqual((await r.json()).actions.map(a=>a.id),['mine']);
});
test('contributor links reject tampered, expired and revoked tokens',async()=>{
 const secret='synthetic-test-secret-not-a-credential';
 const sign=async exp=>{const payload=Buffer.from(JSON.stringify({i:'link',exp})).toString('base64url');const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return payload+'.'+Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload))).toString('base64url')};
 const db=database({hpc_share_links:[{id:'link',school_id:'school',learner_profile_id:'learner',revoked_at:'2026-01-01',expires_at:new Date(Date.now()+60000).toISOString()}]});
 const route=moduleAt('../app/api/hpc/shares/[token]/route.ts',{'supabase-server':{getSupabaseServer:()=>db},process:{env:{SUPABASE_SECRET_KEY:secret}}});
 for(const token of ['bad.signature',await sign(Date.now()-1000),await sign(Date.now()+60000)]){
  assert.equal((await route.GET(request(`shares/${token}`))).status,403);
  assert.equal((await route.POST(request(`shares/${token}`,{content:'Synthetic feedback',contributorName:'Test Contributor'}))).status,400);
 }
 assert.equal(db.writes.length,0);
});
test('public contribution respects the school flag and learner stage framework',async()=>{
 const secret='synthetic-test-secret-not-a-credential',payload=Buffer.from(JSON.stringify({i:'link',exp:Date.now()+60000})).toString('base64url');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const token=payload+'.'+Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload))).toString('base64url');
 const base={hpc_share_links:[{id:'link',school_id:'school',learner_profile_id:'learner',contribution_type:'parent_feedback',expires_at:new Date(Date.now()+60000).toISOString(),revoked_at:null,submission_count:0,hpc_learner_profiles:{academic_year:'2026-27',grade:7,students:{name:'Synthetic'}}}],hpc_stage_templates:[{is_active:true,grade_from:6,grade_to:8,framework_version_id:'middle-framework'}]};
 for(const enabled of [false,true]){
  const db=database({...base,hpc_school_settings:[{school_id:'school',enabled}]});
  const route=moduleAt('../app/api/hpc/shares/[token]/route.ts',{'supabase-server':{getSupabaseServer:()=>db},process:{env:{SUPABASE_SECRET_KEY:secret}}});
  const response=await route.POST(request(`shares/${token}`,{content:'Synthetic parent feedback',contributorName:'Test Parent'}));
  assert.equal(response.status,enabled?200:400);
  const evidence=db.writes.find(w=>w.table==='hpc_evidence');
  if(enabled)assert.equal(evidence.value.framework_version_id,'middle-framework');else assert.equal(evidence,undefined);
 }
});
function auth(db,role='Teacher'){return moduleAt('../lib/authorization.ts',{'supabase-auth':{getAuthenticatedUser:async()=>({id:'teacher'}),unauthorized:()=>new Response(null,{status:401})},'supabase-server':{getSupabaseServer:()=>db}})}
for(const role of ['Student','Parent','Unknown'])test(`HPC refuses ${role} role`,async()=>{
 const db=database({users:[{...profile,role}]});assert.equal((await auth(db).getAuthorizedProfile(request('learners'))).status,403);
});
test('HPC disabled blocks data but permits foundation status',async()=>{
 const db=database({users:[profile],hpc_school_settings:[{school_id:'school',enabled:false}]});const a=auth(db);
 assert.equal((await a.getAuthorizedProfile(request('learners'))).status,403);
 assert.equal((await a.getAuthorizedProfile(request('foundation'))).id,'teacher');
});
test('active enabled teacher is accepted and non-HPC authorization unchanged',async()=>{
 const db=database({users:[profile],hpc_school_settings:[{school_id:'school',enabled:true}]});assert.equal((await auth(db).getAuthorizedProfile(request('learners'))).id,'teacher');
 assert.equal((await auth(database({users:[profile]})).getAuthorizedProfile(new Request('https://hpc.invalid/api/workspace'))).id,'teacher');
});
test('share creation refuses foreign-school learner before writing',async()=>{
 const db=database({hpc_learner_profiles:[{id:'foreign',school_id:'other'}]});const route=moduleAt('../app/api/hpc/shares/route.ts',{'authorization':{getAuthorizedProfile:async()=>profile},'supabase-server':{getSupabaseServer:()=>db}});
 assert.equal((await route.POST(request('shares',{learnerId:'foreign',type:'parent_feedback'}))).status,404);assert.equal(db.writes.length,0);
});
test('final report snapshot and generated narrative exclude excluded and pending evidence',async()=>{
 const sources=['teacher_observation','student_reflection','peer_feedback','parent_feedback'];
 const approved=sources.map((source_type,i)=>({id:`e${i}`,school_id:'school',learner_profile_id:'learner',source_type,content:`approved-${i}`,review_status:'approved'}));
 const db=database({hpc_learner_profiles:[{id:'learner',school_id:'school',grade:7,academic_year:'2026-27',students:{name:'Synthetic'}}],hpc_stage_templates:[{id:'template',stage_code:'middle',is_active:true,framework_version_id:'framework',hpc_template_sections:[{required:true}]}],hpc_framework_versions:[{id:'framework',status:'approved'}],hpc_evidence:[...approved,...['excluded','teacher_review_required'].map(review_status=>({id:review_status,school_id:'school',learner_profile_id:'learner',source_type:'peer_feedback',content:'DO-NOT-INCLUDE',review_status}))],hpc_evidence_mappings:approved.map(e=>({evidence_id:e.id})),hpc_ability_assessments:[{school_id:'school',learner_profile_id:'learner',perspective:'teacher',ability_id:'ability',calculated_level:'proficient'}],hpc_scoring_rules:[{id:'rule',framework_version_id:'framework',stage_code:'middle',status:'approved'}]});
 const route=moduleAt('../app/api/hpc/annual-reports/route.ts',{'authorization':{getAuthorizedProfile:async()=>profile},'supabase-server':{getSupabaseServer:()=>db}});
 const response=await route.POST(request('annual-reports',{learnerId:'learner',action:'finalize',teacherApproval:true}));const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
 assert.equal(body.reportPayload.evidenceCount,4);assert.ok(!body.summary.narrative_text.includes('DO-NOT-INCLUDE'));
 const snapshots=db.writes.find(w=>w.table==='hpc_report_evidence_snapshot').value;assert.deepEqual(snapshots.map(x=>x.evidence_id),approved.map(x=>x.id));
});
