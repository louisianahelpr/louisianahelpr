import { launch, persona, shot, grabToasts, BASE, log, restQ } from "./lib.mjs";
const MARK = `EJLOOP${Date.now().toString().slice(-6)}`;
const b = await launch();
const { page } = await persona(b, "poster");
const fnNet = [];
page.on("response", async r => { const u=r.url(); if(u.includes("/functions/v1/")) fnNet.push(`${r.status()} ${u.split("/functions/v1/")[1].slice(0,40)}`); });

log("### MARK", MARK);
await page.goto(`${BASE}/post-job`, { waitUntil: "domcontentloaded" });
await page.getByText("Start Fresh").waitFor({ timeout: 30000 });
await page.getByText("Start Fresh").click();
await page.locator("#title").waitFor({ timeout: 20000 });
await page.getByRole("button", { name: "Cleaning", exact: true }).click();
await page.locator("#title").fill(MARK);
await page.locator("#description").fill("End-to-end audit journey job. Deep clean one bathroom and the kitchen. Not a real job.");
await page.locator("#streetAddress").fill("100 Audit Way");
await page.locator("#city").fill("Baton Rouge");
await page.locator("#zipCode").fill("70801");
await page.locator("#date").click(); await page.waitForTimeout(700);
const days = page.locator('[role="dialog"] button, [data-radix-popper-content-wrapper] button');
for (let i = await days.count() - 1; i >= 0; i--) {
  const t = (await days.nth(i).innerText().catch(()=>"" )).trim();
  if (/^\d{1,2}$/.test(t) && !(await days.nth(i).isDisabled().catch(()=>true))) { await days.nth(i).click(); break; }
}
await page.keyboard.press("Escape");
await page.locator("#budget").fill("40");
await page.waitForTimeout(900);
await page.locator("button[type=submit]").first().click();
await page.waitForTimeout(2500);
await shot(page, "H1-order-summary");

// confirm checkbox then pay
const cb = page.getByRole("checkbox").last();
log("checkbox count:", await page.getByRole("checkbox").count());
await cb.click({ force: true });
await page.waitForTimeout(700);
const payBtn = page.locator("button").filter({ hasText: /Pay|Continue|Confirm/i }).last();
log("pay label:", JSON.stringify((await payBtn.innerText()).replace(/\s+/g," ")));
await shot(page, "H2-confirmed");
await payBtn.click();
await page.waitForTimeout(8000);
log("URL after pay click:", page.url());
await shot(page, "H3-stripe");
log("fn net:", fnNet);
log("body:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,400));
import("node:fs").then(fs => fs.writeFileSync(new URL("./mark.txt", import.meta.url), MARK));
await new Promise(r => setTimeout(r, 500));
await b.close();
