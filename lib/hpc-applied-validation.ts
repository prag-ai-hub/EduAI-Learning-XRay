export function isSecondaryGrade(grade:unknown):boolean{
  return typeof grade==="number"&&Number.isInteger(grade)&&grade>=9&&grade<=12;
}
export function validateAppliedNumbers(body:Record<string,unknown>):string|null{
  for(const key of ["hoursSpent","credits"]){
    const value=body[key];
    if(value===undefined||value===null||value==="")continue;
    if((typeof value!=="number"&&typeof value!=="string")||!Number.isFinite(Number(value))||Number(value)<0)
      return "Hours and credits must be finite, non-negative numbers.";
  }
  const stage=body.stageNumber;
  if(stage!==undefined&&stage!==null&&stage!==""&&
    ((typeof stage!=="number"&&typeof stage!=="string")||![1,2,3].includes(Number(stage))))
    return "Stage must be 1, 2 or 3.";
  if(body.completionStatus!==undefined&&!["planned","in_progress","completed"].includes(String(body.completionStatus)))
    return "Choose a valid completion status.";
  return null;
}
