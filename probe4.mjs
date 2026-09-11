import { chromium } from "playwright";
const BASE="http://localhost:4201"; const b=await chromium.launch();
const c=await b.newContext({viewport:{width:375,height:812}}); let p=await c.newPage();
await p.goto(BASE+"/browse",{waitUntil:"networkidle"}); await p.waitForTimeout(600); await p.click('button[aria-label="Filters"]'); await p.waitForTimeout(600); await p.click('[role=dialog] button:has-text("Pet Care")'); await p.waitForTimeout(400);
await p.waitForTimeout(900);
const row = await p.evaluate(()=>{const chips=[...document.querySelectorAll('button')].filter(b=>/^(All|Cleaning|Pet Care|Other)$/.test(b.textContent.trim())); return chips.map(b=>({t:b.textContent.trim(), left:Math.round(b.getBoundingClientRect().left), pressed:b.getAttribute('aria-pressed')||b.getAttribute('data-state')||b.getAttribute('aria-checked'), bg:getComputedStyle(b).backgroundImage.slice(0,25), color:getComputedStyle(b).color, scrollLeft: b.parentElement.scrollLeft}))});
console.log(row);
await b.close();
