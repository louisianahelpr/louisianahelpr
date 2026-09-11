import { launch, persona, shot, grabToasts, BASE, log, restQ } from "./lib.mjs";
import fs from "node:fs";
const MARK = `EJLOOP${Date.now().toString().slice(-6)}`;
const b = await launch();
const { page } = await persona(b, "poster");
const fn = [];
page.on("response", r => { const u=r.url(); if(u.includes("/functions/v1/")) fn.push(`${r.status()} ${u.split("/functions/v1/")[1].slice(0,40)}`); });
log("### MARK", MARK);

await page.goto(`${BASE}/post-job`, { waitUntil: "domcontentloaded" });
await page.getByText("Start Fresh").waitFor({ timeout: 40000 });
await page.getByText("Start Fresh").click();
await page.locator("#title").waitFor({ timeout: 25000 });
await page.getByRole("button", { name: "Cleaning", exact: true }).click();
await page.locator("#title").fill(MARK);
await page.locator("#description").fill("End-to-end audit journey. Deep clean one bathroom and the kitchen. Not a real job.");
await page.locator("#streetAddress").fill("100 Audit Way");
await page.locator("#city").fill("Baton Rouge");
await page.locator("#zipCode").fill("70801");
await page.locator("#date").click(); await page.waitForTimeout(800);
{ const d = page.locator('[role="dialog"] button, [data-radix-popper-content-wrapper] button');
  for (let i = await d.count()-1; i>=0; i--) { const t=(await d.nth(i).innerText().catch(()=>"")).trim();
    if(/^\d{1,2}$/.test(t) && !(await d.nth(i).isDisabled().catch(()=>true))) { await d.nth(i).click(); break; } } }
await page.keyboard.press("Escape");
await page.locator("#budget").fill("40");
await page.waitForTimeout(1000);
log("submit label:", JSON.stringify((await page.locator("button[type=submit]").first().innerText()).replace(/\s+/g," ")));
await shot(page, "H-prefill");
for (let i=0;i<40;i++){ const en = await page.locator("button[type=submit]").first().isEnabled(); if(i%5===0) log("  submit enabled?", en, JSON.stringify((await page.locator("button[type=submit]").first().innerText()).replace(/\s+/g," "))); if(en) break; await page.waitForTimeout(1000);}
await page.locator("button[type=submit]").first().click();
await page.waitForTimeout(2500);
await shot(page, "H-review");
await page.getByRole("checkbox").last().click({ force: true });
await page.waitForTimeout(600);
await page.locator("button").filter({ hasText: /Continue to Payment|Pay/i }).last().click();
await page.waitForURL(/checkout\.stripe\.com/, { timeout: 60000 });
const cu = page.url();
log("checkout:", cu.slice(0,80));
if (!/\/cs_test_/.test(cu)) { log("!!! NOT TEST MODE — ABORTING"); await b.close(); process.exit(1); }
log("TEST MODE confirmed (cs_test_)");
await page.waitForTimeout(3500);
await shot(page, "H-stripe");
await page.getByPlaceholder("1234 1234 1234 1234").fill("4242424242424242");
await page.getByPlaceholder("MM / YY").fill("12 / 34");
await page.getByPlaceholder("CVC").fill("123");
for (const [ph,v] of [["12345","70801"],["Full name on card","Perry Poster"]]) {
  const l = page.getByPlaceholder(ph); if (await l.count()) await l.fill(v);
}
await shot(page, "H-card");
await page.getByTestId("hosted-payment-submit-button").click();
await page.waitForURL(/localhost:8347/, { timeout: 180000 });
await page.waitForTimeout(5000);
log("landed:", page.url());
await shot(page, "H-payment-success");
log("BODY:", (await page.innerText("body")).replace(/\s+/g," ").slice(0,600));
const rows = await restQ(`jobs?title=eq.${MARK}&select=id,status,payment_status,stripe_session_id`);
const JOB = rows[0].id;
log("job:", JOB);
for (let i=0;i<20;i++){ const j=(await restQ(`jobs?id=eq.${JOB}&select=status,payment_status`))[0];
  log(`  poll t+${i*3}s`, JSON.stringify(j)); if(j.payment_status==="escrow") break; await page.waitForTimeout(3000); }
fs.writeFileSync(new URL("./job.txt", import.meta.url), JSON.stringify({ MARK, JOB }));
log("fn:", fn);
await b.close();
