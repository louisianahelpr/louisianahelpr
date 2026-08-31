import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const SESSION = JSON.parse(readFileSync("/tmp/lh-session.json","utf8"));
const b = await chromium.launch({ channel: "chrome" });
const ctx = await b.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
await ctx.addInitScript((s)=>{localStorage.setItem("helpr_onboarding",JSON.stringify({completed:true,currentStep:0,completedSteps:[]}));sessionStorage.setItem("helpr.browseView","map");localStorage.setItem(s.key,s.value);},SESSION);
const p = await ctx.newPage();
await p.goto("http://localhost:5251/dashboard",{waitUntil:"domcontentloaded"});
await p.waitForSelector('[data-testid="browse-map-surface"]',{timeout:30000});
await p.waitForTimeout(6000);
const data = await p.evaluate(()=>{
  const pins=[...document.querySelectorAll(".browse-map-pin")];
  const rows = pins.map(el=>({pe:getComputedStyle(el).pointerEvents, ti:el.getAttribute("tabindex"), ah:el.getAttribute("aria-hidden")}));
  return {
    total: pins.length,
    collapsed: rows.filter(r=>r.pe==="none").length,
    collapsedStillFocusable: rows.filter(r=>r.pe==="none" && r.ti==="0").length,
    liveNotFocusable: rows.filter(r=>r.pe!=="none" && r.ti!=="0").length,
    clusters: document.querySelectorAll(".browse-map-cluster").length,
    clustersFocusable: [...document.querySelectorAll(".browse-map-cluster")].filter(c=>c.getAttribute("tabindex")==="0").length,
    sample: rows.slice(0,6),
  };
});
console.log(JSON.stringify(data,null,2));
await b.close();
