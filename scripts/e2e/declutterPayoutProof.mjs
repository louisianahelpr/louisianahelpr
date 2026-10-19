#!/usr/bin/env node
/**
 * declutterPayoutProof — ONE Declutter sale, end to end on prod, in Stripe
 * TEST mode, until the seller's payout lands as a Stripe transfer on a test
 * connected account. The last gate before Declutter opens (owner 2026-10-19:
 * "You can do the testing too, not me").
 *
 * WHY THIS SHAPE (handoffs-1017/declutter-proof.md, declutter-payout-proof.md):
 * no test seat could take a transfer. helper-e2e's Express fixture
 * (acct_1UQigP3qNyg1xGcp) cannot be finished by API (an Express account's
 * terms are accepted only in Stripe's hosted flow, and that flow showed an
 * hCaptcha), and stripe-connect refuses to make a Connect account for any test
 * account (TestSeatConnectRefused). So each run makes its OWN pieces and never
 * touches a shared seat:
 *   1. two throwaway @mailinator.com accounts (seller, buyer), is_seed,
 *      enrolled in public.test_accounts (ensureTestAccountsEnrolled), so every
 *      edge function runs them on the TEST key (_shared/stripeMode.ts);
 *   2. a Custom TEST-mode connected account the platform completes itself with
 *      Stripe's documented test values, tagged with this run's id;
 *   3. that account linked to the throwaway seller (a service-role write
 *      scoped to the run's own row: stripe-connect refuses test seats), then
 *      stripe-connect `status` as the seller syncs the payout gate the real way;
 *   4. the real sale as the two members: pickup windows, a draft, 3 photos,
 *      the tax attestation, publish (pending_review), the review step
 *      (service role on the run's own item, see approveOwnListing), the
 *      buyer's card page (4242), Buy now, the porch checkout page (4242),
 *      book a pickup, the buyer's "I got it";
 *   5. the declutter-money cron (every 10 min) sends the transfer; the run
 *      waits for declutter_payouts.stripe_transfer_id and checks it at Stripe
 *      (destination, exact cents, metadata, source charge, the payment it
 *      made on the connected account);
 *   6. ALWAYS (finally here, and `unlink` from an `if: always()` workflow
 *      step): the account is unlinked from the throwaway seller, exactly like
 *      seatStripeAccounts.mjs --restore, so no enrolled test account keeps an
 *      unsanctioned Stripe account (e2e-journeys checks every run).
 * The order, payout, transfer and both accounts stay as the proof records.
 *
 * SAFETY (every one fails closed, before the first write):
 *   - STRIPE_TEST_SECRET_KEY must be sk_test_/rk_test_, Stripe must answer
 *     livemode=false; both parties are TEST ACCOUNTS
 *     this run enrolled, which stripeMode.ts runs on the test key only. Not
 *     vars.E2E_STRIPE_MODE: that is the whole platform's mode (live since
 *     2026-09-28), not a test account's (test since 2026-10-12).
 *   - Only rows this run created are written: a user id the run made, whose
 *     email is this run's address, is_seed, and (after step 1) enrolled; and
 *     only the Stripe account this run made (metadata lh_proof_run = run id).
 *   - A platform without Custom accounts enabled is REPORTED (exit 3), never
 *     worked around.
 *   - The keys are never printed: errors carry Stripe's/Supabase's message only.
 *
 *   node scripts/e2e/declutterPayoutProof.mjs run    --state <file> [--price-cents 500]
 *   node scripts/e2e/declutterPayoutProof.mjs unlink --state <file>
 *
 * Env: SUPABASE_URL (or SUPABASE_PROJECT_REF), SUPABASE_SERVICE_ROLE_KEY,
 * STRIPE_TEST_SECRET_KEY. Workflow: declutter-payout-proof.yml.
 * Exit: 0 proved; 1 failed (the step it failed at is printed); 3 Custom
 * accounts are not enabled on the platform.
 * Guard: src/test/declutterPayoutProof.test.ts.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { supabaseBase } from "../lib/apiBase.mjs";
import { assertFreshCheckout } from "../lib/freshCheckout.mjs";
import { mintAdminSession, PUBLIC_ANON_KEY } from "../lib/adminSession.mjs";
import { acceptCurrentTerms } from "../lib/acceptCurrentTerms.mjs";
import { ensureTestAccountsEnrolled } from "../lib/testAccountEnrolment.mjs";
import { RESET_FIELDS } from "./seatStripeAccounts.mjs";

assertFreshCheckout(import.meta.url);

/** Tag on every Stripe account this script makes. */
export const PROOF_TAG = "declutter-payout-proof";
const STRIPE_API = "https://api.stripe.com";
/** Stripe's documented test values (docs.stripe.com/connect/testing). */
export const TEST_BANK = Object.freeze({ routing_number: "110000000", account_number: "000123456789" });

/** null when `key` is a TEST-mode Stripe key, otherwise why it is refused. */
export function testKeyRefusal(key) {
  if (!key) return "STRIPE_TEST_SECRET_KEY is empty";
  if (!/^(sk|rk)_test_/.test(key)) return "STRIPE_TEST_SECRET_KEY is not a test-mode key (sk_test_/rk_test_); refusing to make any request";
  return null;
}

/** A run id: UTC minute + 6 random hex chars, lower-case (it goes into an email address). */
export function newRunId(now = new Date(), rand = randomBytes(3).toString("hex")) {
  return `${now.toISOString().slice(0, 16).replace(/[-:T]/g, "")}${rand}`;
}

/** The throwaway address of `role` in run `runId` (a fixture inbox, so is_seed and mintable). */
export function proofEmail(runId, role) {
  if (!/^[0-9a-f]{12,}$/.test(String(runId))) throw new Error(`bad run id ${runId}`);
  if (role !== "seller" && role !== "buyer") throw new Error(`bad role ${role}`);
  return `helpr-payout-proof-${runId}-${role}@mailinator.com`;
}

/**
 * Why this script may NOT write `row` (a profiles row), or null when it may:
 * the user was created by THIS run (its id is in the state file), the email is
 * this run's address for that role, it is is_seed, and (once enrolment has
 * run) it is in public.test_accounts.
 */
export function profileRefusal(row, state, role, { enrolledIds = null } = {}) {
  if (!row) return "no profile row";
  const want = state?.users?.[role];
  if (!want || row.user_id !== want) return `${row.user_id} is not the ${role} this run created`;
  if (String(row.email ?? "").toLowerCase() !== proofEmail(state.runId, role)) return `${row.user_id} is not this run's ${role} address`;
  if (row.is_seed !== true) return `${row.user_id} is not is_seed`;
  if (enrolledIds && !enrolledIds.has(row.user_id)) return `${row.user_id} is not enrolled in public.test_accounts`;
  return null;
}

/** Why this script may NOT touch Stripe account `acct`, or null: it must be the TEST account this run made. */
export function accountRefusal(acct, state) {
  if (!acct || typeof acct.id !== "string") return "no account";
  if (!state?.accountId || acct.id !== state.accountId) return `${acct.id} is not the account this run created`;
  // A Stripe Account object carries no `livemode` field (run 39340554353 refused its own
  // freshly made test account on `livemode !== false`). The mode is the key's: a test key
  // can neither create nor read a live account, and testKeyRefusal + the livemode=false
  // balance read prove the key. An account that DOES say livemode=true is still refused.
  if (acct.livemode === true) return `${acct.id} is a live-mode account`;
  const m = acct.metadata ?? {};
  if (m.lh_proof !== PROOF_TAG || m.lh_proof_run !== state.runId) return `${acct.id} does not carry this run's tag`;
  return null;
}

/**
 * Stripe's refusal to create a Custom account because the platform has not
 * enabled them (or has not finished its Connect platform profile). Reported,
 * never worked around (lead, 2026-10-19).
 */
export function isCustomAccountsDisabled(err) {
  if (!err || err.type !== "invalid_request_error") return false;
  return /custom accounts?|platform[- ]profile|signed up for connect|managing losses|responsibilit/i.test(String(err.message ?? ""));
}

/** F1 buyer fee: 5% of the items, rounded, plus 70c (declutter_buyer_fee_cents). */
export function buyerFeeCents(itemsCents) {
  return Math.round(Math.max(itemsCents, 0) * 0.05) + 70;
}

/** Every way `transfer` differs from the payout it should be (empty = exact). */
export function transferProblems(transfer, { accountId, payout, chargeId, priceCents }) {
  const out = [];
  if (!transfer) return ["no transfer"];
  if (!chargeId) out.push("the order's charge id is unknown, so the transfer's source cannot be checked");
  if (transfer.livemode !== false) out.push("transfer is not test mode");
  const dest = typeof transfer.destination === "string" ? transfer.destination : transfer.destination?.id;
  if (dest !== accountId) out.push(`destination ${dest} is not ${accountId}`);
  if (transfer.amount !== payout.amount_cents) out.push(`amount ${transfer.amount} is not the payout's ${payout.amount_cents}`);
  if (transfer.amount !== priceCents) out.push(`amount ${transfer.amount} is not the item price ${priceCents} (the seller keeps 100%)`);
  if (transfer.amount_reversed !== 0) out.push(`amount_reversed ${transfer.amount_reversed}`);
  if (transfer.currency !== "usd") out.push(`currency ${transfer.currency}`);
  if (transfer.reversed) out.push("transfer is reversed");
  const m = transfer.metadata ?? {};
  if (m.kind !== "declutter_payout" || m.payout_id !== payout.id) out.push(`metadata ${JSON.stringify(m)} does not name payout ${payout.id}`);
  if (transfer.transfer_group !== `declutter_order_${payout.order_id}`) out.push(`transfer_group ${transfer.transfer_group}`);
  const src = typeof transfer.source_transaction === "string" ? transfer.source_transaction : transfer.source_transaction?.id;
  if (src !== chargeId) out.push(`source_transaction ${src} is not the order's charge ${chargeId}`);
  return out;
}

/**
 * The restore check (check-stripe-restore-drift.mjs --json), scoped to the
 * proof's own money: its PaymentIntent and transfer must not be among the
 * objects with no database row, and each kind must have matched at least one
 * row. Objects other runs made in the same window are reported, not failed on.
 */
export function restoreVerdict(drift, { paymentIntent, transfer }) {
  const problems = [];
  const others = [];
  for (const [kind, id] of [["payment_intent", paymentIntent], ["transfer", transfer]]) {
    const g = drift?.report?.[kind];
    if (!id) { problems.push(`no ${kind} id in the proof record`); continue; }
    if (!g) { problems.push(`the restore check read no ${kind}s`); continue; }
    if ((g.missing ?? []).some((m) => m.id === id)) problems.push(`${kind} ${id} has no database row`);
    if (!(g.matched >= 1)) problems.push(`the restore check matched no ${kind} (it cannot have read ${id})`);
    for (const m of g.missing ?? []) if (m.id !== id) others.push(`${kind} ${m.id}`);
  }
  return { problems, others };
}

/** Form-encode Stripe params (nested objects as a[b][c]). */
export function stripeForm(obj, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === "object" ? stripeForm(x, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))));
    else if (typeof v === "object") stripeForm(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

/**
 * The first 30-minute slot at least 90 minutes out whose start is between
 * 00:00 and 23:29 America/Chicago (the seller's windows are the whole day).
 */
export function pickupSlot(now = new Date()) {
  const t = new Date(Math.ceil((now.getTime() + 90 * 60_000) / (30 * 60_000)) * 30 * 60_000);
  for (let i = 0; i < 96; i++, t.setTime(t.getTime() + 30 * 60_000)) {
    const hm = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t);
    if (hm <= "23:29") return t.toISOString();
  }
  throw new Error("no pickup slot found");
}

// ---------------------------------------------------------------------------

class StripeApiError extends Error {
  constructor(status, err) {
    super(`Stripe ${status}: ${err?.type ?? "error"}${err?.code ? `/${err.code}` : ""}: ${err?.message ?? "no message"}`);
    this.status = status;
    this.type = err?.type;
    this.code = err?.code;
    this.stripeMessage = err?.message;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`[${new Date().toISOString().slice(11, 19)}Z] ${msg}`);

function env() {
  const key = process.env.STRIPE_TEST_SECRET_KEY ?? "";
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const url = process.env.SUPABASE_URL || (process.env.SUPABASE_PROJECT_REF ? `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co` : "https://fncmgoasalhdgfwzhsqa.supabase.co");
  return { key, service, base: supabaseBase(url).replace(/\/+$/, "") };
}

function clients({ key, service, base }) {
  const stripe = async (method, path, params, { account, idem } = {}) => {
    const headers = { Authorization: `Bearer ${key}`, "Stripe-Version": "2025-08-27.basil" };
    if (account) headers["Stripe-Account"] = account;
    if (idem) headers["Idempotency-Key"] = idem;
    let url = `${STRIPE_API}${path}`;
    let body;
    if (method === "GET" && params) url += `?${stripeForm(params)}`;
    else if (params) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = stripeForm(params).toString();
    }
    const r = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(60_000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new StripeApiError(r.status, j.error);
    return j;
  };
  const sH = { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" };
  const rest = async (method, path, body, prefer) => {
    const r = await fetch(`${base}/rest/v1/${path}`, {
      method, headers: prefer ? { ...sH, Prefer: prefer } : sH, body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`${method} ${path.split("?")[0]}: HTTP ${r.status} ${t.slice(0, 300)}`);
    return t ? JSON.parse(t) : null;
  };
  const authAdmin = async (method, path, body) => {
    const r = await fetch(`${base}/auth/v1/admin/${path}`, { method, headers: sH, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45_000) });
    const t = await r.text();
    if (!r.ok) throw new Error(`auth admin ${method} ${path.split("?")[0]}: HTTP ${r.status} ${t.slice(0, 300)}`);
    return JSON.parse(t);
  };
  /** As a member: an RPC or an edge function, with their own token. */
  const as = (session) => {
    const h = { apikey: PUBLIC_ANON_KEY, Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" };
    const call = async (url, body) => {
      const r = await fetch(url, { method: "POST", headers: h, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(60_000) });
      const t = await r.text();
      let j = null;
      try { j = t ? JSON.parse(t) : null; } catch { j = t; }
      if (!r.ok) throw new Error(`${url.replace(base, "")}: HTTP ${r.status} ${t.slice(0, 400)}`);
      return j;
    };
    return {
      rpc: (name, args) => call(`${base}/rest/v1/rpc/${name}`, args),
      fn: (name, body) => call(`${base}/functions/v1/${name}`, body),
      upload: async (path, bytes, contentType) => {
        const r = await fetch(`${base}/storage/v1/object/job-photos/${path}`, {
          method: "POST",
          headers: { apikey: PUBLIC_ANON_KEY, Authorization: `Bearer ${session.access_token}`, "Content-Type": contentType, "x-upsert": "false", "cache-control": "max-age=31536000" },
          body: bytes,
        });
        if (!r.ok) throw new Error(`upload ${path}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
      },
    };
  };
  return { stripe, rest, authAdmin, as };
}

function loadState(file) {
  if (!file) throw new Error("--state <file> is required");
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}
const saveState = (file, state) => writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);

async function enrolledSet(rest, ids) {
  const rows = await rest("GET", `test_accounts?select=user_id&user_id=in.(${ids.join(",")})`);
  return new Set(rows.map((r) => r.user_id));
}

async function readProfile(rest, userId) {
  const [row] = await rest("GET", `profiles?user_id=eq.${userId}&select=user_id,email,is_seed,stripe_account_id,stripe_payouts_enabled,stripe_charges_enabled,stripe_identity_verified`);
  return row ?? null;
}

/** Step 6: put the seller back to no Stripe account. Safe to run any number of times. */
export async function unlinkRun(c, state) {
  const seller = state?.users?.seller;
  if (!seller) return log("unlink: this run created no seller; nothing to unlink");
  const row = await readProfile(c.rest, seller);
  if (!row) return log(`unlink: seller ${seller} has no profile row; nothing to unlink`);
  // Nothing linked: nothing to write, so nothing to refuse.
  if (!row.stripe_account_id) return log(`unlink: seller ${seller} holds no Stripe account (clean)`);
  const why = profileRefusal(row, state, "seller", { enrolledIds: await enrolledSet(c.rest, [seller]) });
  if (why) throw new Error(`unlink REFUSED: ${why}`);
  if (row.stripe_account_id !== state.accountId) throw new Error(`unlink REFUSED: seller holds ${row.stripe_account_id}, not this run's ${state.accountId}`);
  // The write below is already scoped to this run's user, account id and is_seed, so an
  // unreachable Stripe does not block it; an account Stripe says is NOT this run's does.
  const acct = await c.stripe("GET", `/v1/accounts/${state.accountId}`).catch((err) => {
    console.log(`::warning title=Unlink without a Stripe read::${err.message}; unlinking on the database scope alone`);
    return null;
  });
  const acctWhy = acct ? accountRefusal(acct, state) : null;
  if (acctWhy) throw new Error(`unlink REFUSED: ${acctWhy}`);
  const after = await c.rest(
    "PATCH",
    `profiles?user_id=eq.${seller}&stripe_account_id=eq.${encodeURIComponent(state.accountId)}&is_seed=is.true&select=user_id,stripe_account_id`,
    RESET_FIELDS,
    "return=representation",
  );
  if (after.length !== 1 || after[0].stripe_account_id !== null) throw new Error(`unlink matched ${after.length} rows: ${JSON.stringify(after)}`);
  state.unlinkedAt = new Date().toISOString();
  log(`unlink: ${state.accountId} unlinked from seller ${seller} (the account stays at Stripe, test mode)`);
}

/**
 * A failed run must not leave money waiting on an account it is about to
 * unlink (lead review, 2026-10-19). Runs BEFORE the unlink, only when the run
 * did not prove the payout, and only on this run's own order:
 *   - paid, not handed over: the buyer is refunded the sanctioned way
 *     (declutter_refund_paid_order 'seller_backed_out'; declutter-money sends
 *     the TEST-mode refund on its next run, and the item is withdrawn);
 *   - handed over, payout still pending/failed: the payout is put on hold
 *     (payout_hold_for_review), so the queue stops offering it, and ::error
 *     names the ids and the admin step that settles it;
 *   - a payout already sent (succeeded) is left alone.
 * Idempotent: a refunded order answers its refund again, a held payout is not held twice.
 */
export async function closeAfterFailure(c, state) {
  if (state?.result || !state?.orderId) return;
  const why = String(state.failure ?? "the run did not finish").slice(0, 200);
  const [o] = await c.rest("GET", `declutter_orders?id=eq.${state.orderId}&buyer_id=eq.${state.users.buyer}&seller_id=eq.${state.users.seller}&select=id,status,is_seed`);
  if (!o) return log(`close: order ${state.orderId} is not this run's; left alone`);
  if (o.is_seed !== true) throw new Error(`close REFUSED: order ${o.id} is not is_seed`);
  if (o.status === "paid") {
    const out = await c.rest("POST", "rpc/declutter_refund_paid_order", { p_order_id: o.id, p_reason: "seller_backed_out" });
    state.closed = { kind: "refund", order: o.id, answer: out };
    console.log(`::error title=Payout proof failed after payment::order ${o.id} refunded to the buyer (TEST mode, declutter-money sends it): ${JSON.stringify(out)}`);
    return;
  }
  if (o.status !== "handed_over" || !state.payoutId) return log(`close: order ${o.id} is ${o.status}; nothing to close`);
  const [p] = await c.rest("GET", `declutter_payouts?id=eq.${state.payoutId}&order_id=eq.${o.id}&select=id,status,stripe_transfer_id,amount_cents`);
  if (!p || !["pending", "failed"].includes(p.status)) return log(`close: payout ${state.payoutId} is ${p?.status ?? "missing"}; left alone`);
  const sent = await c.stripe("GET", "/v1/transfers", { transfer_group: `declutter_order_${o.id}`, limit: 10 })
    .then((l) => l.data.map((t) => t.id), (err) => [`(Stripe not read: ${err.message})`]);
  const held = await c.rest("POST", "rpc/payout_hold_for_review", {
    p_kind: "declutter", p_id: p.id, p_category: "payout_proof_failed",
    p_reason: `run ${state.runId}: ${why}; test account ${state.accountId} unlinked${sent.length ? `; Stripe transfers in the group: ${sent.join(", ")}` : ""}`,
  });
  state.closed = { kind: "held_for_review", payout: p.id, held, transfers: sent };
  console.log(`::error title=Payout proof failed after handover::payout ${p.id} (order ${o.id}, ${p.amount_cents}c, seller ${state.users.seller}) is held for review` +
    `${sent.length ? `; Stripe already has ${sent.join(", ")}` : "; Stripe has no transfer for it"}. ` +
    "An admin settles it in the held-payouts queue: admin_payout_settle_by_hand('declutter', id, '<tr_ id>', amount, note) when a transfer exists, " +
    "otherwise admin_payout_release('declutter', id, note, true) after re-linking, or leave it held (test money only).");
}

async function payCheckout(browser, url, label) {
  let host = "";
  try { host = new URL(url).hostname; } catch { /* refused below */ }
  if (host !== "checkout.stripe.com" || !/\/cs_test_[A-Za-z0-9]+/.test(url)) throw new Error(`REFUSED to pay ${label}: not a TEST-mode Checkout page`);
  const page = await browser.newPage();
  // Stripe's return goes to the deployed app: answer it with an empty page,
  // as scripts/probes/mint-funded-seed-jobs.prod.mjs does (this .mjs cannot
  // import e2e/stripeCheckoutCard.ts).
  await page.route("**/*", async (route) => {
    const req = route.request();
    const h = new URL(req.url()).host;
    const stripe = /(^|\.)(stripe\.com|stripe\.network|stripecdn\.com|hcaptcha\.com)$/.test(h);
    if (req.isNavigationRequest() && !req.frame().parentFrame() && !stripe) {
      await route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>returned</title>" });
      return;
    }
    await route.fallback().catch(() => undefined);
  });
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    // Same three layouts e2e/stripeCheckoutCard.ts knows: open card fields,
    // the Card method button (Stripe Sandbox since 2026-10-13), or the radio accordion.
    const card = page.locator("#cardNumber");
    const cardButton = page.getByTestId("card-accordion-item-button");
    const radio = page.getByRole("radio").first();
    const submit = page.getByTestId("hosted-payment-submit-button");
    await card.or(cardButton).or(radio).or(submit).first().waitFor({ state: "visible", timeout: 60_000 });
    if (!(await card.isVisible().catch(() => false))) {
      if (await cardButton.count()) await cardButton.first().click({ force: true });
      else if (await radio.count()) await radio.click({ force: true });
    }
    // A buyer with a saved test card may be shown that card and no card fields:
    // then Pay charges the saved 4242 (it can only be a test card: cs_test_ page).
    if (await card.waitFor({ state: "visible", timeout: 15_000 }).then(() => true, () => false)) {
      await card.fill("4242 4242 4242 4242");
      await page.locator("#cardExpiry").fill("12 / 34");
      await page.locator("#cardCvc").fill("123");
    } else {
      log(`${label}: no card fields on the page; paying with the saved test card`);
    }
    for (const [id, v] of [["#email", "payout-proof@mailinator.com"], ["#billingName", "Payout Proof"], ["#billingAddressLine1", "100 Audit Way"], ["#billingLocality", "Baton Rouge"], ["#billingPostalCode", "70801"]]) {
      const f = page.locator(id);
      if ((await f.count()) && (await f.isVisible().catch(() => false)) && (await f.isEditable().catch(() => false))) {
        await f.fill(v).catch(() => {});
        await page.keyboard.press("Escape").catch(() => {});
      }
    }
    const link = page.locator("#enableStripePass");
    if ((await link.count()) && (await link.isChecked().catch(() => false))) await link.uncheck({ force: true }).catch(() => {});
    await page.getByRole("heading", { name: /^Pay |^Set up|^Save/ }).first().click().catch(() => undefined);
    await submit.click();
    await page.waitForURL((u) => u.hostname.toLowerCase() !== "checkout.stripe.com", { timeout: 120_000 });
  } catch (e) {
    // The webhook, not the redirect, is the authority: the caller polls the database.
    log(`${label}: checkout wait: ${String(e?.message ?? e).split("\n")[0]}`);
  } finally {
    await page.close().catch(() => {});
  }
}

async function poll(what, fn, { every = 3000, timeoutMs = 120_000 } = {}) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(every);
  }
}

/**
 * The listing review step, on the run's OWN pending item only. A seller's
 * first three listings wait for an admin (declutter_publish_item row 33).
 * declutter_admin_review_item reads auth.uid() and needs it to hold the admin
 * role: a service-role call through PostgREST has no auth.uid() (setting
 * request.jwt.claims needs a direct SQL session), and the only admin sessions
 * are the shared seed-admin seat (no one-off proof may use a shared seat) or a
 * real admin. So the service role sends exactly the columns of that
 * function's approve UPDATE (status, admin_approved_at, live_at, updated_at;
 * pinned by src/test/declutterPayoutProof.test.ts), with its WHERE (this item,
 * status pending_review) narrowed to this run's seller and is_seed.
 * Of the function's eligibility checks it re-checks the payout gate; ban,
 * strikes and age cannot apply to an account this run made a minute ago
 * (born 1990, no strikes, ban_status active). It skips the admin_audit_log row
 * and the review_note, which name an admin who did not act.
 */
async function approveOwnListing(c, state, itemId) {
  const row = await readProfile(c.rest, state.users.seller);
  const why = profileRefusal(row, state, "seller", { enrolledIds: await enrolledSet(c.rest, [state.users.seller]) });
  if (why) throw new Error(`approve REFUSED: ${why}`);
  if (row.stripe_payouts_enabled !== true) throw new Error("approve REFUSED: the seller's payout gate is not open (seller_not_eligible)");
  const now = new Date().toISOString();
  const out = await c.rest(
    "PATCH",
    `declutter_items?id=eq.${itemId}&seller_id=eq.${state.users.seller}&status=eq.pending_review&is_seed=is.true&select=id,status,is_seed`,
    { status: "live", admin_approved_at: now, live_at: now, updated_at: now },
    "return=representation",
  );
  if (out.length !== 1 || out[0].status !== "live") throw new Error(`approve matched ${out.length} rows: ${JSON.stringify(out)}`);
}

async function listingPhoto(browser, n) {
  // A clean JPEG (no EXIF: a Chromium screenshot carries none), as the app's re-encode makes.
  const page = await browser.newPage({ viewport: { width: 480, height: 360 } });
  await page.setContent(`<body style="margin:0;display:grid;place-items:center;height:100vh;background:#6b7a3a;color:#fff;font:600 28px sans-serif">Payout proof lamp · photo ${n}</body>`);
  const bytes = await page.screenshot({ type: "jpeg", quality: 80 });
  await page.close();
  return bytes;
}

async function run(stateFile, priceCents) {
  const e = env();
  const refused = testKeyRefusal(e.key);
  if (refused) throw new Error(refused);
  if (!e.service) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  if (!Number.isInteger(priceCents) || priceCents < 100 || priceCents > 100_000) throw new Error(`--price-cents ${priceCents} is not 100..100000`);
  if (!stateFile) throw new Error("--state <file> is required");
  const c = clients(e);
  const bal = await c.stripe("GET", "/v1/balance");
  if (bal.livemode !== false) throw new Error("Stripe answered livemode=true; refusing");

  const state = { runId: newRunId(), startedAt: new Date().toISOString(), priceCents, users: {}, accountId: null, steps: [] };
  // One state file per run: `wx` refuses an existing one (unlink that run first).
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx" });
  const step = (name, detail = {}) => {
    state.steps.push({ at: new Date().toISOString(), name, ...detail });
    saveState(stateFile, state);
    log(`${name} ${Object.keys(detail).length ? JSON.stringify(detail) : ""}`);
  };
  log(`run ${state.runId} (state ${stateFile})`);

  let browser;
  try {
    // 1. Two throwaway test accounts.
    for (const role of ["seller", "buyer"]) {
      const email = proofEmail(state.runId, role);
      // seed-policy: patched — the profile below is written is_seed: true (and the fixture-email trigger sets it too)
      const user = await c.authAdmin("POST", "users", {
        // No password: the run signs in only through mintAdminSession (a recovery link, never typed).
        email, email_confirm: true,
        user_metadata: { full_name: `Payout Proof ${role === "seller" ? "Seller" : "Buyer"}` },
      });
      if (!user?.id || String(user.email).toLowerCase() !== email) throw new Error(`auth admin create for ${role} returned no matching user`);
      state.users[role] = user.id;
      saveState(stateFile, state);
      const profile = {
        user_id: user.id, email, full_name: `Payout Proof ${role === "seller" ? "Seller" : "Buyer"}`, date_of_birth: "1990-01-01",
        location: "Baton Rouge, LA", zip_code: "70801", parish: "East Baton Rouge", ban_status: "active", is_seed: true,
      };
      const existing = await c.rest("GET", `profiles?user_id=eq.${user.id}&select=user_id`);
      if (existing.length) await c.rest("PATCH", `profiles?user_id=eq.${user.id}`, profile);
      else await c.rest("POST", "profiles", profile);
      const row = await readProfile(c.rest, user.id);
      const why = profileRefusal(row, state, role);
      if (why) throw new Error(`${role} profile: ${why}`);
    }
    const ids = [state.users.seller, state.users.buyer];
    await ensureTestAccountsEnrolled({ supabaseUrl: e.base, serviceKey: e.service, userIds: ids, note: `declutter-payout-proof ${state.runId}` }); // TEST-ACCOUNT-ENROLMENT
    const enrolled = await enrolledSet(c.rest, ids);
    for (const role of ["seller", "buyer"]) {
      const why = profileRefusal(await readProfile(c.rest, state.users[role]), state, role, { enrolledIds: enrolled });
      if (why) throw new Error(`${role} is not a test account: ${why}`);
    }
    const sess = {};
    for (const role of ["seller", "buyer"]) {
      sess[role] = await mintAdminSession({ email: proofEmail(state.runId, role), serviceKey: e.service, supabaseUrl: e.base, anonKey: PUBLIC_ANON_KEY });
      await acceptCurrentTerms(e.base, PUBLIC_ANON_KEY, sess[role].access_token, state.users[role]);
    }
    const seller = c.as(sess.seller);
    const buyer = c.as(sess.buyer);
    step("1 accounts", { seller: state.users.seller, buyer: state.users.buyer });

    // 2. A Custom TEST-mode connected account, completed by the platform.
    let acct;
    try {
      acct = await c.stripe("POST", "/v1/accounts", {
        type: "custom",
        country: "US",
        email: proofEmail(state.runId, "seller"),
        business_type: "individual",
        capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
        business_profile: { mcc: "5932", product_description: "Used household items sold on Louisiana Helpr Declutter (test)" },
        individual: {
          first_name: "Payout", last_name: "Proof", email: proofEmail(state.runId, "seller"), phone: "0000000000",
          dob: { day: 1, month: 1, year: 1901 }, ssn_last_4: "0000", id_number: "000000000",
          address: { line1: "address_full_match", city: "Baton Rouge", state: "LA", postal_code: "70801", country: "US" },
        },
        external_account: { object: "bank_account", country: "US", currency: "usd", ...TEST_BANK },
        tos_acceptance: { date: Math.floor(Date.now() / 1000), ip: "127.0.0.1" },
        metadata: { lh_proof: PROOF_TAG, lh_proof_run: state.runId, seller_user_id: state.users.seller },
      }, { idem: `lh-${PROOF_TAG}-${state.runId}` });
    } catch (err) {
      if (isCustomAccountsDisabled(err)) {
        step("2 CUSTOM_ACCOUNTS_NOT_ENABLED", { stripe: err.stripeMessage });
        console.log(`::error title=Custom accounts are not enabled::Stripe refused to create a Custom TEST account: ${err.stripeMessage}. ` +
          "Enable Custom accounts (and finish the platform profile) in the Stripe dashboard, TEST mode, Connect settings; this proof does not work around it.");
        process.exitCode = 3;
        return;
      }
      throw err;
    }
    state.accountId = acct.id;
    saveState(stateFile, state);
    if (accountRefusal(acct, state)) throw new Error(`created account: ${accountRefusal(acct, state)}`);
    acct = await poll("the test account's transfers capability to be active", async () => {
      const a = await c.stripe("GET", `/v1/accounts/${state.accountId}`);
      return a.capabilities?.transfers === "active" && a.payouts_enabled === true ? a : null;
    }, { every: 5000, timeoutMs: 180_000 }).catch(async (err) => {
      const a = await c.stripe("GET", `/v1/accounts/${state.accountId}`);
      throw new Error(`${err.message}: transfers=${a.capabilities?.transfers} payouts_enabled=${a.payouts_enabled} currently_due=${JSON.stringify(a.requirements?.currently_due)} errors=${JSON.stringify(a.requirements?.errors)}`);
    });
    step("2 account ready", { account: acct.id, transfers: acct.capabilities.transfers, payouts_enabled: acct.payouts_enabled, charges_enabled: acct.charges_enabled });

    // Stripe's US test bank numbers are a fixed set (only 000123456789 pays out), so every test
    // account shares this bank's fingerprint and no run can have its own. If a retained ban ever
    // holds it, linking would auto-ban the throwaway seller (enforce_retained_payment_ban, via
    // stripe-connect status): stop BEFORE linking and say why, instead of tripping the ban.
    const bankFp = acct.external_accounts?.data?.[0]?.fingerprint
      ?? (await c.stripe("GET", `/v1/accounts/${state.accountId}/external_accounts`, { object: "bank_account", limit: 1 })).data?.[0]?.fingerprint;
    if (!bankFp) throw new Error("the test account has no bank fingerprint to check against retained bans");
    const bankHash = await c.rest("POST", "rpc/ban_fingerprint", { p_domain: "bank", p_value: bankFp });
    const bankBans = await c.rest("GET", `retained_bans?select=id&bank_sha256=cs.${encodeURIComponent(`{${bankHash}}`)}`);
    if (bankBans.length) {
      throw new Error(`the shared Stripe test bank (${TEST_BANK.account_number}) is on ${bankBans.length} retained ban(s) (${bankBans.map((b) => b.id).join(", ")}); ` +
        "linking it would auto-ban the throwaway seller. An admin clears that retained ban (it can only be a test account's) before this proof can run.");
    }

    // 3. Link it to the run's seller, then sync the gate the real way.
    const sellerRow = await readProfile(c.rest, state.users.seller);
    const linkWhy = profileRefusal(sellerRow, state, "seller", { enrolledIds: await enrolledSet(c.rest, [state.users.seller]) });
    if (linkWhy) throw new Error(`link REFUSED: ${linkWhy}`);
    const linked = await c.rest(
      "PATCH",
      `profiles?user_id=eq.${state.users.seller}&stripe_account_id=is.null&is_seed=is.true&select=user_id,stripe_account_id`,
      { stripe_account_id: state.accountId },
      "return=representation",
    );
    if (linked.length !== 1) throw new Error(`link matched ${linked.length} rows`);
    state.linkedAt = new Date().toISOString();
    saveState(stateFile, state);
    const status = await seller.fn("stripe-connect", { action: "status" });
    if (status?.account_id !== state.accountId || status?.payouts_enabled !== true || status?.transfers_status !== "active") {
      throw new Error(`stripe-connect status as the seller: ${JSON.stringify(status)}`);
    }
    const synced = await readProfile(c.rest, state.users.seller);
    if (synced.stripe_payouts_enabled !== true) throw new Error(`payout gate not synced: ${JSON.stringify(synced)}`);
    step("3 linked + synced", { payouts_enabled: synced.stripe_payouts_enabled, charges_enabled: synced.stripe_charges_enabled, identity_verified: synced.stripe_identity_verified });

    // 4. The listing, as the seller.
    const { chromium } = await import("@playwright/test");
    browser = await chromium.launch({ headless: true });
    const windows = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, starts: "00:00", ends: "23:59" }));
    await seller.rpc("declutter_set_pickup_windows", { p_windows: windows });
    const itemId = await seller.rpc("declutter_create_item", {
      p_title: `Payout proof lamp ${state.runId}`, p_description: "Test listing for the Declutter payout proof (Stripe test mode).",
      p_category: "home_decor", p_condition_stars: 4, p_delivery_size: "small", p_price_cents: priceCents, p_floor_price_cents: priceCents,
      p_area_label: "Mid City", p_pickup_address: "100 Audit Way, Baton Rouge, LA 70801", p_pickup_lat: 30.45, p_pickup_lng: -91.15,
    });
    state.itemId = itemId;
    for (let n = 1; n <= 3; n++) {
      const path = `${state.users.seller}/declutter/${itemId}/proof-${state.runId}-${n}.jpg`;
      await seller.upload(path, await listingPhoto(browser, n), "image/jpeg");
      await seller.rpc("declutter_add_item_photo", { p_item_id: itemId, p_storage_path: path });
    }
    await seller.rpc("declutter_attest_item", {
      p_item_id: itemId, p_bought_for_personal_use: true, p_not_in_the_business: true, p_not_a_frequent_seller: true, p_keeps_item_until_handover: true,
    });
    const published = await seller.rpc("declutter_publish_item", { p_item_id: itemId });
    if (published === "pending_review") await approveOwnListing(c, state, itemId);
    else if (published !== "live") throw new Error(`publish answered ${JSON.stringify(published)}`);
    step("4 listed", { item: itemId, publish: published });

    // 5. The buyer's card (Stripe's card page, 4242), then Buy now.
    const card = await buyer.fn("declutter-card", {});
    await payCheckout(browser, String(card?.url ?? ""), "card page");
    const saved = await poll("the buyer's card to be saved by the webhook", async () => {
      const [r] = await c.rest("GET", `declutter_buyer_cards?user_id=eq.${state.users.buyer}&select=card_mode,last4`);
      return r?.card_mode === "test" && r.last4 === "4242" ? r : null;
    });
    const line = await buyer.rpc("declutter_buy_now", { p_item_id: itemId, p_expected_price_cents: priceCents });
    step("5 card saved + bought", { card_mode: saved.card_mode, cart_line: line });

    // 6. Porch checkout, paid with 4242.
    const pay = await buyer.fn("declutter-checkout", { action: "pay", seller_id: state.users.seller, handover: "porch" });
    if (pay?.paid !== true) await payCheckout(browser, String(pay?.url ?? ""), "checkout page");
    const order = await poll("the order to be paid (webhook)", async () => {
      const [o] = await c.rest("GET", `declutter_orders?buyer_id=eq.${state.users.buyer}&seller_id=eq.${state.users.seller}&status=eq.paid&select=id,status,handover,items_cents,premium_cents,tax_cents,delivery_cents,total_cents,card_fee_cents,fee_rule,is_seed,stripe_payment_intent_id,paid_at`);
      return o ?? null;
    }, { timeoutMs: 180_000 });
    state.orderId = order.id;
    const fee = buyerFeeCents(order.items_cents);
    const moneyProblems = [];
    if (order.items_cents !== priceCents) moneyProblems.push(`items_cents ${order.items_cents} != ${priceCents}`);
    if (order.premium_cents !== fee) moneyProblems.push(`buyer fee ${order.premium_cents} != 5% + 70c = ${fee}`);
    if (order.total_cents !== order.items_cents + order.premium_cents + order.tax_cents + order.delivery_cents) moneyProblems.push(`total ${order.total_cents} is not the sum of its parts`);
    if (order.is_seed !== true) moneyProblems.push("order is not is_seed");
    if (order.handover !== "porch") moneyProblems.push(`handover ${order.handover}`);
    if (!/^pi_/.test(order.stripe_payment_intent_id ?? "")) moneyProblems.push("no payment intent");
    if (moneyProblems.length) throw new Error(`order ${order.id}: ${moneyProblems.join("; ")}`);
    const pi = await c.stripe("GET", `/v1/payment_intents/${order.stripe_payment_intent_id}`);
    if (pi.livemode !== false || pi.status !== "succeeded" || pi.amount !== order.total_cents) throw new Error(`payment intent ${pi.id}: livemode=${pi.livemode} status=${pi.status} amount=${pi.amount}`);
    state.chargeId = typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge?.id;
    if (!/^ch_/.test(state.chargeId ?? "")) throw new Error(`payment intent ${pi.id} has no charge (latest_charge=${JSON.stringify(pi.latest_charge)})`);
    state.paymentIntentId = pi.id;
    step("6 paid", { order: order.id, items: order.items_cents, buyer_fee: order.premium_cents, tax: order.tax_cents, total: order.total_cents, card_fee: order.card_fee_cents, fee_rule: order.fee_rule, pi: pi.id, charge: state.chargeId });

    // 7. Book the porch pickup, then the buyer's "I got it".
    const booked = await buyer.rpc("declutter_book_pickup", { p_order_id: order.id, p_slot_start: pickupSlot() });
    const handed = await buyer.rpc("declutter_confirm_handover", { p_order_id: order.id, p_method: "buyer", p_code: null });
    if (handed?.result !== "handed_over" || !handed.payout_id) throw new Error(`confirm_handover: ${JSON.stringify(handed)}`);
    state.payoutId = handed.payout_id;
    const [payout0] = await c.rest("GET", `declutter_payouts?id=eq.${handed.payout_id}&select=id,order_id,seller_id,items_cents,debt_cents,amount_cents,status`);
    if (payout0.seller_id !== state.users.seller || payout0.items_cents !== order.items_cents || payout0.debt_cents !== 0 || payout0.amount_cents !== order.items_cents || payout0.status !== "pending") {
      throw new Error(`payout row: ${JSON.stringify(payout0)}`);
    }
    step("7 handed over", { booked: booked?.result, payout: payout0.id, amount: payout0.amount_cents, status: payout0.status });

    // 8. The scheduled declutter-money run sends the transfer (every 10 min).
    let seen = "";
    const payout = await poll("declutter-money to send the payout", async () => {
      const [p] = await c.rest("GET", `declutter_payouts?id=eq.${state.payoutId}&select=id,order_id,seller_id,items_cents,debt_cents,amount_cents,status,stripe_transfer_id,attempts,last_error,executed_at,next_attempt_at,review_reason`);
      const now = `${p.status} attempts=${p.attempts} next=${p.next_attempt_at} last_error=${p.last_error ?? ""}`;
      if (now !== seen) log(`payout ${p.id}: ${(seen = now)}`);
      if (p.status === "succeeded") return p;
      // A skipped run (not ready yet, a transient Stripe error) keeps it pending with a later
      // next_attempt_at and is logged above; only a state no later run leaves is an end.
      if (["held_for_review", "settled_by_hand", "nothing_due"].includes(p.status) || p.attempts >= 12) {
        throw new Error(`payout ${p.id} ended ${p.status}: ${p.last_error ?? p.review_reason ?? ""}`);
      }
      return null;
    }, { every: 20_000, timeoutMs: 25 * 60_000 });
    const transfer = await c.stripe("GET", `/v1/transfers/${payout.stripe_transfer_id}`);
    const problems = transferProblems(transfer, { accountId: state.accountId, payout, chargeId: state.chargeId, priceCents });
    const group = await c.stripe("GET", "/v1/transfers", { transfer_group: `declutter_order_${order.id}`, limit: 10 });
    if (group.data.length !== 1 || group.data[0].id !== transfer.id) problems.push(`the order's transfer group holds ${group.data.map((t) => t.id).join(", ") || "nothing"}, not exactly ${transfer.id}`);
    if (problems.length) throw new Error(`transfer ${transfer.id}: ${problems.join("; ")}`);
    const landed = transfer.destination_payment
      ? await c.stripe("GET", `/v1/charges/${typeof transfer.destination_payment === "string" ? transfer.destination_payment : transfer.destination_payment.id}`, null, { account: state.accountId })
      : null;
    if (!landed || landed.amount !== payout.amount_cents) throw new Error(`no payment of ${payout.amount_cents} on ${state.accountId}: ${JSON.stringify(landed && { id: landed.id, amount: landed.amount })}`);
    state.result = {
      order: order.id, payment_intent: state.paymentIntentId, payout: payout.id, transfer: transfer.id, destination: state.accountId, amount_cents: transfer.amount,
      items_cents: order.items_cents, buyer_fee_cents: order.premium_cents, total_cents: order.total_cents,
      landed_payment: landed.id, executed_at: payout.executed_at,
    };
    step("8 PAYOUT LANDED", state.result);
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Declutter payout proof ${state.runId}: landed\n\n| | |\n|---|---|\n${Object.entries(state.result).map(([k, v]) => `| ${k} | ${v} |`).join("\n")}\n`);
    }
  } catch (err) {
    state.failure = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    if (browser) await browser.close().catch(() => {});
    try {
      await closeAfterFailure(c, state);
    } catch (err) {
      console.log(`::error title=Close after failure failed::${err.message} (order ${state.orderId ?? "-"}, payout ${state.payoutId ?? "-"})`);
      process.exitCode = 1;
    }
    try {
      await unlinkRun(c, state);
    } catch (err) {
      console.log(`::error title=Unlink failed::${err.message}`);
      process.exitCode = 1;
    }
    saveState(stateFile, state);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const opt = (n) => { const i = args.indexOf(`--${n}`); return i < 0 ? undefined : args[i + 1]; };
  const stateFile = opt("state");
  if (cmd === "run") return run(stateFile, Number(opt("price-cents") || 500));
  if (cmd === "unlink") {
    // The workflow's if: always() step: close a failed run's money, then unlink (both idempotent).
    const e = env();
    const refused = testKeyRefusal(e.key);
    if (refused) throw new Error(refused);
    const state = loadState(stateFile);
    if (!state) return log(`unlink: no state file ${stateFile}; nothing was created`);
    const c = clients(e);
    let failed = null;
    await closeAfterFailure(c, state).catch((err) => { failed = err; });
    await unlinkRun(c, state);
    saveState(stateFile, state);
    if (failed) throw failed;
    return;
  }
  if (cmd === "restore-verdict") {
    const state = loadState(stateFile);
    const drift = JSON.parse(readFileSync(opt("drift"), "utf8"));
    const { problems, others } = restoreVerdict(drift, { paymentIntent: state?.result?.payment_intent, transfer: state?.result?.transfer });
    for (const o of others) console.log(`::warning title=Restore check: not this proof's::${o} has no database row (another run's object in the same window)`);
    if (problems.length) throw new Error(`restore check: ${problems.join("; ")}`);
    return log(`restore check reads the proof's money: ${state.result.payment_intent} and ${state.result.transfer} both have their rows`);
  }
  throw new Error("usage: declutterPayoutProof.mjs run|unlink|restore-verdict --state <file> [--price-cents 500] [--drift <json>]");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.log(`::error title=Declutter payout proof failed::${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
