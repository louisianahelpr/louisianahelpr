import { chromium } from "playwright";
const BASE="http://localhost:4201"; const b=await chromium.launch();
const c=await b.newContext({viewport:{width:375,height:812}}); let p=await c.newPage();
await p.goto(BASE+"/browse",{waitUntil:"networkidle"}); await p.waitForTimeout(800);
console.log("card titles tag", await p.$$eval('[class*=font-display]', e=>e.slice(0,5).map(x=>x.tagName+":"+x.textContent.trim().slice(0,30))));
await p.click('text=Walk two dogs'); await p.waitForTimeout(900); console.log("list card tap →", p.url().replace(BASE,"")); await p.screenshot({path:"shots/op-browse-cardtap-375.png",fullPage:true});
// pet care chip
await p.goto(BASE+"/browse",{waitUntil:"networkidle"}); await p.waitForTimeout(600); await p.click('button[aria-label="Filters"]'); await p.waitForTimeout(600); await p.click('[role=dialog] button:has-text("Pet Care")'); await p.waitForTimeout(400);
await p.screenshot({path:"shots/op-browse-filters-petcare-375.png"});
const closeBtn = await p.$('[role=dialog] button[aria-label*="lose"]'); if(closeBtn) await closeBtn.click(); await p.waitForTimeout(900);
await p.screenshot({path:"shots/op-browse-petcare-375.png",fullPage:true});
console.log("petcare list", (await p.evaluate(()=>document.body.innerText)).replace(/\n+/g," | ").slice(0,300));
// clear chip
const clear = await p.$('button:has-text("Clear"), button[aria-label*="lear"], button[aria-label*="emove"]'); if(clear){await clear.click(); await p.waitForTimeout(600); console.log("after clear", (await p.evaluate(()=>document.body.innerText)).replace(/\n+/g," | ").slice(0,120));}
// distance chip without location
await p.goto(BASE+"/browse",{waitUntil:"networkidle"}); await p.waitForTimeout(600); await p.click('button[aria-label="Filters"]'); await p.waitForTimeout(600); await p.click('[role=dialog] button:has-text("10 mi")'); await p.waitForTimeout(1500);
await p.screenshot({path:"shots/op-browse-filters-10mi-375.png"});
console.log("10mi dialog text", (await p.evaluate(()=>document.body.innerText)).replace(/\n+/g," | ").slice(0,400));
// scroll sheet to bottom
await p.evaluate(()=>{const d=document.querySelector('[role=dialog]'); const sc=[...d.querySelectorAll('*')].find(e=>e.scrollHeight>e.clientHeight+10); if(sc) sc.scrollTop=1e5;}); await p.waitForTimeout(400);
await p.screenshot({path:"shots/op-browse-filters-bottom-375.png"});
// legal search
await p.goto(BASE+"/legal",{waitUntil:"networkidle"});
await p.click('button[aria-label*="earch" i]'); await p.waitForTimeout(700); await p.screenshot({path:"shots/op-legal-search-open-375.png"});
console.log("legal inputs", await p.$$eval('input', e=>e.map(x=>x.placeholder+"|"+x.type)));
const inp = await p.$('input[type=search], input[type=text]'); if(inp){await inp.type("fee"); await p.waitForTimeout(900); await p.screenshot({path:"shots/op-legal-search-fee-375.png",fullPage:true}); console.log("legal search", (await p.evaluate(()=>document.body.innerText)).replace(/\n+/g," | ").slice(0,400));}
await p.goto(BASE+"/legal",{waitUntil:"networkidle"});
const acc = await p.$('button:has-text("Eligibility")'); await acc.click(); await p.waitForTimeout(700); console.log("accordion", await acc.getAttribute("aria-expanded"), await acc.getAttribute("data-state")); await p.screenshot({path:"shots/op-legal-accordion-375.png",fullPage:true});
await b.close();
