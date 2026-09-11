import { launch, persona, shot, BASE, log } from "./lib.mjs";
const b = await launch();
const { page } = await persona(b, "poster");
const net = [];
page.on("response", r => { const u=r.url(); if(u.includes("/rest/v1/")||u.includes("/functions/v1/")||u.includes("/auth/v1/")) net.push(`${r.status()} ${r.request().method()} ${u.replace(/https:\/\/[^/]+/,"").slice(0,110)}`); });
page.on("pageerror", e => log("  PAGEERROR:", String(e).slice(0,300)));
await page.goto(`${BASE}/post-job`, { waitUntil: "domcontentloaded" });
for (const t of [3000, 5000, 8000, 12000]) {
  await page.waitForTimeout(t === 3000 ? 3000 : 2000);
  const txt = (await page.innerText("body")).replace(/\s+/g," ").trim();
  log(`t=${t}ms len=${txt.length} :: ${txt.slice(0,220)}`);
}
await shot(page, "P1b-postjob-late");
log("--- network ---"); net.forEach(n=>log("  "+n));
await b.close();
