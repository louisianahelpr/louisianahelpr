import { launch, persona, shot, grabToasts, BASE, log, restQ } from "./lib.mjs";
const [role, url, btnRe, tag] = process.argv.slice(2);
const JOB="e6979a12-ee25-46c9-98f5-c088189849e5", MARK="EJLOOP050383";
const b=await launch(); const {page}=await persona(b,role);
await page.goto(`${BASE}${url}`, { waitUntil:"domcontentloaded" });
await page.waitForTimeout(10000);
const nn=page.getByRole("button",{name:/^Not now$/i}); if(await nn.count()){await nn.click().catch(()=>{});await page.waitForTimeout(1500);}
const card=page.getByText(MARK).first();
if (await card.count()) { await card.click(); await page.waitForTimeout(3000); } else log("!! card not found");
await shot(page,`${tag}-before`);
log("BEFORE:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,1400));
const btns = await page.$$eval("button", ns=>ns.filter(n=>n.offsetParent).map(n=>n.innerText.replace(/\s+/g," ").trim()).filter(Boolean));
log("buttons:", btns);
if (btnRe!=="-") {
  const t=page.getByRole("button",{name:new RegExp(btnRe,"i")}).first();
  if (!(await t.count())) { log(`!! no /${btnRe}/`); }
  else { log("clicking:", await t.innerText(), "enabled:", await t.isEnabled());
    await t.click();
    if(process.env.FOLLOW){await page.waitForTimeout(1800);const f=page.getByRole("button",{name:new RegExp(process.env.FOLLOW,"i")}).first();if(await f.count()){log("follow:",await f.innerText());await f.click();}else log("no follow");}
    log("TOASTS:", await grabToasts(page,9000)); await page.waitForTimeout(2500); await shot(page,`${tag}-after`);
    log("AFTER:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,1200));
    log("buttons after:", await page.$$eval("button", ns=>ns.filter(n=>n.offsetParent).map(n=>n.innerText.replace(/\s+/g," ").trim()).filter(Boolean)));
  }
}
log("ROW:", JSON.stringify((await restQ(`jobs?id=eq.${JOB}&select=status,payment_status,helper_arrived_at,poster_confirmed_arrival_at,poster_confirmed_working_at,helper_completed_at,poster_completed_at`))[0]));
await b.close();
