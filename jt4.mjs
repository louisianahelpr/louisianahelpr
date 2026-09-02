import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newContext().then(c=>c.newPage());
await p.setViewportSize({width:393,height:852});
await p.goto("http://localhost:8095/jobs", { waitUntil:"networkidle" }).catch(()=>{});
await p.waitForTimeout(4000);
console.log("text:", (await p.evaluate(()=>document.body.innerText.replace(/\s+/g," ").slice(0,300))));
await b.close();
