import { launch, persona, shot, grabToasts, BASE, log, restQ } from "./lib.mjs";
const JOB="e6979a12-ee25-46c9-98f5-c088189849e5", MARK="EJLOOP050383";
const b=await launch(); const {page,userId}=await persona(b,"helper");
log("helper uid", userId);
await page.goto(`${BASE}/browse`, { waitUntil:"domcontentloaded" });
await page.waitForTimeout(10000);
await shot(page,"X1-helper-browse");
const body=(await page.innerText("body")).replace(/\s+/g," ");
log("job visible in browse:", body.includes(MARK));
log("BODY:", body.slice(0,900));
if (body.includes(MARK)) {
  await page.getByText(MARK).first().click();
  await page.waitForTimeout(2500);
  await shot(page,"X2-job-detail");
  log("DETAIL:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,900));
  log("buttons:", await page.$$eval("button", ns=>ns.filter(n=>n.offsetParent).map(n=>n.innerText.replace(/\s+/g," ").trim()).filter(Boolean).slice(0,25)));
}
await b.close();
