import { launch, persona, shot, grabToasts, BASE, log, restQ } from "./lib.mjs";
const MARK = process.env.MARK || `EJ-LOOP-${Date.now().toString().slice(-6)}`;
const b = await launch();
const { page } = await persona(b, "poster");
const net = [];
page.on("response", r => { const u = r.url(); if (u.includes("/functions/v1/") || u.includes("/rpc/")) net.push(`${r.status()} ${u.split("/").pop().slice(0,60)}`); });

await page.goto(`${BASE}/post-job`, { waitUntil: "domcontentloaded" });
await page.getByText("Start Fresh").waitFor({ timeout: 30000 });
await page.getByText("Start Fresh").click();
await page.locator("#title").waitFor({ timeout: 20000 });

await page.getByRole("button", { name: "Cleaning", exact: true }).click();
await page.locator("#title").fill(MARK.slice(0, 32));
await page.locator("#description").fill("End-to-end audit journey job. Deep clean one bathroom and the kitchen. Not a real job.");
await page.locator("#streetAddress").fill("100 Audit Way");
await page.locator("#city").fill("Baton Rouge");
// #state is readonly and pre-filled "LA" by design
await page.locator("#zipCode").fill("70801");
log("submit label after basics:", await page.locator("button[type=submit]").first().innerText());

// date
await page.locator("#date").click();
await page.waitForTimeout(700);
await shot(page, "P3-datepicker");
const days = page.locator('[role="dialog"] button, [data-radix-popper-content-wrapper] button');
const n = await days.count();
let picked = false;
for (let i = n - 1; i >= 0; i--) {
  const t = (await days.nth(i).innerText().catch(() => "")).trim();
  const dis = await days.nth(i).isDisabled().catch(() => true);
  if (/^\d{1,2}$/.test(t) && !dis) { await days.nth(i).click(); picked = true; log("picked day", t); break; }
}
log("date picked:", picked);
await page.waitForTimeout(500);
await page.keyboard.press("Escape");
await page.locator("#budget").fill("40");
await page.waitForTimeout(800);
await shot(page, "P3-form-filled");
const label = await page.locator("button[type=submit]").first().innerText();
log("submit label now:", JSON.stringify(label));
await page.locator("button[type=submit]").first().click();
await page.waitForTimeout(3000);
await shot(page, "P3-after-submit");
log("URL:", page.url());
log("BODY:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,900));
log("toasts:", await grabToasts(page, 2500));
log("net:", net);
process.env.MARK = MARK; log("MARK=", MARK);
await b.close();
