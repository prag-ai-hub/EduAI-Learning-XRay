"use client";
import { useState } from "react";

export default function HpcTrackingStatus({recordId,item,kind,request,onSaved}:{
  recordId:string;item:{id:string;status:string;title?:string;barrier_text?:string};
  kind:"milestones"|"barriers";request:typeof fetch;onSaved:()=>void;
}){
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const options=kind==="milestones"?["planned","in_progress","completed","blocked"]:["open","monitoring","resolved"];
  async function change(status:string){
    setBusy(true);setError("");
    try{
      const response=await request(`/api/hpc/applied-learning/${encodeURIComponent(recordId)}/${kind}`,{
        method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:item.id,status})
      });
      const body=await response.json();
      if(!response.ok)throw new Error(body.error||"Unable to update status.");
      onSaved();
    }catch(reason){setError(reason instanceof Error?reason.message:"Unable to update status. Please retry.");}
    finally{setBusy(false);}
  }
  return <div>
    <label>Status for {item.title||item.barrier_text}
      <select value={item.status} disabled={busy} onChange={e=>void change(e.target.value)}>
        {options.map(status=><option key={status} value={status}>{status.replaceAll("_"," ")}</option>)}
      </select>
    </label>
    {busy&&<small role="status">Saving status…</small>}
    {error&&<small role="alert">{error}</small>}
  </div>;
}
