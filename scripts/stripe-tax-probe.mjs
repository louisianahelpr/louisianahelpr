#!/usr/bin/env node
/**
 * Stripe TEST-mode probe: what Stripe Tax records for a Checkout
 * `automatic_tax` charge after (a) a PARTIAL refund (docs/OPEN.md Q1998),
 * (b) a LOST dispute (Q1918) and (c) a PARTIAL capture of a manual-capture
 * charge (Q2148 part 2). Run by .github/workflows/stripe-tax-probe.yml,
 * dispatch only. TEST MODE ONLY: refuses any key that is not sk_test_/rk_test_,
 * refuses to pay any page that is not a cs_test_ Checkout page, and fails
 * unless every object Stripe returns says livemode=false.
 *
 * It touches no app data: it creates its own Checkout Sessions straight on the
 * Stripe TEST account (metadata kind=tax_probe, so restore-reconcile can tell
 * them apart), pays them in headless Chromium with Stripe's test cards, and
 * prints what Stripe returns. Nothing reaches Supabase, the test accounts or
 * the owner's admin pages.
 *
 *   node scripts/stripe-tax-probe.mjs run      # make + pay + refund/dispute/capture, then read
 *   node scripts/stripe-tax-probe.mjs report   # Tax reports for kind=tax_probe charges since PROBE_SINCE
 *
 * Env: STRIPE_TEST_SECRET_KEY; PROBE_SINCE (unix seconds, report mode);
 * PROBE_REPORT_WAIT_MIN (minutes to wait for report data, default 0).
 * Never prints the key.
 */
import { appendFileSync } from "node:fs";

const API = "https://api.stripe.com";
const key = process.env.STRIPE_TEST_SECRET_KEY ?? "";
const out = [];

export function refuseKey(k) {
  if (!k) return "STRIPE_TEST_SECRET_KEY is not set";
  if (!/^(sk|rk)_test_/.test(k)) return "STRIPE_TEST_SECRET_KEY is not a test-mode key (sk_test_/rk_test_); nothing was done";
  return null;
}

/** Stripe form encoding of a nested object/array. */
export function form(obj, prefix = "", acc = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const name = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") form(v, name, acc);
    else acc.append(name, String(v));
  }
  return acc;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function say(line) {
  console.log(line);
  out.push(line);
}

async function stripe(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded", "Stripe-Version": "2025-08-27.basil" },
    body: body ? form(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { error: { status: res.status, ...(json.error ?? json) } };
  if (json.livemode === true) throw new Error(`REFUSED: ${path} answered livemode=true`);
  return json;
}

function pick(o, keys) {
  const r = {};
  for (const k of keys) if (o && o[k] !== undefined) r[k] = o[k];
  return r;
}

/** Every string in `o` that looks like a Stripe tax object id. */
export function taxIds(o, found = new Set()) {
  if (typeof o === "string") {
    if (/^(tax_|taxtxn_|taxcalc_|txr_)/.test(o)) found.add(o);
  } else if (o && typeof o === "object") for (const v of Object.values(o)) taxIds(v, found);
  return found;
}

async function poll(what, fn, every = 3000, timeoutMs = 180_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(every);
  }
}

async function makeSession(label, { manual = false } = {}) {
  const customer = await stripe("POST", "/v1/customers", {
    email: "tax-probe@mailinator.com",
    name: `Tax probe ${label}`,
    address: { line1: "100 Audit Way", city: "Lafayette", state: "LA", postal_code: "70506", country: "US" },
    metadata: { kind: "tax_probe" },
  });
  if (customer.error) throw new Error(`customer: ${JSON.stringify(customer.error)}`);
  const s = await stripe("POST", "/v1/checkout/sessions", {
    mode: "payment",
    customer: customer.id,
    customer_update: { address: "auto" },
    payment_method_types: ["card"],
    automatic_tax: { enabled: true },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: 10000,
          tax_behavior: "exclusive",
          // The app's taxable labor code (supabase/functions/_shared/salesTax.ts TAXABLE_LABOR_TAX_CODE).
          product_data: { name: `Tax probe ${label} (repair labor)`, tax_code: "txcd_20080005" },
        },
      },
    ],
    payment_intent_data: { metadata: { kind: "tax_probe", probe: label }, ...(manual ? { capture_method: "manual" } : {}) },
    metadata: { kind: "tax_probe", probe: label },
    success_url: "https://example.com/tax-probe-done",
    cancel_url: "https://example.com/tax-probe-cancel",
  });
  if (s.error) throw new Error(`session ${label}: ${JSON.stringify(s.error)}`);
  return s;
}

async function payCheckout(browser, url, cardNumber, label) {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* refused below */
  }
  if (host !== "checkout.stripe.com" || !/\/cs_test_[A-Za-z0-9]+/.test(url)) throw new Error(`REFUSED to pay ${label}: not a TEST-mode Checkout page`);
  const page = await browser.newPage();
  await page.route("**/*", async (route) => {
    const req = route.request();
    const h = new URL(req.url()).host;
    const stripeHost = /(^|\.)(stripe\.com|stripe\.network|stripecdn\.com|hcaptcha\.com)$/.test(h);
    if (req.isNavigationRequest() && !req.frame().parentFrame() && !stripeHost) {
      await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>returned</title>" });
      return;
    }
    await route.fallback().catch(() => undefined);
  });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const card = page.locator("#cardNumber");
    const cardButton = page.getByTestId("card-accordion-item-button");
    const radio = page.getByRole("radio").first();
    const cardItem = page.getByTestId("card-accordion-item");
    const submit = page.getByTestId("hosted-payment-submit-button");
    await poll(
      "Stripe's payment form",
      async () => {
        for (const l of [card, cardItem, radio, submit]) if (await l.first().isVisible().catch(() => false)) return true;
        return false;
      },
      500,
      60_000,
    );
    if (!(await card.isVisible().catch(() => false))) {
      if (await cardItem.count()) await cardItem.first().click({ force: true });
      else if (await cardButton.count()) await cardButton.first().dispatchEvent("click");
      else if (await radio.count()) await radio.click({ force: true });
    }
    await card.waitFor({ state: "visible", timeout: 15_000 });
    await card.fill(cardNumber);
    await page.locator("#cardExpiry").fill("12 / 34");
    await page.locator("#cardCvc").fill("123");
    for (const [id, v] of [["#email", "tax-probe@mailinator.com"], ["#billingName", "Tax Probe"], ["#billingAddressLine1", "100 Audit Way"], ["#billingLocality", "Lafayette"], ["#billingPostalCode", "70506"]]) {
      const f = page.locator(id);
      if ((await f.count()) && (await f.isVisible().catch(() => false)) && (await f.isEditable().catch(() => false))) {
        await f.fill(v).catch(() => {});
        await page.keyboard.press("Escape").catch(() => {});
      }
    }
    const state = page.locator("#billingAdministrativeArea");
    if ((await state.count()) && (await state.isVisible().catch(() => false))) await state.selectOption("LA").catch(() => {});
    const link = page.locator("#enableStripePass");
    let left = false;
    for (let press = 1; press <= 3 && !left; press++) {
      await page.waitForTimeout(2_000);
      if ((await link.count()) && (await link.isChecked().catch(() => false))) await link.uncheck({ force: true });
      await page.getByRole("heading", { name: /^Pay |^Set up|^Save/ }).first().click().catch(() => undefined);
      await submit.click();
      left = await page.waitForURL((u) => u.hostname.toLowerCase() !== "checkout.stripe.com", { timeout: 40_000 }).then(() => true, () => false);
      if (!left) console.log(`${label}: press ${press} did not leave Stripe's page`);
    }
    if (!left) {
      // What the page still wants: every visible empty or invalid field, and any error text.
      const want = await page.locator("input, select").evaluateAll((els) =>
        els
          .filter((e) => e.offsetParent !== null && (!e.value || e.getAttribute("aria-invalid") === "true"))
          .map((e) => `${e.id || e.name}${e.getAttribute("aria-invalid") === "true" ? "(invalid)" : "(empty)"}`),
      ).catch(() => []);
      const errs = await page.locator("[role=alert], .FieldError, .ErrorText").allInnerTexts().catch(() => []);
      throw new Error(`${label}: Stripe's page never submitted after 3 presses; fields ${JSON.stringify(want)}; errors ${JSON.stringify(errs)}`);
    }
  } finally {
    await page.close().catch(() => {});
  }
}

async function readSession(id) {
  return stripe("GET", `/v1/checkout/sessions/${id}?expand[]=total_details.breakdown&expand[]=payment_intent.latest_charge`);
}

function sessionFacts(s) {
  const pi = s.payment_intent ?? {};
  const ch = pi.latest_charge ?? {};
  return {
    session: s.id,
    amount_subtotal: s.amount_subtotal,
    amount_total: s.amount_total,
    amount_tax: s.total_details?.amount_tax,
    taxes: (s.total_details?.breakdown?.taxes ?? []).map((t) => ({ amount: t.amount, rate: t.rate?.percentage, jurisdiction: t.rate?.jurisdiction, reason: t.taxability_reason })),
    automatic_tax: s.automatic_tax,
    payment_intent: pi.id,
    pi_status: pi.status,
    amount_received: pi.amount_received,
    charge: ch.id,
    captured: ch.captured,
    amount_captured: ch.amount_captured,
    amount_refunded: ch.amount_refunded,
    disputed: ch.disputed,
  };
}

async function run() {
  const since = Math.floor(Date.now() / 1000) - 60;
  say(`PROBE_SINCE=${since}`);
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: true });
  const cases = [
    { label: "partial-refund", card: "4242 4242 4242 4242" },
    { label: "lost-dispute", card: "4000 0000 0000 0259" },
    { label: "partial-capture", card: "4242 4242 4242 4242", manual: true },
  ];
  const facts = {};
  try {
    for (const c of cases) {
      const s = await makeSession(c.label, { manual: c.manual });
      await payCheckout(browser, s.url, c.card, c.label);
      const paid = await poll(`${c.label} paid`, async () => {
        const r = await readSession(s.id);
        return r.status === "complete" && r.payment_intent?.latest_charge?.id ? r : null;
      });
      facts[c.label] = { paid: sessionFacts(paid), taxIdsOnSession: [...taxIds(paid)] };
      say(`${c.label} PAID: ${JSON.stringify(facts[c.label])}`);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  // (a) Q1998: refund 40.00 of the 100.00 labor (plus tax) charge.
  {
    const f = facts["partial-refund"].paid;
    const r = await stripe("POST", "/v1/refunds", { payment_intent: f.payment_intent, amount: 4000, metadata: { kind: "tax_probe" } });
    say(`partial-refund REFUND: ${JSON.stringify(r.error ?? pick(r, ["id", "amount", "status", "charge"]))}`);
    await sleep(5000);
    const after = await readSession(f.session);
    say(`partial-refund AFTER: ${JSON.stringify(sessionFacts(after))}`);
  }

  // (c) Q2148(2): capture only 30.00 of an authorised manual-capture charge.
  {
    const f = facts["partial-capture"].paid;
    const c = await stripe("POST", `/v1/payment_intents/${f.payment_intent}/capture`, { amount_to_capture: 3000 });
    say(`partial-capture CAPTURE: ${JSON.stringify(c.error ?? pick(c, ["id", "status", "amount", "amount_received", "amount_capturable"]))}`);
    await sleep(5000);
    const after = await readSession(f.session);
    say(`partial-capture AFTER: ${JSON.stringify(sessionFacts(after))}`);
  }

  // (b) Q1918: the 0259 card opens a fraudulent dispute; "losing_evidence" closes it lost.
  {
    const f = facts["lost-dispute"].paid;
    const d = await poll("the 0259 dispute", async () => {
      const l = await stripe("GET", `/v1/disputes?charge=${f.charge}&limit=1`);
      return l.data?.[0] ?? null;
    });
    say(`lost-dispute OPENED: ${JSON.stringify(pick(d, ["id", "amount", "status", "reason", "balance_transactions"]))}`);
    const lose = await stripe("POST", `/v1/disputes/${d.id}`, { evidence: { uncategorized_text: "losing_evidence" }, submit: "true" });
    say(`lost-dispute EVIDENCE: ${JSON.stringify(lose.error ?? pick(lose, ["id", "status"]))}`);
    const closed = await poll("the dispute to close lost", async () => {
      const x = await stripe("GET", `/v1/disputes/${d.id}`);
      return x.status === "lost" || x.status === "won" ? x : null;
    }, 5000, 600_000);
    say(`lost-dispute CLOSED: ${JSON.stringify(pick(closed, ["id", "status", "amount"]))} balance_transactions=${JSON.stringify((closed.balance_transactions ?? []).map((b) => pick(b, ["id", "amount", "fee", "reporting_category"])))}`);
    const after = await readSession(f.session);
    say(`lost-dispute AFTER: ${JSON.stringify(sessionFacts(after))}`);
  }

  // Is the Checkout-made tax transaction reachable from the Tax API? Try every id found on the sessions.
  for (const [label, v] of Object.entries(facts)) {
    for (const id of v.taxIdsOnSession) {
      const t = await stripe("GET", `/v1/tax/transactions/${id}`);
      say(`${label} TAX OBJECT ${id}: ${JSON.stringify(t.error ?? pick(t, ["id", "type", "reference", "reversal"]))}`);
    }
  }
  return since;
}

async function report(since, waitMin) {
  const charges = [];
  let starting;
  for (;;) {
    const page = await stripe("GET", `/v1/charges?limit=100&created[gte]=${since}${starting ? `&starting_after=${starting}` : ""}`);
    if (page.error) throw new Error(`charges: ${JSON.stringify(page.error)}`);
    for (const c of page.data) if (c.metadata?.kind === "tax_probe") charges.push(c);
    if (!page.has_more) break;
    starting = page.data.at(-1).id;
  }
  const ids = new Set(charges.flatMap((c) => [c.id, c.payment_intent].filter(Boolean)));
  say(`REPORT probe charges since ${since}: ${[...ids].join(", ") || "none"}`);
  const types = await stripe("GET", "/v1/reporting/report_types");
  if (types.error) {
    say(`REPORT report_types: ${JSON.stringify(types.error)}`);
    return;
  }
  const tax = types.data.filter((t) => /tax/i.test(t.id));
  say(`REPORT tax report types: ${JSON.stringify(tax.map((t) => pick(t, ["id", "data_available_start", "data_available_end"])))}`);
  const until = Date.now() + waitMin * 60_000;
  for (const t0 of tax) {
    let t = t0;
    while (t.data_available_end < since + 3600 && Date.now() < until) {
      await sleep(60_000);
      const fresh = await stripe("GET", `/v1/reporting/report_types/${t0.id}`);
      if (!fresh.error) t = fresh;
    }
    if (t.data_available_end <= since - 3600) {
      say(`REPORT ${t.id}: data only to ${t.data_available_end} (probe at ${since}); re-run report mode later`);
      continue;
    }
    const start = Math.max(t.data_available_start, since - 3600);
    const run = await stripe("POST", "/v1/reporting/report_runs", { report_type: t.id, parameters: { interval_start: start, interval_end: t.data_available_end } });
    if (run.error) {
      say(`REPORT ${t.id} run: ${JSON.stringify(run.error)}`);
      continue;
    }
    const done = await poll(`report ${t.id}`, async () => {
      const r = await stripe("GET", `/v1/reporting/report_runs/${run.id}`);
      return r.status === "succeeded" || r.status === "failed" ? r : null;
    }, 5000, 600_000);
    if (done.status !== "succeeded" || !done.result?.url) {
      say(`REPORT ${t.id}: ${done.status} ${JSON.stringify(done.error ?? "")}`);
      continue;
    }
    const csv = await (await fetch(done.result.url, { headers: { Authorization: `Bearer ${key}` } })).text();
    const lines = csv.split("\n");
    const hits = lines.filter((l) => [...ids].some((id) => l.includes(id)));
    say(`REPORT ${t.id} [${start}..${t.data_available_end}] header: ${lines[0]}`);
    say(`REPORT ${t.id}: ${hits.length} probe row(s)`);
    for (const h of hits) say(`REPORT ${t.id} ROW: ${h}`);
  }
}

async function main() {
  const bad = refuseKey(key);
  if (bad) {
    console.error(`::error::${bad}`);
    process.exit(1);
  }
  const mode = process.argv[2] ?? "run";
  const waitMin = Number(process.env.PROBE_REPORT_WAIT_MIN ?? "0") || 0;
  let since = Number(process.env.PROBE_SINCE ?? "0");
  if (mode === "run") since = await run();
  else if (mode !== "report") throw new Error(`unknown mode ${mode}`);
  if (!since) throw new Error("report mode needs PROBE_SINCE (unix seconds from a run's log)");
  await report(since, waitMin);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Stripe Tax probe (TEST mode)\n\n\`\`\`\n${out.join("\n")}\n\`\`\`\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`::error::${String(e?.message ?? e).slice(0, 500)}`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Stripe Tax probe FAILED\n\n\`\`\`\n${out.join("\n")}\n${String(e?.message ?? e)}\n\`\`\`\n`);
    process.exit(1);
  });
}
