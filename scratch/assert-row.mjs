import { chromium } from "playwright"; import fs from "node:fs";
const s=JSON.parse(fs.readFileSync("scratch/sess-poster.json","utf8"));
const b=await chromium.launch({headless:true});
const ctx=await b.newContext({viewport:{width:375,height:812},deviceScaleFactor:2});
await ctx.addInitScript(([k,v])=>{localStorage.setItem(k,v);localStorage.setItem("helpr_onboarding",JSON.stringify({completed:true,currentStep:0,completedSteps:[]}));},[s.key,s.value]);
const p=await ctx.newPage();
await p.goto("http://localhost:8347/my-posts?filter=waiting",{waitUntil:"domcontentloaded"});
await p.waitForTimeout(11000);
const nn=p.getByRole("button",{name:/^Not now$/i}); if(await nn.count()){await nn.click().catch(()=>{});await p.waitForTimeout(1200);}
await p.getByText("Mow and edge the front yard").first().click(); await p.waitForTimeout(3000);
const txt=(await p.innerText("body")).replace(/\s+/g," ");
const i=txt.indexOf("Mow and edge the front yard");
const seg=txt.slice(i,i+900);
console.log("CARD SEGMENT:\n", seg);
for (const [label,re] of [["Job tracking",/Job tracking/],["Applicants",/Applicants/],["Boost",/Boost/],["Payment not finished",/Payment not finished/],["Finish paying",/Finish paying/]]) {
  console.log(`  ${label.padEnd(22)} present-in-card: ${re.test(seg)}`);
}
await b.close();
