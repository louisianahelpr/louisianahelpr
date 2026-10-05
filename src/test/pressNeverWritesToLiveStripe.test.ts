// @mutate scripts/audit/pressProdSafety.mjs | set up payouts\|stripe\| |
// @mutate scripts/audit/press-every-control.mjs |         if (isStripeWriteRequest(req.url(), req.postData()) && (await stripeMode()).mode !== "test") { |         if (false) {
// @mutate scripts/audit/pressProdSafety.mjs |   "stripe-connect", |   "stripe-connectX",
// @mutate scripts/audit/pressProdSafety.mjs |reset & start fresh\| |
// @mutate src/components/PayoutSetupForm.tsx |                 aria-label={`Remove payout method ending in ${m.last4}`}\n | \n
// @mutate scripts/audit/pressProdSafety.mjs |         method: "GET", headers: { Authorization: `Bearer ${secret}` }, |         method: "POST", headers: { Authorization: `Bearer ${secret}` },
// @mutate scripts/audit/pressProdSafety.mjs |     if (!secret) return (cached = { mode: "unknown", |     if (!secret) return (cached = { mode: "test",
// @mutate scripts/audit/pressProdSafety.mjs |       cached = { mode: m === "live" \|\| m === "test" ? m : "unknown", |       cached = { mode: "test",
/*
 * CLASS GUARD: the prod presser never makes the app write to Stripe while
 * Stripe is LIVE (owner, 2026-10-01: "Skip it on live").
 *
 * Measured on press run 36784893957 (dispatched 2026-09-30T22:19Z): the
 * control "Set Up Payouts with Stripe" on /profile?tab=earnings was PASSED for
 * both shared accounts, and its recorded outcome was
 *   customer: navigated → https://connect.stripe.com/setup/e/acct_1ULXMy3ISOxM8qBC/…
 *   helper:   navigated → https://connect.stripe.com/setup/e/acct_1ULXMw40YhFTkeRO/…
 * (results.json in the run's press-every-control artifact). The button calls
 * stripe-connect `onboard`, which runs stripe.accounts.create — a LIVE Connect
 * account per shared test user. It escaped the Stripe gate because the label
 * says "Payouts" and PAYMENT_RX only knew "payout" (\b stops at the s), and no
 * other word in it is in DESTRUCTIVE_RX, so it was never gated at all.
 *
 * Two layers, both checked here:
 *   1. LABEL: every known Stripe-writing control is gated and, on live, skipped
 *      with SKIP_STRIPE (reported, not dropped).
 *   2. NETWORK: whatever its label, a press whose request reaches a
 *      Stripe-writing edge function is aborted on live and the control is
 *      recorded SKIP_STRIPE_WRITE_BLOCKED. The function list is derived from
 *      supabase/functions source, two-way.
 */
import { describe, it, expect, vi, afterEach, afterAll, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
// @ts-expect-error - plain .mjs tool script, no types
import * as safety from "../../scripts/audit/pressProdSafety.mjs";
// @ts-expect-error - plain .mjs tool script, no types
import * as harness from "../../scripts/audit/press-every-control.mjs";
import { readdirSync } from "./helpers/trackedFiles";

const ROOT = resolve(__dirname, "../..");
const PAYMENT_RX = safety.PAYMENT_RX as RegExp;
const mutationGate = safety.mutationGate as (a: Record<string, unknown>) => Promise<string | null>;
const live = async () => ({ mode: "live", detail: "cs_live_ probe" });

/** Every visible label of a control that makes the app write to Stripe, and the file that renders it. */
const STRIPE_WRITE_LABELS: Array<[label: string, source: string]> = [
  ["Set Up Payouts with Stripe", "src/components/PayoutSetupForm.tsx"], // stripe-connect onboard → accounts.create (run 36784893957)
  ["Complete Stripe Verification", "src/components/PayoutSetupForm.tsx"], // update_onboarding → accountLinks.create
  ["Manage Payouts on Stripe", "src/components/PayoutSetupForm.tsx"], // dashboard → accounts.update + login link
  ["Set Up Payouts", "src/lib/awardGate.ts"], // AwardGateDialog → onboard
  // Q896: these two had no label the gate knew. The trash icon had NO
  // accessible name (the harness saw "<button>", which no RX matches) and
  // "Reset & Start Fresh" matched DESTRUCTIVE_RX but not PAYMENT_RX, so on
  // /profile (SELF_ROUTE_RX) it was pressed. Only the network backstop stopped
  // delete_payout_method and reset (stripe.accounts.del) on live.
  ["Remove payout method", "src/components/PayoutSetupForm.tsx"], // delete_payout_method → deleteExternalAccount
  ["Having Issues? Reset & Start Fresh", "src/components/PayoutSetupForm.tsx"], // opens the reset confirm
  ["Reset & Start Fresh", "src/components/PayoutSetupForm.tsx"], // confirm → stripe-connect reset → accounts.del
];

describe("press never writes to Stripe while Stripe is live", () => {
  it("every Stripe-writing label exists in the app and is skipped on live (reported as SKIP_STRIPE)", async () => {
    expect(STRIPE_WRITE_LABELS.length).toBeGreaterThan(3);
    for (const [label, source] of STRIPE_WRITE_LABELS) {
      expect(readFileSync(join(ROOT, source), "utf8"), `${label} no longer in ${source}`).toContain(label);
      // The harness only consults the gate for labels PAYMENT_RX (or another mutating test) admits.
      expect(PAYMENT_RX.test(label), `PAYMENT_RX misses "${label}"`).toBe(true);
      const why = await mutationGate({ label, meta: {}, chainOwned: false, persona: "helper", routeUrl: "/profile?tab=earnings", urlOwned: { owned: true }, owners: {}, stripeMode: live });
      expect(why, label).toBe(safety.SKIP_STRIPE);
      expect((harness.DOCUMENTED_SKIPS as Set<string>).has(why as string)).toBe(true);
    }
  });

  it("the icon-only remove-payout-method button carries the name the gate matches (Q896)", () => {
    const src = blankComments(readFileSync(join(ROOT, "src/components/PayoutSetupForm.tsx"), "utf8"));
    // The aria-label must sit on the same <Button> that renders the Trash2 icon.
    const btn = /<Button\b(?:(?!<\/Button>)[\s\S])*?<Trash2\b/.exec(src)?.[0] ?? "";
    expect(btn, "the Trash2 button exists").not.toBe("");
    expect(btn).toMatch(/aria-label=\{`Remove payout method\b/);
  });

  it("read-only payout controls stay pressable (the fix does not shrink the inventory)", () => {
    for (const label of ["Payouts", "Export Payouts CSV", "Turn on two-step verification"]) {
      expect(PAYMENT_RX.test(label), label).toBe(false);
    }
  });

  it("the blocked-function list is exactly the edge functions whose source writes to Stripe", () => {
    const WRITE_RX = /stripe\.[a-zA-Z.]+\.(create|update|del|cancel|capture|confirm|createLoginLink|deleteExternalAccount|pay|finalizeInvoice)\(/;
    const dir = join(ROOT, "supabase/functions");
    const tsFiles = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? tsFiles(join(d, e.name)) : /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [join(d, e.name)] : []);
    const writes = (f: string) => WRITE_RX.test(blankComments(readFileSync(f, "utf8")));
    // _shared modules that write to Stripe; a function importing one writes too.
    const sharedWriters = tsFiles(join(dir, "_shared")).filter(writes).map((f) => f.split("/").pop()!.replace(/\.ts$/, ""));
    expect(sharedWriters.length).toBeGreaterThan(0);
    const derived = readdirSync(dir).filter((fn) => {
      if (fn.startsWith("_") || !existsSync(join(dir, fn, "index.ts"))) return false;
      return tsFiles(join(dir, fn)).some((f) => {
        const src = blankComments(readFileSync(f, "utf8"));
        return WRITE_RX.test(src) || sharedWriters.some((s) => src.includes(`_shared/${s}.ts"`));
      });
    }).sort();
    expect(derived.length).toBeGreaterThan(10);
    const blocked = [...(safety.STRIPE_WRITE_FUNCTIONS as Set<string> ?? [])];
    const exempt = Object.keys((safety.STRIPE_WRITE_EXEMPT as Record<string, string>) ?? {});
    expect([...blocked, ...exempt].sort()).toEqual(derived);
  });

  it("the network backstop blocks writes and lets reads through", () => {
    const f = safety.isStripeWriteRequest as (url: string, body: string | null) => boolean;
    expect(typeof f).toBe("function");
    const u = (fn: string) => `https://fncmgoasalhdgfwzhsqa.supabase.co/functions/v1/${fn}`;
    expect(f(u("stripe-connect"), JSON.stringify({ action: "onboard", return_url: "x" }))).toBe(true);
    expect(f(u("stripe-connect"), JSON.stringify({ action: "reset" }))).toBe(true);
    expect(f(u("stripe-connect"), JSON.stringify({ action: "status" }))).toBe(false);
    expect(f(u("stripe-connect"), JSON.stringify({ action: "list_payout_methods" }))).toBe(false);
    expect(f(u("create-payment"), "{}")).toBe(true);
    expect(f(u("stripe-idv-start"), "{}")).toBe(true);
    expect(f(u("stripe-payouts"), "{}")).toBe(false);
    expect(f(u("health-check"), "{}")).toBe(false);
    expect((harness.DOCUMENTED_SKIPS as Set<string>).has(safety.SKIP_STRIPE_WRITE_BLOCKED)).toBe(true);
  });

  it("the harness wires the backstop into every browser context", () => {
    const src = blankComments(readFileSync(join(ROOT, "scripts/audit/press-every-control.mjs"), "utf8"));
    expect(src).toMatch(/ctx\.route\(\s*"\*\*\/functions\/v1\/\*\*"/);
    expect(src).toContain('if (isStripeWriteRequest(req.url(), req.postData()) && (await stripeMode()).mode !== "test") {');
    expect(src).toContain("skip(SKIP_STRIPE_WRITE_BLOCKED)");
  });

  // Q895: the mode probe itself used to mint a live Checkout Session — it
  // created a press job and POSTed create-payment {action:"escrow"} to read
  // cs_live_/cs_test_ off the URL. It must learn the mode without any write.
  describe("the Stripe mode probe never writes (Q895)", () => {
    // Scripts send keys only to *.supabase.co or a loopback stub (supabaseBase); stub the project URL.
    const savedUrl = process.env.PLAYWRIGHT_SUPABASE_URL;
    beforeAll(() => { process.env.PLAYWRIGHT_SUPABASE_URL = "http://127.0.0.1:1"; });
    afterAll(() => { if (savedUrl === undefined) delete process.env.PLAYWRIGHT_SUPABASE_URL; else process.env.PLAYWRIGHT_SUPABASE_URL = savedUrl; });
    afterEach(() => vi.unstubAllGlobals());
    const poster = { accessToken: "tok", userId: "00000000-0000-0000-0000-000000000001" };
    const stubFetch = (body: unknown) => {
      const calls: Array<{ url: string; method: string }> = [];
      vi.stubGlobal("fetch", async (url: string, init?: { method?: string }) => {
        calls.push({ url: String(url), method: (init?.method ?? "GET").toUpperCase() });
        return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
      });
      return calls;
    };
    const probe = safety.makeStripeProbe as (p: unknown, r: string, env?: Record<string, string>) => () => Promise<{ mode: string }>;

    it("with no CRON_SECRET it makes no request and reports unknown (treated as live)", async () => {
      const calls = stubFetch([{ id: "job-1", url: "https://checkout.stripe.com/c/pay/cs_live_abc" }]);
      const r = await probe(poster, "run", {})();
      expect(calls).toEqual([]);
      expect(r.mode).toBe("unknown");
    });

    it("with CRON_SECRET it only GETs health-check and reads checks.stripe_mode", async () => {
      for (const m of ["live", "test"]) {
        const calls = stubFetch({ checks: { stripe_mode: m } });
        const r = await probe(poster, "run", { CRON_SECRET: "s" })();
        expect(calls.map((c) => c.method)).toEqual(["GET"]);
        expect(calls[0].url).toMatch(/\/functions\/v1\/health-check$/);
        expect(r.mode).toBe(m);
      }
      stubFetch({ checks: { stripe_mode: "missing" } });
      expect((await probe(poster, "run", { CRON_SECRET: "s" })()).mode).toBe("unknown");
    });
  });
});
