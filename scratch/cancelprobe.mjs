import { launch, persona, shot, grabToasts, BASE, log, restQ } from "./lib.mjs";
const JOB="dda61bd2-1e8f-4e4e-a848-6a42d9cc89f2", MARK="GHOST-CANCEL-PROBE";
const b=await launch(); const {page}=await persona(b,"poster");
const net=[];
page.on("response", async r=>{const u=r.url(); if(/rest\/v1\/jobs|functions\/v1|rpc\//.test(u)) net.push(`${r.status()} ${r.request().method()} ${u.replace(/https:\/\/[^/]+/,"").slice(0,90)}`);});
await page.goto(`${BASE}/my-posts?filter=waiting`,{waitUntil:"domcontentloaded"});
await page.getByText(MARK).first().waitFor({timeout:45000});
await page.getByText(MARK).first().click(); await page.waitForTimeout(2500);
await shot(page,"GC-card");
log("CARD:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,900));
log("buttons:", await page.$$eval("button", ns=>ns.filter(n=>n.offsetParent).map(n=>n.innerText.replace(/\s+/g," ").trim()).filter(Boolean)));
const c=page.getByRole("button",{name:"Cancel job"}).first();
log("cancel present:", await c.count());
await c.click(); await page.waitForTimeout(2500);
await shot(page,"GC-cancel-dialog");
log("DIALOG:", (await page.innerText("body")).replace(/\s+/g," ").slice(-800));
log("dialog buttons:", await page.$$eval('[role="dialog"] button, [role="alertdialog"] button', ns=>ns.map(n=>n.innerText.replace(/\s+/g," ").trim()).filter(Boolean)));
// try to confirm
const conf=page.locator('[role="dialog"] button, [role="alertdialog"] button').filter({hasText:/cancel|confirm|yes|delete/i}).filter({hasNotText:/Keep/i}).last();
if(await conf.count()){ log("confirming with:", await conf.innerText()); await conf.click();
  log("TOASTS:", await grabToasts(page,9000)); await page.waitForTimeout(2500); await shot(page,"GC-after"); }
const rows=await restQ(`jobs?id=eq.${JOB}&select=id,status,payment_status`);
log("ROW AFTER:", JSON.stringify(rows));
log("NET:", net.filter(n=>!n.includes("GET")).slice(-12));
await b.close();
