import { launch, persona, shot, grabToasts, BASE, log, restQ } from "./lib.mjs";
import path from "node:path";
const JOB="e6979a12-ee25-46c9-98f5-c088189849e5", MARK="EJLOOP050383";
const b=await launch(); const {page}=await persona(b,"helper");
await page.goto(`${BASE}/my-jobs?filter=scheduled`, { waitUntil:"domcontentloaded" });
await page.waitForTimeout(10000);
await page.getByText(MARK).first().click(); await page.waitForTimeout(3000);
for (const [label,file] of [["Before Photos","before.png"],["After Photos","after.png"]]) {
  const btn = page.getByRole("button",{name:new RegExp("^"+label,"i")}).first();
  if (!(await btn.count())) { log("!! no button", label); continue; }
  await btn.click(); await page.waitForTimeout(2500);
  await page.locator("input[type=file]").last().setInputFiles(path.resolve("scratch",file));
  await page.waitForTimeout(2000);
  const up = page.getByRole("button",{name:/^Upload$/i}).first();
  log(label, "upload btn:", await up.count(), "enabled:", await up.isEnabled().catch(()=>null));
  await up.click();
  log("toasts:", await grabToasts(page,10000));
  await page.waitForTimeout(3000);
  await shot(page,`P4-${file}`);
  log("PROOF now:", JSON.stringify((await restQ(`jobs?id=eq.${JOB}&select=proof_before_urls,proof_after_urls`))[0]));
}
await page.reload({waitUntil:"domcontentloaded"}); await page.waitForTimeout(8000);
await page.getByText(MARK).first().click().catch(()=>{}); await page.waitForTimeout(2500);
await shot(page,"P4-final");
log("BODY:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,1200));
log("buttons:", await page.$$eval("button", ns=>ns.filter(n=>n.offsetParent).map(n=>n.innerText.replace(/\s+/g," ").trim()).filter(Boolean)));
await b.close();
