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
await p.evaluate(()=>{document.querySelector(".browse-map-pin").focus();});
await p.keyboard.press("Tab"); // real keyboard move -> :focus-visible
await p.waitForTimeout(400);
console.log(JSON.stringify(await p.evaluate(()=>{
  const el=document.activeElement;
  return {cls:el.className, name:el.getAttribute("aria-label"),
    matchesFV: el.matches(":focus-visible"),
    outline: getComputedStyle(el).outline, outlineOffset: getComputedStyle(el).outlineOffset,
    rect: el.getBoundingClientRect().toJSON()};
})));
const r = await p.evaluate(()=>{const r=document.activeElement.getBoundingClientRect();return {x:Math.max(0,r.x-30),y:Math.max(0,r.y-30),width:Math.min(r.width+60, innerWidth-Math.max(0,r.x-30)),height:r.height+60};});
await p.screenshot({ path: "/tmp/lh-map-shots/focus-ring-zoom.png", clip: r });
await b.close();
