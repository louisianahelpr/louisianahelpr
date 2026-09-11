import { launch, persona, shot, grabToasts, BASE, log, restQ } from "./lib.mjs";
const [role, route, tabName, btnRe, tag] = process.argv.slice(2);
const JOB="e6979a12-ee25-46c9-98f5-c088189849e5", MARK="EJLOOP050383";
const b=await launch(); const {page}=await persona(b,role);
await page.goto(`${BASE}${route}`, { waitUntil:"domcontentloaded" });
await page.waitForTimeout(10000);
await shot(page,`${tag}-landing`);
log("LANDING:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,600));
const tab=page.getByRole("button",{name:new RegExp("^"+tabName,"i")}).first();
log("tab found:", await tab.count());
if (await tab.count()) { await tab.click(); await page.waitForTimeout(3000); }
const card=page.getByText(MARK).first();
if (await card.count()) { await card.click(); await page.waitForTimeout(2500); } else log("!! card not on this tab");
await shot(page,`${tag}-tab`);
log("TAB BODY:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,1400));
log("buttons:", await page.$$eval("button", ns=>ns.filter(n=>n.offsetParent).map(n=>n.innerText.replace(/\s+/g," ").trim()).filter(Boolean)));
if (btnRe!=="-") { const t=page.getByRole("button",{name:new RegExp(btnRe,"i")}).first();
  if (await t.count()) { log("clicking:", await t.innerText()); await t.click();
    if(process.env.FOLLOW){await page.waitForTimeout(1500);const f=page.getByRole("button",{name:new RegExp(process.env.FOLLOW,"i")}).first(); if(await f.count()){await f.click();log("follow",process.env.FOLLOW);} }
    log("TOASTS:", await grabToasts(page,8000)); await page.waitForTimeout(2000); await shot(page,`${tag}-after`);
    log("AFTER:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,1200)); }
  else log(`!! no button /${btnRe}/`); }
log("ROW:", JSON.stringify((await restQ(`jobs?id=eq.${JOB}&select=status,payment_status,helper_arrived_at,poster_confirmed_arrival_at,helper_completed_at,poster_completed_at`))[0]));
await b.close();
