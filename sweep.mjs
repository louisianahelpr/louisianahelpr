import { chromium } from "playwright";
const REDIRECTS = ["/activity","/availability","/dashboard/post-login","/data-rights","/earnings",
  "/legal/:tab","/privacy","/rules","/saved-helpers","/schedule","/settings","/settings/profile",
  "/terms","/warnings","/pay-it-forward","/wrapped","/pets","/analytics","/auto-tip",
  "/work-record","/home-history","/str-settings"];
const b = await chromium.launch();
const ctx = await b.newContext();
console.log("PATH".padEnd(24), "LANDS ON");
for (const r of REDIRECTS) {
  if (r.includes(":")) { console.log(r.padEnd(24), "(param route — skipped)"); continue; }
  const p = await ctx.newPage();
  await p.goto("http://localhost:8100"+r, { waitUntil:"domcontentloaded" }).catch(()=>{});
  await p.waitForTimeout(1400);
  const u = new URL(p.url());
  const txt = (await p.evaluate(()=>document.body.innerText.replace(/\s+/g," ").slice(0,40))).trim();
  console.log(r.padEnd(24), (u.pathname+u.search).padEnd(34), txt.slice(0,34));
  await p.close();
}
await b.close();
