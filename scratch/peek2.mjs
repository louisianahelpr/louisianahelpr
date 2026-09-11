import { launch, persona, shot, BASE, log } from "./lib.mjs";
const [role, route, tag, expandRe] = process.argv.slice(2);
const b=await launch(); const {page}=await persona(b,role);
await page.goto(`${BASE}${route}`, { waitUntil:"domcontentloaded" });
await page.waitForTimeout(10000);
const sw = page.getByRole("button",{name:new RegExp(expandRe,"i")});
if (await sw.count()) { await sw.first().click(); await page.waitForTimeout(2500); }
const card = page.getByText("EJLOOP050383").first();
if (await card.count()) { await card.click(); await page.waitForTimeout(2500); }
await shot(page,tag);
log("BODY:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,1600));
log("buttons:", await page.$$eval("button", ns=>ns.filter(n=>n.offsetParent).map(n=>n.innerText.replace(/\s+/g," ").trim()).filter(Boolean)));
await b.close();
