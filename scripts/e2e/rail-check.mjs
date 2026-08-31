import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const SESSION = JSON.parse(readFileSync("/tmp/lh-session.json","utf8"));
const b = await chromium.launch({ channel: "chrome" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await ctx.addInitScript((s)=>{localStorage.setItem("helpr_onboarding",JSON.stringify({completed:true,currentStep:0,completedSteps:[]}));sessionStorage.setItem("helpr.browseView","map");localStorage.setItem(s.key,s.value);},SESSION);
const p = await ctx.newPage();
await p.goto("http://localhost:5251/dashboard",{waitUntil:"domcontentloaded"});
await p.waitForSelector('[data-testid="browse-map-surface"]',{timeout:30000});
await p.waitForTimeout(6000);
const out = await p.evaluate(()=>{
  const railW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--desktop-sidebar-w"))||0;
  const frame = document.querySelector(".app-shell-frame");
  const fr = frame?.getBoundingClientRect();
  // find the desktop rail nav (contains "Post a Job")
  const rail = [...document.querySelectorAll("aside,nav,div")].find(e=>{
    const r=e.getBoundingClientRect();
    return Math.abs(r.width-railW)<40 && r.height>400 && /Post a Job/.test(e.textContent||"");
  });
  const rr = rail?.getBoundingClientRect();
  const pane = document.querySelector('[data-testid="browse-map-surface"]').getBoundingClientRect();
  return {
    railW,
    frame: fr && {x:fr.x,w:fr.width,right:fr.right},
    rail: rr && {x:rr.x,w:rr.width,right:rr.right,side: rr.x < innerWidth/2 ? "left":"right"},
    pane: {x:pane.x,w:pane.width,right:pane.right},
    paneClearOfRail: rr ? (pane.right <= rr.x + 1 || pane.x >= rr.right - 1) : null,
    docScrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
  };
});
console.log(JSON.stringify(out,null,2));
await b.close();
