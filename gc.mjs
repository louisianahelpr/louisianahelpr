import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newContext().then(c=>c.newPage());
await p.setViewportSize({width:393,height:852});
await p.goto("http://localhost:8090/browse", { waitUntil:"networkidle" }).catch(()=>{});
await p.waitForTimeout(2500);
console.log("on /browse as guest:", p.url());
// find the first job card and click it
const card = await p.$('[data-testid*="job"], article, [role="button"][class*="card"], a[href^="/jobs/"]');
if (!card) { console.log("no card found — listing candidate clickables:"); 
  const c = await p.$$eval('a[href*="/jobs"], [class*="card"]', els=>els.slice(0,5).map(e=>e.tagName+" "+(e.getAttribute("href")||e.className).slice(0,60)));
  console.log(c);
} else {
  await card.click().catch(()=>{});
  await p.waitForTimeout(2000);
  console.log("after clicking a job card ->", p.url());
  console.log("body:", (await p.evaluate(()=>document.body.innerText.replace(/\s+/g," ").slice(0,180))));
}
await b.close();
