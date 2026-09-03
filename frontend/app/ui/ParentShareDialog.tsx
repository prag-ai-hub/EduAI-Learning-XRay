"use client";
import { useRef, useState } from "react";

// Structural props rather than an import from FunctionalEduAIApp: this dialog
// reads two fields off the workspace and should not be coupled to its whole
// state type.
type ShareableAssessment={id:string;gradeResults?:Record<string,{studentName?:string}>};
type ParentShareDialogProps={
  state:{assessments:ShareableAssessment[]};
  /** "<assessmentId>:<fileId>" */
  id:string;
  done:()=>void;
};
/** What POST /api/shares returns on success - all three fields always present. */
type ShareLink={url:string;studentName:string;expiresAt:string};

export default function ParentShareDialog({state,id,done}:ParentShareDialogProps){
  const [assessmentId,fileId]=id.split(":");const assessment=state.assessments.find(item=>item.id===assessmentId);const result=assessment?.gradeResults?.[fileId];
  const [share,setShare]=useState<ShareLink|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[days,setDays]=useState(30);
  const [copyStatus,setCopyStatus]=useState("");const linkInput=useRef<HTMLInputElement>(null);
  const create=async()=>{setBusy(true);setError("");try{const token=sessionStorage.getItem("eduai-access-token")||"";const response=await fetch("/api/shares",{method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify({assessmentId,fileId,expiresInDays:days})});const payload=await response.json();if(!response.ok)throw new Error(payload.error);setShare(payload)}catch(reason){setError(reason instanceof Error?reason.message:"QR code could not be created")}finally{setBusy(false)}};
  if(!assessment||!result)return <><header><p>Parent access</p><h2>Student analysis unavailable</h2></header><p className="form-error">This student analysis could not be found.</p></>;
  const qrUrl=share?`https://api.qrserver.com/v1/create-qr-code/?size=320x320&format=png&data=${encodeURIComponent(share.url)}`:"";
  const copyLink=async()=>{if(!share)return;setCopyStatus("");try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(share.url)}else{const input=linkInput.current;if(!input)throw new Error("Copy unavailable");input.focus();input.select();if(!document.execCommand("copy"))throw new Error("Copy unavailable")}setCopyStatus("Link copied") }catch{const input=linkInput.current;input?.focus();input?.select();setCopyStatus("Press Ctrl+C to copy the selected link")}};
  return <><header><p className="eyebrow">Student-specific parent access</p><h2>{`Share ${result.studentName}'s dashboard`}</h2></header><p className="modal-copy">Create a signed QR code for this student only. Parents can view reports without an account; the link expires automatically.</p>{!share?<><label>Access duration<select value={days} onChange={event=>setDays(Number(event.target.value))}><option value={7}>7 days</option><option value={30}>30 days</option><option value={60}>60 days</option><option value={90}>90 days</option></select></label>{error&&<p className="form-error">{error}</p>}<button className="primary full" disabled={busy} onClick={create}>{busy?"Creating secure access…":"Generate student QR code"}</button></>:<div className="parent-share-panel"><img src={qrUrl} alt={`QR code for ${result.studentName}'s learning dashboard`}/><b>{result.studentName}</b><small>Expires {new Date(share.expiresAt).toLocaleDateString()}</small><input ref={linkInput} readOnly value={share.url}/>{copyStatus&&<small role="status">{copyStatus}</small>}<div className="button-row"><a className="secondary" href={`mailto:?subject=${encodeURIComponent(result.studentName+" learning dashboard")}&body=${encodeURIComponent("Open the secure student dashboard: "+share.url)}`}>Email</a><a className="secondary" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(result.studentName+" learning dashboard: "+share.url)}`}>WhatsApp</a><button className="secondary" onClick={copyLink}>Copy link</button><a className="secondary" href={qrUrl} target="_blank" rel="noreferrer">Open QR image</a></div><button className="primary full" onClick={done}>Done</button></div>}</>;
}
