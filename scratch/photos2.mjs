import { launch, persona, shot, grabToasts, BASE, log, restQ } from "./lib.mjs";
import path from "node:path";
const JOB="e6979a12-ee25-46c9-98f5-c088189849e5", MARK="EJLOOP050383";
const b=await launch(); const {page}=await persona(b,"helper");
await page.goto(`${BASE}/my-jobs?filter=scheduled`, { waitUntil:"domcontentloaded" });
await page.waitForTimeout(10000);
await page.getByText(MARK).first().click(); await page.waitForTimeout(3000);
for (const [label,file] of [["Before Photos","before.png"],["After Photos","after.png"]]) {
  const btn = page.getByRole("button",{name:new RegExp(label,"i")}).first();
  log(`--- ${label}: count=${await btn.count()}`);
  await btn.click(); await page.waitForTimeout(2500);
  await shot(page,`PH2-${file}`);
  log("after click body tail:", (await page.innerText("body")).replace(/\s+/g," ").slice(-500));
  const fi = page.locator("input[type=file]");
  log("file inputs now:", await fi.count());
  if (await fi.count()) { await fi.last().setInputFiles(path.resolve("scratch",file)); log("uploaded", file);
    log("toasts:", await grabToasts(page,8000)); await page.waitForTimeout(3000); }
  const close=page.getByRole("button",{name:/^(Done|Close|Save)$/i}).first();
  if (await close.count()) { await close.click(); await page.waitForTimeout(1500); }
}
await shot(page,"PH2-final");
log("ROW:", JSON.stringify((await restQ(`jobs?id=eq.${JOB}&select=proof_before_urls,proof_after_urls`))[0]));
log("BODY:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,1000));
await b.close();
