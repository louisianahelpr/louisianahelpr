import { launch, persona, BASE, log, restQ, ANON, SB } from "./lib.mjs";
const b=await launch(); const {page,userId}=await persona(b,"poster");
await page.goto(`${BASE}/my-posts`,{waitUntil:"domcontentloaded"}); await page.waitForTimeout(6000);
const out = await page.evaluate(async ([uid,sb,anon]) => {
  const k=Object.keys(localStorage).find(x=>x.includes("auth-token"));
  const t=JSON.parse(localStorage.getItem(k)).access_token;
  const h={apikey:anon,Authorization:`Bearer ${t}`,"Content-Type":"application/json"};
  const ins=await fetch(`${sb}/rest/v1/jobs`,{method:"POST",headers:{...h,Prefer:"return=representation"},
    body:JSON.stringify({customer_id:uid,title:"GHOST-CANCEL-PROBE",description:"Audit probe for the unfunded-cancel gap. Not a real job.",
      category:"cleaning",budget:25,location:"Baton Rouge, LA",date_needed:new Date(Date.now()+3*864e5).toISOString().slice(0,10),
      status:"open",payment_status:"unpaid",pricing_mode:"set_price",parish:null})});
  const insBody = await ins.text();
  if(!ins.ok) return {step:"insert",status:ins.status,body:insBody};
  const job=JSON.parse(insBody)[0];
  const pay=await fetch(`${sb}/functions/v1/create-payment`,{method:"POST",headers:h,body:JSON.stringify({action:"escrow",jobId:job.id})});
  return {step:"done", jobId:job.id, payStatus:pay.status, pay:(await pay.text()).slice(0,120)};
},[userId,SB,ANON]);
log(JSON.stringify(out,null,1));
if(out.jobId){ log("ROW:", JSON.stringify((await restQ(`jobs?id=eq.${out.jobId}&select=id,status,payment_status,stripe_session_id`))[0])); }
await b.close();
