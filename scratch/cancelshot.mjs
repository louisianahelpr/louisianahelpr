import { launch, persona, shot, grabToasts, BASE, log, restQ } from "./lib.mjs";
import fs from "node:fs";
const JOB=process.argv[2], MARK="GHOST-CANCEL-PROBE";
const OUT="docs/audit/launch-2026-09/lanes/e2e/shots";
fs.mkdirSync(OUT,{recursive:true});
const b=await launch(); const {page}=await persona(b,"poster");
await page.goto(`${BASE}/my-posts?filter=waiting`,{waitUntil:"domcontentloaded"});
await page.getByText(MARK).first().waitFor({timeout:45000});
await page.getByText(MARK).first().click(); await page.waitForTimeout(2500);
await page.getByRole("button",{name:"Cancel job"}).first().click();
await page.waitForTimeout(2500);
await page.screenshot({path:`${OUT}/unfunded-cancel-dialog-375.png`});
log("shot dialog");
const conf=page.locator('[role="dialog"] button, [role="alertdialog"] button').filter({hasText:/Cancel Job/i}).last();
await conf.click();
for (let i=0;i<40;i++){ const tx=await page.$$eval("[data-sonner-toast]",ns=>ns.map(n=>n.innerText.replace(/\s+/g," ").trim()));
  if (tx.some(x=>/cancelled/i.test(x))) { await page.screenshot({path:`${OUT}/unfunded-cancel-toast-375.png`}); log("TOAST SHOT:", JSON.stringify(tx)); break; }
  await page.waitForTimeout(200); }
log("ROW AFTER:", JSON.stringify(await restQ(`jobs?id=eq.${JOB}&select=status,payment_status`)));
await b.close();
