import { chromium } from "playwright";
const b = await chromium.launch(); const ctx = await b.newContext();
for (const r of ["/pets","/wrapped","/pay-it-forward","/definitely-not-a-route","/legal"]) {
  const p = await ctx.newPage();
  await p.goto("http://localhost:8100"+r, { waitUntil:"domcontentloaded" }).catch(()=>{});
  await p.waitForTimeout(1800);
  const t = (await p.evaluate(()=>document.body.innerText.replace(/\s+/g," "))).trim();
  console.log(`${r.padEnd(26)} -> ${new URL(p.url()).pathname}`);
  console.log(`   ${t.slice(0,150)}`);
  await p.close();
}
await b.close();
