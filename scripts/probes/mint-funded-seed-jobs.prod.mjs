// Mint N really-funded is_seed jobs on prod, paid on Stripe TEST mode with
// 4242 4242 4242 4242 through the real hosted Checkout (headless Chromium),
// exactly the way e2e/prod-lifecycle.spec.ts funds its job.
//
//   node scripts/probes/mint-funded-seed-jobs.prod.mjs <n> <out-file>
//
// Each line of <out-file> is "<jobId> <paymentIntentId>". The job is left
// open / payment_status=escrow with a real succeeded PI, for money race probes
// (admin-dispute-race.prod.mjs) that need a capture to refund or transfer from.
// Refuses to pay anything but a cs_test_ session.
import { appendFileSync } from "node:fs";
import { chromium } from "playwright";
import { rest, session, invoke } from "./lib/prodEnv.mjs";

const [nArg, out] = process.argv.slice(2);
const N = Number(nArg);
if (!N || !out) { console.error("usage: <n> <out-file>"); process.exit(2); }
const POSTER = "71c56dfb-b326-4010-b960-b18dd3966e7f";
const posterTok = session("poster-e2e").access_token;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = () => Math.random().toString(36).replace(/[0-9.]/g, "").slice(0, 6);

const browser = await chromium.launch();
let made = 0;
try {
  while (made < N) {
    const [job] = await rest("jobs", {
      method: "POST", prefer: "return=representation",
      body: {
        customer_id: POSTER, is_seed: true, parish: null,
        title: `RACE-FUNDED seed ${tag()}`, description: "funded fixture for a money race probe",
        category: "cleaning", location: "Baton Rouge, LA",
        date_needed: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10),
        budget: 20, status: "open", payment_status: "unpaid", pricing_mode: "set_price",
      },
    });
    const esc = await invoke("create-payment", posterTok, { action: "escrow", jobId: job.id });
    if (esc.status === 429) { await rest(`jobs?id=eq.${job.id}`, { method: "DELETE" }); await sleep(60_000); continue; }
    const url = esc.json?.url;
    if (!url || !String(url).includes("cs_test_")) {
      await rest(`jobs?id=eq.${job.id}`, { method: "DELETE" });
      throw new Error(`refusing: escrow returned ${esc.status} ${JSON.stringify(esc.json).slice(0, 200)}`);
    }
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      const card = page.locator("#cardNumber");
      const radio = page.getByRole("radio").first();
      await card.or(radio).first().waitFor({ state: "visible", timeout: 60_000 });
      if (!(await card.isVisible().catch(() => false))) await radio.click({ force: true });
      await card.waitFor({ state: "visible", timeout: 30_000 });
      await card.fill("4242 4242 4242 4242");
      await page.locator("#cardExpiry").fill("12 / 34");
      await page.locator("#cardCvc").fill("123");
      for (const [id, v] of [["#billingName", "Race Probe"], ["#billingAddressLine1", "100 Audit Way"], ["#billingLocality", "Baton Rouge"], ["#billingPostalCode", "70801"]]) {
        const f = page.locator(id);
        if ((await f.count()) && (await f.isVisible().catch(() => false))) { await f.fill(v).catch(() => {}); await page.keyboard.press("Escape").catch(() => {}); }
      }
      const link = page.locator("#enableStripePass");
      if ((await link.count()) && (await link.isChecked().catch(() => false))) await link.uncheck({ force: true }).catch(() => {});
      await page.getByTestId("hosted-payment-submit-button").click();
      await page.waitForURL((u) => !u.host.endsWith("checkout.stripe.com"), { timeout: 120_000 });
    } catch (e) {
      // The webhook, not the redirect, is the authority — poll below decides.
      console.log(`  checkout wait for ${job.id}: ${String(e.message).split("\n")[0]}`);
    } finally {
      await page.close().catch(() => {});
    }
    let row;
    for (let t = 0; t < 30; t++) {
      [row] = await rest(`jobs?id=eq.${job.id}&select=payment_status,stripe_payment_intent_id`);
      if (row.payment_status === "escrow" && row.stripe_payment_intent_id) break;
      await sleep(2000);
    }
    if (row.payment_status !== "escrow" || !row.stripe_payment_intent_id) {
      console.log(`  not funded, discarding ${job.id}: ${JSON.stringify(row)}`);
      await rest(`jobs?id=eq.${job.id}`, { method: "DELETE" });
      continue;
    }
    // Off the open-job cap (5 per poster): hire the seed helper right away.
    await rest(`jobs?id=eq.${job.id}`, {
      method: "PATCH",
      body: { status: "accepted", helper_id: "437de07d-1bd7-46c8-a451-6b46aa3bcad5", accepted_at: new Date().toISOString() },
    });
    appendFileSync(out, `${job.id} ${row.stripe_payment_intent_id}\n`);
    made++;
    console.log(`funded ${made}/${N}: ${job.id} ${row.stripe_payment_intent_id}`);
    await sleep(7_000); // stay under create-payment's 10/min per user
  }
} finally {
  await browser.close();
}
