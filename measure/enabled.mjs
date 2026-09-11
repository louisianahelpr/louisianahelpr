import { chromium } from "playwright";
import fs from "node:fs";
const port = process.argv[2], label = process.argv[3];
const sess = JSON.parse(fs.readFileSync(new URL("./session.json", import.meta.url)));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport:{width:375,height:812}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
await ctx.addInitScript(({key,val})=>{
  try{window.localStorage.setItem(key,val);}catch{}
  try{window.localStorage.setItem("helpr_onboarding",JSON.stringify({completed:true,currentStep:0,completedSteps:[]}));}catch{}
  window.__shifts=[];
  new PerformanceObserver(l=>{for(const e of l.getEntries()){if(e.hadRecentInput)continue;window.__shifts.push({t:Math.round(e.startTime),v:e.value,srcs:(e.sources||[]).map(s=>(s.node&&s.node.nodeName||"?")+"."+((s.node&&String(s.node.className||"").slice(0,40))||""))});}}).observe({type:"layout-shift",buffered:true});
},{key:sess.key,val:sess.value});
// Force the "payouts already enabled" answer, delayed like a slow edge fn.
await ctx.route(/functions\/v1\/stripe-connect/, async route => {
  await new Promise(r=>setTimeout(r,2500));
  await route.fulfill({ status:200, contentType:"application/json",
    headers:{"access-control-allow-origin":"*"},
    body: JSON.stringify({connected:true,details_submitted:true,payouts_enabled:true}) });
});
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Network.enable");
await cdp.send("Network.setCacheDisabled",{cacheDisabled:true});
await cdp.send("Emulation.setCPUThrottlingRate",{rate:4});
await page.goto(`http://localhost:${port}/profile`,{waitUntil:"commit"});
let reserved=null;
for(let i=0;i<400;i++){
  const r=await page.evaluate(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.getAttribute("aria-hidden")==="true"&&x.disabled);return b?b.getBoundingClientRect().height:null;});
  if(r){reserved=r; await page.screenshot({path:`/tmp/shot-${label}-reserving.png`}); break;}
  await page.waitForTimeout(50);
}
await page.waitForTimeout(9000);
await page.screenshot({path:`/tmp/shot-${label}-resolved.png`});
const shifts=await page.evaluate(()=>window.__shifts);
console.log(JSON.stringify({label,reservedHeight:reserved,cls:+shifts.reduce((a,s)=>a+s.v,0).toFixed(4),shifts},null,1));
await browser.close();
