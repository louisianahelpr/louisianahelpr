import { webkit } from "playwright";
const BASE="http://localhost:4201"; const b=await webkit.launch();
const c=await b.newContext({viewport:{width:375,height:812}}); const p=await c.newPage();
const errs=[]; p.on("pageerror",e=>errs.push(String(e).slice(0,120)));
for (const r of ["/","/browse","/login","/signup","/forgot-password","/reset-password","/legal","/support","/help","/signup-pending","/nope"]) {
  await p.goto(BASE+r,{waitUntil:"networkidle"}).catch(()=>{}); await p.waitForTimeout(800);
  const m = await p.evaluate(()=>({sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth,scale:getComputedStyle(document.documentElement).getPropertyValue('--user-text-scale').trim(),h1:document.querySelector('h1')?.textContent.trim().slice(0,30)}));
  await p.screenshot({path:`shots/wk${r.replace(/\//g,"-")||"-root"}-375.png`,fullPage:true});
  console.log(r, JSON.stringify(m));
}
console.log("pageerrors", errs);
await b.close();
