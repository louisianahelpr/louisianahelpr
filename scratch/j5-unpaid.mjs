import { launch, persona, shot, grabToasts, BASE, log } from "./lib.mjs";
const b = await launch();
const { page } = await persona(b, "poster");
await page.goto(`${BASE}/my-posts`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);
await shot(page, "N1-myposts");
log("BODY:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,1200));
// expand the EJLOOP card
const card = page.getByText("EJLOOP050383", { exact: false }).first();
if (await card.count()) { await card.click(); await page.waitForTimeout(1500); await shot(page, "N2-unpaid-expanded");
  log("EXPANDED:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,1500));
  log("buttons:", await page.$$eval("button", ns=>ns.filter(n=>n.offsetParent).map(n=>n.innerText.replace(/\s+/g," ").trim()).filter(Boolean)));
} else log("card not found");
await b.close();
