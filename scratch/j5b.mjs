import { launch, persona, shot, BASE, log } from "./lib.mjs";
const b = await launch();
const { page } = await persona(b, "poster");
await page.goto(`${BASE}/my-posts`, { waitUntil: "domcontentloaded" });
await page.getByText(/Show Waiting/).waitFor({ timeout: 30000 });
await page.getByText(/Show Waiting/).click();
await page.waitForTimeout(2500);
await shot(page, "N2-waiting");
log("BODY:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,1400));
const card = page.getByText("EJLOOP050383").first();
log("card count:", await card.count());
if (await card.count()) {
  await card.click(); await page.waitForTimeout(2000);
  await shot(page, "N3-unpaid-expanded");
  log("EXPANDED:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,1600));
  log("buttons:", await page.$$eval("button", ns=>ns.filter(n=>n.offsetParent).map(n=>n.innerText.replace(/\s+/g," ").trim()).filter(Boolean)));
}
await b.close();
