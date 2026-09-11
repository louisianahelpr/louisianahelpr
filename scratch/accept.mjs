import { launch, persona, shot, grabToasts, BASE, log, restQ } from "./lib.mjs";
const JOB="e6979a12-ee25-46c9-98f5-c088189849e5", MARK="EJLOOP050383";
log("helper notifs:", JSON.stringify((await restQ(`notifications?user_id=eq.437de07d-1bd7-46c8-a451-6b46aa3bcad5&select=type,title,message,link,created_at&order=created_at.desc&limit=3`))));
const b=await launch(); const {page}=await persona(b,"helper");
await page.goto(`${BASE}/my-jobs`, { waitUntil:"domcontentloaded" });
await page.waitForTimeout(10000);
await shot(page,"AC1-myjobs");
log("BODY:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,900));
log("buttons:", await page.$$eval("button", ns=>ns.filter(n=>n.offsetParent).map(n=>n.innerText.replace(/\s+/g," ").trim()).filter(Boolean).slice(0,25)));
const card=page.getByText(MARK).first();
if (await card.count()) { await card.click(); await page.waitForTimeout(2500); await shot(page,"AC2-expanded");
  log("EXPANDED:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,1100));
  log("buttons2:", await page.$$eval("button", ns=>ns.filter(n=>n.offsetParent).map(n=>n.innerText.replace(/\s+/g," ").trim()).filter(Boolean).slice(0,30))); }
await b.close();
