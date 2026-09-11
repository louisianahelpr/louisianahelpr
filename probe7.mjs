import { chromium } from "playwright";
const BASE="http://localhost:4201"; const b=await chromium.launch();
const c=await b.newContext({viewport:{width:375,height:812}}); const p=await c.newPage();
await p.goto(BASE+"/legal",{waitUntil:"networkidle"});
await p.click('button[aria-label*="earch" i]'); await p.waitForTimeout(700); await p.screenshot({path:"shots/op-legal-search-open-375.png"});
console.log("legal inputs", await p.$$eval('input', e=>e.map(x=>x.placeholder+"|"+x.type)));
const inp = await p.$('input'); if(inp){await inp.type("fee"); await p.waitForTimeout(900); await p.screenshot({path:"shots/op-legal-search-fee-375.png",fullPage:true}); console.log("legal search", (await p.evaluate(()=>document.body.innerText)).replace(/\n+/g," | ").slice(0,300)); await inp.fill("zzzzqqq"); await p.waitForTimeout(700); console.log("legal no-results", (await p.evaluate(()=>document.body.innerText)).replace(/\n+/g," | ").slice(0,200)); await p.screenshot({path:"shots/op-legal-search-none-375.png"});}
await p.goto(BASE+"/legal",{waitUntil:"networkidle"});
const acc = await p.$('button:has-text("Eligibility")'); await acc.click(); await p.waitForTimeout(700); console.log("accordion", await acc.getAttribute("aria-expanded"), await acc.getAttribute("data-state")); await p.screenshot({path:"shots/op-legal-accordion-375.png",fullPage:true});
// guest preview dialog via deep link
await p.goto(BASE+"/browse?job=69f25bbb-cc38-425b-a8fd-104c96fb40f4",{waitUntil:"networkidle"}); await p.waitForTimeout(1500);
console.log("deeplink dialog", !!(await p.$('[role=dialog]')), (await p.evaluate(()=>document.body.innerText)).replace(/\n+/g," | ").slice(0,300));
await p.screenshot({path:"shots/op-browse-deeplink-375.png"});
const btns = await p.$$eval('[role=dialog] button, [role=dialog] a', e=>e.map(x=>(x.getAttribute("aria-label")||x.textContent.trim()).slice(0,30)));
console.log("dialog controls", btns);
const apply = await p.$('[role=dialog] button:has-text("Apply"), [role=dialog] button:has-text("Sign")'); if(apply){await apply.click(); await p.waitForTimeout(800); console.log("apply →", p.url().replace(BASE,""));}
await b.close();
