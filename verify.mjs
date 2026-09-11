import { chromium } from "playwright";
const BASE="http://localhost:4201"; const b=await chromium.launch();
for (const theme of ["light","dark"]) {
const c=await b.newContext({viewport:{width:375,height:812},colorScheme:theme}); const p=await c.newPage();
await p.goto(BASE+"/signup-pending",{waitUntil:"networkidle"}); await p.waitForTimeout(500);
console.log(theme,"signup-pending footer:",await p.$("footer")!==null,"navbar Get Started:",await p.$('nav a[href="/signup"], header a[href="/signup"]')!==null);
await p.screenshot({path:`shots/after-signup-pending-375-${theme}.png`,fullPage:true});
await p.goto(BASE+"/nope",{waitUntil:"networkidle"}); await p.waitForTimeout(500);
console.log(theme,"404 wordmark:",await p.evaluate(()=>{const m=[...document.querySelectorAll('main a[href="/"] span')].map(s=>[s.textContent.trim(),getComputedStyle(s).fontFamily.split(',')[0],getComputedStyle(s).fontStyle]);return JSON.stringify(m)}));
await p.screenshot({path:`shots/after-404-375-${theme}.png`,fullPage:true});
await p.goto(BASE+"/browse",{waitUntil:"networkidle"}); await p.waitForTimeout(600); await p.click('button[aria-label="Filters"]'); await p.waitForTimeout(600); await p.click('[role=dialog] button:has-text("Pet Care")'); await p.waitForTimeout(1200);
console.log(theme,"pet care chip:",await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==="Pet Care"&&b.getAttribute("aria-pressed")==="true"); const r=b.getBoundingClientRect(); return JSON.stringify({left:Math.round(r.left),right:Math.round(r.right),visible:r.left>=0&&r.right<=375,bg:getComputedStyle(b).backgroundImage.slice(0,40),color:getComputedStyle(b).color,iconColor:getComputedStyle(b.querySelector('svg')).color})}));
await p.screenshot({path:`shots/after-browse-petcare-375-${theme}.png`});
await c.close();}
await b.close();
