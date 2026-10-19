/*
 * GUARD: the Declutter payout proof (scripts/e2e/declutterPayoutProof.mjs +
 * .github/workflows/declutter-payout-proof.yml) can only ever run on Stripe
 * TEST mode, only writes what its own run created, never works around a
 * platform without Custom accounts, and always unlinks the run's Stripe
 * account from its throwaway seller.
 *
 * WHY (handoffs-1017/declutter-payout-proof.md, 2026-10-19): no test seat
 * could take a Declutter transfer, and two earlier lanes linked Connect
 * accounts to SHARED seats during money proofs (helper-e2e 2026-10-15,
 * eli.test.helper 2026-10-18), turning the journeys red. The proof makes its
 * own throwaway seller and Custom test account instead; these checks keep it
 * from ever touching a seat, a real member or the live key.
 */
// @mutate scripts/e2e/declutterPayoutProof.mjs |   if (!/^(sk\|rk)_test_/.test(key)) return | if (false) return
// @mutate scripts/e2e/declutterPayoutProof.mjs |   if (!want \|\| row.user_id !== want) return | if (false) return
// @mutate scripts/e2e/declutterPayoutProof.mjs |   if (m.lh_proof !== PROOF_TAG \|\| m.lh_proof_run !== state.runId) return | if (false) return
// @mutate scripts/e2e/declutterPayoutProof.mjs |   if (dest !== accountId) out.push | if (false) out.push
// @mutate scripts/e2e/seatStripeAccounts.mjs |   return ageMin >= -5 && ageMin <= PROOF_RUN_WINDOW_MINUTES; |   return ageMin >= -5;
// @mutate scripts/e2e/declutterPayoutProof.mjs |   if (o.status === "paid") { |   if (false) {
// @mutate scripts/e2e/declutterPayoutProof.mjs |   const acct = await c.stripe("GET", `/v1/accounts/${state.accountId}`).catch((err) => { |   const acct = await c.stripe("GET", `/v1/accounts/${state.accountId}`).then((a) => a, (err) => { throw err;
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { PROOF_SELLER_EMAIL, proofRunInFlight, stripeSeatViolations } from "../../scripts/e2e/seatStripeAccounts.mjs";
import {
  accountRefusal,
  buyerFeeCents,
  closeAfterFailure,
  restoreVerdict,
  unlinkRun,
  isCustomAccountsDisabled,
  newRunId,
  pickupSlot,
  profileRefusal,
  proofEmail,
  PROOF_TAG,
  testKeyRefusal,
  transferProblems,
} from "../../scripts/e2e/declutterPayoutProof.mjs";

const ROOT = join(__dirname, "..", "..");
const runId = newRunId(new Date("2026-10-19T21:00:00Z"), "abc123");
const state = { runId, users: { seller: "11111111-1111-4111-8111-111111111111", buyer: "22222222-2222-4222-8222-222222222222" }, accountId: "acct_run" };
const sellerRow = { user_id: state.users.seller, email: proofEmail(runId, "seller"), is_seed: true };

describe("declutter payout proof: test mode only", () => {
  it("refuses any key that is not a test-mode key", () => {
    expect(testKeyRefusal("sk_test_x")).toBeNull();
    expect(testKeyRefusal("rk_test_x")).toBeNull();
    for (const k of ["sk_live_x", "rk_live_x", "", undefined, "pk_test_x", "xsk_test_"]) expect(testKeyRefusal(k)).not.toBeNull();
  });

  it("the throwaway accounts are fixture inboxes named for the run", () => {
    expect(proofEmail(runId, "buyer")).toBe(`helpr-payout-proof-${runId}-buyer@mailinator.com`);
    expect(() => proofEmail("x'; drop", "seller")).toThrow();
  });
});

describe("declutter payout proof: writes only what this run created", () => {
  const enrolled = new Set([state.users.seller]);
  it("allows the run's own seller, is_seed and enrolled", () => {
    expect(profileRefusal(sellerRow, state, "seller", { enrolledIds: enrolled })).toBeNull();
  });
  it("refuses a shared seat, another run's account, a non-seed or an unenrolled row", () => {
    const helperE2e = { user_id: "7b923b19-0000-4000-8000-000000000000", email: "helpr-e2e-helper-0902@mailinator.com", is_seed: true };
    expect(profileRefusal(helperE2e, state, "seller", { enrolledIds: new Set([helperE2e.user_id]) })).not.toBeNull();
    expect(profileRefusal({ ...sellerRow, email: proofEmail(newRunId(new Date(), "ffffff"), "seller") }, state, "seller")).not.toBeNull();
    // Even with this run's address, an id the run did not create is refused.
    const notOurs = "33333333-3333-4333-8333-333333333333";
    expect(profileRefusal({ ...sellerRow, user_id: notOurs }, state, "seller", { enrolledIds: new Set([notOurs]) })).not.toBeNull();
    expect(profileRefusal({ ...sellerRow, is_seed: false }, state, "seller")).not.toBeNull();
    expect(profileRefusal(sellerRow, state, "seller", { enrolledIds: new Set() })).not.toBeNull();
    expect(profileRefusal(sellerRow, state, "buyer")).not.toBeNull();
    expect(profileRefusal(null, state, "seller")).not.toBeNull();
  });
  it("touches only the Stripe test account this run made", () => {
    const acct = { id: "acct_run", livemode: false, metadata: { lh_proof: PROOF_TAG, lh_proof_run: runId } };
    expect(accountRefusal(acct, state)).toBeNull();
    expect(accountRefusal({ ...acct, id: "acct_1UQigP3qNyg1xGcp" }, state)).not.toBeNull();
    expect(accountRefusal({ ...acct, livemode: true }, state)).not.toBeNull();
    expect(accountRefusal({ ...acct, metadata: { lh_proof: PROOF_TAG, lh_proof_run: "other" } }, state)).not.toBeNull();
    expect(accountRefusal(acct, { ...state, accountId: null })).not.toBeNull();
  });
});

describe("declutter payout proof: Custom accounts not enabled is reported, not worked around", () => {
  it("recognises Stripe's refusals", () => {
    for (const message of [
      "You cannot create Custom accounts. Please enable them in your Connect settings.",
      "Please review the responsibilities of managing losses for connected accounts at https://dashboard.stripe.com/settings/connect/platform-profile.",
      "You can only create new accounts if you've signed up for Connect, which you can learn how to do at https://stripe.com/docs/connect.",
    ]) expect(isCustomAccountsDisabled({ type: "invalid_request_error", message })).toBe(true);
    expect(isCustomAccountsDisabled({ type: "invalid_request_error", message: "Invalid dob" })).toBe(false);
    expect(isCustomAccountsDisabled({ type: "api_error", message: "custom accounts" })).toBe(false);
  });
  it("exits 3 on it and creates no other kind of account", () => {
    const src = readFileSync(join(ROOT, "scripts/e2e/declutterPayoutProof.mjs"), "utf8");
    expect(src).toMatch(/isCustomAccountsDisabled\(err\)\) \{[\s\S]{0,600}process\.exitCode = 3;\s*return;/);
    expect(src.match(/"\/v1\/accounts",/g)).toHaveLength(1);
    expect(src).toContain('type: "custom"');
    expect(src).not.toMatch(/type: "(express|standard)"/);
  });
});

describe("declutter payout proof: the payout is checked to the cent", () => {
  const payout = { id: "p1", order_id: "o1", amount_cents: 500 };
  const good = {
    livemode: false, destination: "acct_run", amount: 500, amount_reversed: 0, currency: "usd", reversed: false,
    metadata: { kind: "declutter_payout", payout_id: "p1" }, transfer_group: "declutter_order_o1", source_transaction: "ch_1",
  };
  it("an exact transfer has no problems; each wrong field is named", () => {
    expect(transferProblems(good, { accountId: "acct_run", payout, chargeId: "ch_1", priceCents: 500 })).toEqual([]);
    expect(transferProblems({ ...good, destination: "acct_other" }, { accountId: "acct_run", payout, chargeId: "ch_1", priceCents: 500 })).toHaveLength(1);
    // Short by a cent: wrong against both the payout row and the item price.
    expect(transferProblems({ ...good, amount: 499 }, { accountId: "acct_run", payout, chargeId: "ch_1", priceCents: 500 })).toHaveLength(2);
    expect(transferProblems({ ...good, livemode: true }, { accountId: "acct_run", payout, chargeId: "ch_1", priceCents: 500 })).toHaveLength(1);
    expect(transferProblems({ ...good, source_transaction: "ch_2" }, { accountId: "acct_run", payout, chargeId: "ch_1", priceCents: 500 })).toHaveLength(1);
    expect(transferProblems({ ...good, amount_reversed: 100 }, { accountId: "acct_run", payout, chargeId: "ch_1", priceCents: 500 })).toHaveLength(1);
    expect(transferProblems(good, { accountId: "acct_run", payout, chargeId: "ch_1", priceCents: 600 })).toHaveLength(1);
    // No charge id is a problem, never a skipped check.
    expect(transferProblems(good, { accountId: "acct_run", payout, chargeId: null, priceCents: 500 }).length).toBeGreaterThan(0);
    expect(transferProblems(null, { accountId: "acct_run", payout, priceCents: 500 })).toEqual(["no transfer"]);
  });
  it("buyer fee F1 is 5% + 70c (declutter_buyer_fee_cents)", () => {
    expect(buyerFeeCents(500)).toBe(95);
    expect(buyerFeeCents(1234)).toBe(132);
  });
  it("the pickup slot starts inside the seller's whole-day windows", () => {
    for (const iso of ["2026-10-20T04:10:00Z", "2026-10-19T12:00:00Z", "2026-11-02T05:50:00Z"]) {
      const s = new Date(pickupSlot(new Date(iso)));
      expect(s.getTime()).toBeGreaterThan(new Date(iso).getTime() + 89 * 60_000);
      const hm = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(s);
      expect(hm <= "23:29").toBe(true);
    }
  });
});

describe("declutter payout proof: the restore check is scoped to the proof's own money", () => {
  const ids = { paymentIntent: "pi_proof", transfer: "tr_proof" };
  const report = (piMissing: string[], trMissing: string[], matched = 1) => ({
    report: { payment_intent: { matched, missing: piMissing.map((id) => ({ id })) }, transfer: { matched, missing: trMissing.map((id) => ({ id })) } },
  });
  it("passes when the proof's ids have rows, and only reports other runs' objects", () => {
    expect(restoreVerdict(report([], []), ids)).toEqual({ problems: [], others: [] });
    expect(restoreVerdict(report(["pi_other"], []), ids)).toEqual({ problems: [], others: ["payment_intent pi_other"] });
  });
  it("fails when a proof id has no row, nothing matched, or the record has no id", () => {
    expect(restoreVerdict(report(["pi_proof"], []), ids).problems).toHaveLength(1);
    expect(restoreVerdict(report([], ["tr_proof"]), ids).problems).toHaveLength(1);
    expect(restoreVerdict(report([], [], 0), ids).problems).toHaveLength(2);
    expect(restoreVerdict(report([], []), { paymentIntent: "pi_proof", transfer: undefined as unknown as string }).problems).toHaveLength(1);
  });
});

describe("seat checks exempt a payout proof's seller only while its run can still be going", () => {
  const started = new Date("2026-10-19T21:00:00Z");
  const run = newRunId(started, "0a1b2c");
  const row = { user_id: "u", email: proofEmail(run, "seller"), is_seed: true, stripe_account_id: "acct_run", stripe_payouts_enabled: true, stripe_charges_enabled: true, stripe_identity_verified: true };
  const at = (min: number) => started.getTime() + min * 60_000;
  it("the seat check's pattern is the address the proof makes (seller only)", () => {
    expect(PROOF_SELLER_EMAIL.test(proofEmail(run, "seller"))).toBe(true);
    expect(PROOF_SELLER_EMAIL.test(proofEmail(run, "buyer"))).toBe(false);
  });
  it("in flight: not a violation; after the window, or not is_seed: a violation", () => {
    expect(proofRunInFlight(row, at(30))).toBe(true);
    expect(stripeSeatViolations([row], at(30))).toEqual([]);
    expect(stripeSeatViolations([row], at(121))).toHaveLength(1);
    expect(stripeSeatViolations([{ ...row, is_seed: false }], at(30))).toHaveLength(1);
    expect(stripeSeatViolations([{ ...row, email: "helpr-e2e-helper-0902@mailinator.com" }], at(30))).toHaveLength(1);
  });
});

/** A fake client that records writes; GET answers come from `gets` by path prefix. */
function fakeClient(gets: Record<string, unknown[]>, { stripeFails = false } = {}) {
  const writes: Array<{ method: string; path: string; body: unknown }> = [];
  const c = {
    writes,
    rest: async (method: string, path: string, body?: unknown) => {
      if (method === "GET") {
        const key = Object.keys(gets).find((k) => path.startsWith(k));
        return key ? gets[key] : [];
      }
      writes.push({ method, path, body });
      if (path.startsWith("profiles?")) return [{ user_id: state.users.seller, stripe_account_id: null }];
      return { ok: true };
    },
    stripe: async (_m: string, path: string) => {
      if (stripeFails) throw new Error("Stripe unreachable");
      if (path.startsWith("/v1/accounts/")) return { id: "acct_run", livemode: false, metadata: { lh_proof: PROOF_TAG, lh_proof_run: runId } };
      return { data: [] };
    },
  };
  return c;
}

describe("declutter payout proof: a failed run closes its money before the unlink", () => {
  const base = { ...state, orderId: "o1", payoutId: "p1", failure: "timed out" };
  const order = (status: string) => ({ "declutter_orders?": [{ id: "o1", status, is_seed: true }] });
  it("paid, not handed over: refunds the buyer the sanctioned way", async () => {
    const c = fakeClient(order("paid"));
    await closeAfterFailure(c, { ...base });
    expect(c.writes).toEqual([{ method: "POST", path: "rpc/declutter_refund_paid_order", body: { p_order_id: "o1", p_reason: "seller_backed_out" } }]);
  });
  it("handed over with a pending payout: holds it for review", async () => {
    const c = fakeClient({ ...order("handed_over"), "declutter_payouts?": [{ id: "p1", status: "pending", amount_cents: 500 }] });
    await closeAfterFailure(c, { ...base });
    expect(c.writes.map((w) => w.path)).toEqual(["rpc/payout_hold_for_review"]);
    expect((c.writes[0].body as { p_kind: string }).p_kind).toBe("declutter");
  });
  it("leaves alone a sent payout, a proven run, and an order that is not this run's", async () => {
    const sent = fakeClient({ ...order("handed_over"), "declutter_payouts?": [{ id: "p1", status: "succeeded" }] });
    await closeAfterFailure(sent, { ...base });
    const proven = fakeClient(order("paid"));
    await closeAfterFailure(proven, { ...base, result: { transfer: "tr_1" } });
    const foreign = fakeClient({});
    await closeAfterFailure(foreign, { ...base });
    expect([...sent.writes, ...proven.writes, ...foreign.writes]).toEqual([]);
  });
});

describe("declutter payout proof: the unlink", () => {
  const linked = { "profiles?": [{ ...sellerRow, stripe_account_id: "acct_run" }], "test_accounts?": [{ user_id: state.users.seller }] };
  it("does not need Stripe: the database scope alone is enough", async () => {
    const c = fakeClient(linked, { stripeFails: true });
    await unlinkRun(c, { ...state });
    expect(c.writes).toHaveLength(1);
    expect(c.writes[0].path).toContain(`user_id=eq.${state.users.seller}&stripe_account_id=eq.acct_run&is_seed=is.true`);
  });
  it("returns quietly with no profile row or nothing linked", async () => {
    const none = fakeClient({});
    await unlinkRun(none, { ...state });
    const clean = fakeClient({ "profiles?": [{ ...sellerRow, stripe_account_id: null }] });
    await unlinkRun(clean, { ...state });
    expect([...none.writes, ...clean.writes]).toEqual([]);
  });
});

describe("declutter payout proof: the listing approval is the review RPC's approve UPDATE", () => {
  it("sends exactly the columns declutter_admin_review_item sets, under its WHERE", () => {
    const def = effectiveDefs(join(ROOT, "supabase", "migrations")).get("declutter_admin_review_item")?.stmt ?? "";
    const set = /UPDATE public\.declutter_items\s+SET([\s\S]*?)WHERE id = p_item_id AND status = 'pending_review'/.exec(def);
    expect(set, "declutter_admin_review_item's approve UPDATE changed shape").not.toBeNull();
    const rpcCols = [...set![1].matchAll(/(\w+)\s*=/g)].map((m) => m[1]).sort();
    const src = readFileSync(join(ROOT, "scripts/e2e/declutterPayoutProof.mjs"), "utf8");
    const patch = /declutter_items\?id=eq\.\$\{itemId\}&seller_id=eq\.\$\{state\.users\.seller\}&status=eq\.pending_review&is_seed=is\.true[^`]*`,\s*\{([^}]*)\}/.exec(src);
    expect(patch, "approveOwnListing's PATCH not found").not.toBeNull();
    const ours = [...patch![1].matchAll(/(\w+):/g)].map((m) => m[1]).sort();
    expect(rpcCols).toEqual(["admin_approved_at", "live_at", "status", "updated_at"]);
    expect(ours).toEqual(rpcCols);
  });
});

describe("declutter-payout-proof.yml", () => {
  const wf = parse(readFileSync(join(ROOT, ".github/workflows/declutter-payout-proof.yml"), "utf8"));
  const raw = readFileSync(join(ROOT, ".github/workflows/declutter-payout-proof.yml"), "utf8");
  const steps: Array<{ name?: string; run?: string; if?: string }> = wf.jobs.proof.steps;

  it("is manual only", () => {
    expect(Object.keys(wf.on ?? wf[true as unknown as string])).toEqual(["workflow_dispatch"]);
  });
  it("fails closed before any write: the key must be a test key", () => {
    const gateIdx = steps.findIndex((s) => /sk_test_\*\|rk_test_\*\) ;;\s*\*\)[^\n]*exit 1/.test(s.run ?? ""));
    expect(gateIdx).toBeGreaterThanOrEqual(0);
    const runIdx = steps.findIndex((s) => (s.run ?? "").includes("declutterPayoutProof.mjs run"));
    expect(gateIdx).toBeLessThan(runIdx);
  });
  it("does not gate on the platform-wide E2E_STRIPE_MODE (live since 2026-09-28; test accounts run on the test key)", () => {
    // The parsed workflow (comments excluded, where the reason is written down).
    expect(JSON.stringify(wf)).not.toMatch(/E2E_STRIPE_MODE/);
  });
  it("checks out first, and the cleanup step is a no-op when the run never started", () => {
    expect((steps[0] as { uses?: string }).uses ?? "").toMatch(/^actions\/checkout@/);
    const cleanup = steps.find((s) => (s.run ?? "").includes("declutterPayoutProof.mjs unlink"));
    expect(cleanup?.run ?? "").toMatch(/if \[ -f "\$STATE" \]; then\s+node scripts\/e2e\/declutterPayoutProof\.mjs unlink[^\n]*\s+else\s+echo/);
  });
  it("never echoes a secret", () => {
    for (const line of raw.split("\n")) {
      if (/\becho\b|::add-mask::|printf/.test(line)) expect(line).not.toMatch(/\$\{?(STRIPE_TEST_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY)/);
    }
  });
  it("has at least 60 minutes, with a fixed budget for the cleanup step", () => {
    expect(wf.jobs.proof["timeout-minutes"]).toBeGreaterThanOrEqual(60);
    const unlink = steps.find((s) => (s.run ?? "").includes("declutterPayoutProof.mjs unlink")) as { "timeout-minutes"?: number };
    expect(unlink["timeout-minutes"]).toBeGreaterThan(0);
    expect(raw).toContain("inputs.price_cents || '500'");
  });
  it("unlinks the run's account whatever happens", () => {
    const unlink = steps.find((s) => (s.run ?? "").includes("declutterPayoutProof.mjs unlink"));
    expect(unlink?.if).toBe("always()");
    const runIdx = steps.findIndex((s) => (s.run ?? "").includes("declutterPayoutProof.mjs run"));
    expect(runIdx).toBeGreaterThan(0);
    expect(steps.indexOf(unlink!)).toBeGreaterThan(runIdx);
  });
  it("runs the restore check on the proof's money", () => {
    expect(steps.some((s) => (s.run ?? "").includes("check-stripe-restore-drift.mjs") && (s.run ?? "").includes("--mode test"))).toBe(true);
  });
  it("the script unlinks with the same fields seatStripeAccounts --restore clears", () => {
    const src = readFileSync(join(ROOT, "scripts/e2e/declutterPayoutProof.mjs"), "utf8");
    expect(src).toContain('import { RESET_FIELDS } from "./seatStripeAccounts.mjs"');
    expect(src).toMatch(/finally \{[\s\S]*await unlinkRun\(c, state\)/);
  });
});
