import { launch, persona, shot, grabToasts, BASE, log, restQ } from "./lib.mjs";
import path from "node:path";
const JOB="e6979a12-ee25-46c9-98f5-c088189849e5", MARK="EJLOOP050383";
const b=await launch(); const {page}=await persona(b,"helper");
await page.goto(`${BASE}/my-jobs?filter=scheduled`, { waitUntil:"domcontentloaded" });
await page.waitForTimeout(10000);
await page.getByText(MARK).first().click(); await page.waitForTimeout(3000);
const inputs = await page.$$eval("input[type=file]", ns=>ns.map(n=>({id:n.id,accept:n.accept,multiple:n.multiple,cls:n.className.slice(0,40)})));
log("file inputs:", JSON.stringify(inputs));
const fi = page.locator("input[type=file]");
const n = await fi.count(); log("count:", n);
const dir = path.resolve("scratch");
for (let i=0;i<n;i++){
  const f = i===0 ? "before.png" : "after.png";
  await fi.nth(i).setInputFiles(path.join(dir,f)).catch(e=>log("set fail",i,String(e).slice(0,80)));
  log("uploaded", f, "into input", i);
  log("toasts:", await grabToasts(page, 6000));
  await page.waitForTimeout(2000);
}
await shot(page,"PH-after-upload");
log("BODY:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,1200));
log("ROW:", JSON.stringify((await restQ(`jobs?id=eq.${JOB}&select=proof_before_urls,proof_after_urls`))[0]));
await b.close();
