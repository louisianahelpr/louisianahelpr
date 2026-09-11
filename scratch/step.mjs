// Generic: as <role>, on <route>, open MARK card, click <button>, report state.
import { launch, persona, shot, grabToasts, BASE, log, restQ } from "./lib.mjs";
const [role, route, btnRe, tag] = process.argv.slice(2);
const JOB="e6979a12-ee25-46c9-98f5-c088189849e5", MARK="EJLOOP050383";
const b=await launch(); const {page}=await persona(b,role);
await page.goto(`${BASE}${route}`, { waitUntil:"domcontentloaded" });
await page.getByText(MARK).first().waitFor({timeout:45000});
await page.getByText(MARK).first().click().catch(()=>{});
await page.waitForTimeout(2500);
await shot(page,`${tag}-before`);
log("BEFORE:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,800));
const btns = await page.$$eval("button", ns=>ns.filter(n=>n.offsetParent).map(n=>n.innerText.replace(/\s+/g," ").trim()).filter(Boolean));
log("buttons:", btns);
const target = page.getByRole("button",{name:new RegExp(btnRe,"i")}).first();
if (!(await target.count())) { log(`!! no button matching ${btnRe}`); await b.close(); process.exit(0); }
log("clicking:", await target.innerText());
await target.click();
const t = await grabToasts(page, 8000);
log("TOASTS:", t);
await page.waitForTimeout(2500);
await shot(page,`${tag}-after`);
log("AFTER:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,900));
log("buttons after:", await page.$$eval("button", ns=>ns.filter(n=>n.offsetParent).map(n=>n.innerText.replace(/\s+/g," ").trim()).filter(Boolean)));
log("JOB ROW:", JSON.stringify((await restQ(`jobs?id=eq.${JOB}&select=status,payment_status,helper_confirmed_at,helper_on_the_way_at,helper_arrived_at,helper_completed_at,poster_completed_at`))[0]));
await b.close();
