import { launch, persona, shot, BASE, log } from "./lib.mjs";
const [role, route, tag] = process.argv.slice(2);
const b=await launch(); const {page}=await persona(b,role);
await page.goto(`${BASE}${route}`, { waitUntil:"domcontentloaded" });
await page.waitForTimeout(11000);
await shot(page,tag);
log("BODY:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,1400));
log("buttons:", await page.$$eval("button", ns=>ns.filter(n=>n.offsetParent).map(n=>n.innerText.replace(/\s+/g," ").trim()).filter(Boolean)));
await b.close();
