/**
 * CLASS GUARD (PayPal tips, owner 2026-10-23: "tips live on day one of
 * PayPal"): every place the app offers a tip pays through PayPal when the
 * paypal_payments switch is on for the poster, quotes the fee PayPal charges,
 * and the poster's return from PayPal is captured.
 *
 * The class: a tip prompt that talks to a payment function on its own (as
 * TipDialog and CompletionPrompts both did, straight to create-payment "tip")
 * is left on Stripe, a closed processor, the day PayPal goes on; a prompt that
 * quotes Stripe's fee while PayPal charges its own shows the poster one number
 * and charges another; a return URL nobody reads leaves a paid tip uncaptured
 * until the webhook. Inventory from source:
 *   1. every src file that invokes a tip payment function ("create-payment"
 *      with action "tip", or "paypal-tip"): exactly the one helper,
 *      src/lib/tipCheckout.ts, which picks the processor from the switch;
 *   2. every tip prompt (each file rendering <TipCostBreakdown>): reads
 *      useFeature("paypal_payments"), starts the checkout through
 *      startTipCheckout with that answer, and quotes with the same answer;
 *   3. the server: paypal-tip refuses a member the switch is off for before
 *      any new money (the order, the tip row), never gates the capture of money
 *      already taken, captures only the payer's own tip, charges
 *      paypalTipChargeBreakdown's total, and returns to a page that mounts
 *      PayPalTipReturn.
 *
 * @mutate src/components/TipDialog.tsx | <TipCostBreakdown tipDollars={amount!} receiverName={helperName} paypal={paypal} /> | <TipCostBreakdown tipDollars={amount!} receiverName={helperName} />
 * @mutate src/components/CompletionPrompts.tsx | { jobId, amount, tipAttemptId: tipAttemptIdRef.current, paypal }, | { jobId, amount, tipAttemptId: tipAttemptIdRef.current, paypal: false },
 * @mutate src/lib/tipCheckout.ts | const { data, error } = req.paypal | const { data, error } = false
 * @mutate src/pages/jobs/JobsSection.tsx | <RefundsSwitchProvider><PayPalTipReturn /><JobListPage key="posted" | <RefundsSwitchProvider><JobListPage key="posted"
 * @mutate supabase/functions/paypal-tip/index.ts | const refused = await requireFeature(admin, "paypal_payments", user, corsHeaders); | const refused = null;
 * @mutate supabase/functions/paypal-tip/index.ts | amountCents: quote.chargeCents, | amountCents: quote.tipCents,
 * @mutate supabase/functions/paypal-tip/index.ts | if (!pay \|\| pay.subject_kind !== "tip" \|\| pay.payer_id !== user.id) | if (!pay \|\| pay.subject_kind !== "tip")
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

const ROOT = process.cwd();
const HELPER = "src/lib/tipCheckout.ts";
/** A missing file reads as empty, so its assertions fail by name instead of crashing the suite. */
const read = (f: string) => (existsSync(join(ROOT, f)) ? blankComments(readFileSync(join(ROOT, f), "utf8")) : "");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" || n === "test" || n === "__tests__" ? [] : walk(p);
    return /\.tsx?$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}
const src = walk(join(ROOT, "src")).map((f) => ({ f: relative(ROOT, f), code: blankComments(readFileSync(f, "utf8")) }));

/** Files that call a tip payment function: create-payment with action "tip", or paypal-tip. */
const tipCallers = src
  .filter(({ code }) => /invoke\(\s*"paypal-tip"/.test(code) || /invoke\(\s*"create-payment"\s*,\s*\{\s*(?:\/\/[^\n]*\n\s*)*body:\s*\{[^{}]*action:\s*"tip"/.test(code))
  .map(({ f }) => f)
  .sort();

/** Tip prompts: every file that renders the tip quote. */
const prompts = src.filter(({ code }) => /<TipCostBreakdown\b/.test(code)).map(({ f }) => f).sort();

describe("every tip prompt offers PayPal when the switch is on", () => {
  it("reads a real inventory (floors)", () => {
    expect(src.length).toBeGreaterThan(500);
    expect(prompts.length).toBeGreaterThan(1);
    expect(prompts).toEqual(expect.arrayContaining(["src/components/TipDialog.tsx", "src/components/CompletionPrompts.tsx"]));
  });

  it("only the one helper calls a tip payment function", () => {
    expect(tipCallers).toEqual([HELPER]);
  });

  it("the helper sends a PayPal poster to paypal-tip and everyone else to create-payment's tip", () => {
    const code = read(HELPER);
    const m = code.match(/const\s*\{\s*data,\s*error\s*\}\s*=\s*req\.paypal\s*\?\s*await supabase\.functions\.invoke\("paypal-tip",\s*\{\s*body:\s*\{\s*action:\s*"create"[\s\S]*?:\s*await supabase\.functions\.invoke\("create-payment",\s*\{[\s\S]*?action:\s*"tip"/);
    expect(m, "startTipCheckout branches on req.paypal: paypal-tip create, else create-payment tip").toBeTruthy();
    expect(code).toMatch(/export async function startTipCheckout\(/);
    expect(code).toMatch(/invoke\("paypal-tip",\s*\{\s*body:\s*\{\s*action:\s*"capture"/);
  });

  for (const f of ["src/components/TipDialog.tsx", "src/components/CompletionPrompts.tsx"]) {
    describe(f, () => {
      const code = read(f);
      const v = code.match(/const\s+(\w+)\s*=\s*useFeature\("paypal_payments"\)/)?.[1];
      it("reads the switch from the server", () => {
        expect(v).toBeTruthy();
      });
      it("starts the checkout through startTipCheckout with that answer", () => {
        expect(code).toMatch(/import\s*\{[^}]*\bstartTipCheckout\b[^}]*\}\s*from\s*"@\/lib\/tipCheckout"/);
        const call = code.match(/startTipCheckout\(\s*\{([^}]*)\}/)?.[1] ?? "";
        expect(call).toMatch(new RegExp(`(^|[\\s,])${v}(\\s*[,}]|\\s*$)|\\bpaypal:\\s*${v}\\b`));
      });
      it("quotes the fee of the processor it will charge", () => {
        const tags = [...code.matchAll(/<TipCostBreakdown\b[^>]*>/g)].map((m) => m[0]);
        expect(tags.length).toBeGreaterThan(0);
        for (const t of tags) expect(t).toMatch(new RegExp(`paypal=\\{${v}\\}`));
      });
    });
  }

  it("TipCostBreakdown quotes PayPal tips from the function paypal-tip charges with", () => {
    const code = read("src/components/TipCostBreakdown.tsx");
    expect(code).toMatch(/import\s*\{[^}]*\bpaypalTipChargeBreakdown\b[^}]*\}\s*from\s*"(\.\.\/)+supabase\/functions\/_shared\/tipFees"/);
    expect(code).toMatch(/paypal\s*\?\s*paypalTipChargeBreakdown\(cents\)\s*:\s*tipChargeBreakdown\(cents\)/);
  });
});

describe("paypal-tip: switch before new money, PayPal's total, and a return that is read", () => {
  const fn = read("supabase/functions/paypal-tip/index.ts");

  it("refuses a member the switch is off for before any new money (order or tip row)", () => {
    const create = fn.indexOf('if (body.action === "create") {');
    const gate = fn.search(/const refused = await requireFeature\(admin, "paypal_payments", user, corsHeaders\);\s*if \(refused\) return refused;/);
    const order = fn.indexOf(".createCheckout(");
    const open = fn.indexOf('rpc("paypal_open_tip"');
    expect(create).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(create);
    expect(order).toBeGreaterThan(gate);
    expect(open).toBeGreaterThan(gate);
  });

  it("captures only the payer's own tip, and a capture is never switch-gated (money already taken)", () => {
    const capture = fn.slice(fn.indexOf('if (body.action === "capture") {'));
    expect(capture.length).toBeGreaterThan(100);
    expect(capture.indexOf("pay.payer_id !== user.id")).toBeGreaterThan(0);
    expect(capture.indexOf("pay.payer_id !== user.id")).toBeLessThan(capture.indexOf("settlePayPalTip("));
    expect(capture.slice(0, capture.indexOf("settlePayPalTip("))).not.toMatch(/requireFeature\(/);
  });

  it("charges paypalTipChargeBreakdown's total and computes no fee of its own", () => {
    const v = fn.match(/const\s+(\w+)\s*=\s*paypalTipChargeBreakdown\(/)?.[1];
    expect(v).toBeTruthy();
    const call = fn.slice(fn.indexOf(".createCheckout("), fn.indexOf(".createCheckout(") + 600);
    expect(call).toMatch(new RegExp(`amountCents:\\s*${v}\\.chargeCents,`));
    expect(fn).toMatch(new RegExp(`p_tip_cents:\\s*${v}\\.tipCents,\\s*p_charge_cents:\\s*${v}\\.chargeCents`));
    expect(fn).not.toMatch(/paypalProcessingCostCents|PAYPAL_RATES|0\.0349/);
  });

  it("returns to /posts with tip=paypal, and that page mounts PayPalTipReturn", () => {
    expect(fn).toMatch(/returnUrl:\s*buildRedirectUrl\(`\/posts\?tip=paypal`/);
    // /posts forwards to the Posted tab of /jobs with its params kept.
    expect(read("src/pages/posts/PostsPage.tsx")).toMatch(/p\.set\("tab", "posted"\);\s*return <Navigate to=\{`\/jobs\?\$\{p\.toString\(\)\}\$\{hash\}`\}/);
    expect(read("src/pages/jobs/JobsSection.tsx")).toMatch(/if \(tab === "posted"\) return <RefundsSwitchProvider><PayPalTipReturn \/>/);
    const ret = read("src/components/PayPalTipReturn.tsx");
    expect(ret).toMatch(/params\.get\("tip"\) === "paypal" \? params\.get\("token"\)/);
    expect(ret).toMatch(/finishPayPalTip\(orderId\)/);
  });
});
