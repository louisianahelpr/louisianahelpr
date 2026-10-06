/**
 * Q781 (owner, 2026-09-27): tips are final. No code path refunds a tip; a manual
 * Dashboard refund follows docs/runbooks/admin-refunds.md (reverse_transfer and
 * refund_application_fee both true).
 *
 * Class guarded: a refund path that can reach a tip's PaymentIntent. Tips are their
 * own PaymentIntents (metadata type "tip") recorded in the `tips` table, so:
 *   1. every edge file that calls `stripe.refunds.create` (inventory from source) never
 *      reads the `tips` table (create-payment's own tip branch is cut out first; part 2
 *      checks it has no refund);
 *   2. the two tip chargers (create-payment's action "tip" branch, auto-tip-charge)
 *      issue no refund;
 *   3. the admin runbook states the rule with both Dashboard flags.
 *
 * @mutate supabase/functions/stripe-webhook/handlers/settleOnboardingFee.ts | const refund = await stripe.refunds.create( | await supabaseAdmin.from("tips").select("id"); const refund = await stripe.refunds.create(
 * @mutate supabase/functions/auto-tip-charge/index.ts | receipt_email: email, | receipt_email: void (await stripe.refunds.create({ payment_intent: "x" })) ?? email,
 * @mutate docs/runbooks/admin-refunds.md | - `refund_application_fee=true`: | - `refund_application_fee=false`:
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const FNS = join(ROOT, "supabase/functions");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts") && !/\.test\.ts$/.test(p)) out.push(p);
  }
  return out;
}

const code = (p: string) => blankComments(readFileSync(p, "utf8"));
const TIP_START = 'if (action === "tip") {';
const TIP_END = 'if (action === "recurring_visit") {';
/** A file's code minus create-payment's tip branch (checked on its own below). */
function outsideTipBranch(src: string): string {
  const a = src.indexOf(TIP_START);
  const b = src.indexOf(TIP_END);
  return a >= 0 && b > a ? src.slice(0, a) + src.slice(b) : src;
}
const refunders = walk(FNS).filter((p) => /stripe\.refunds\.create\s*\(/.test(code(p)));

describe("tips are final", () => {
  it("finds the refund paths (the inventory is not empty)", () => {
    // 8 (2026-10-06): stripe-webhook/handlers/refundDuplicateFunding.ts (Q1419) refunds a
    // job-funding checkout that landed on an already-funded job; the escrow block that calls
    // it excludes tip sessions (sessionType "tip"), so it cannot reach a tip.
    expect(refunders.length, "a new refund path: check it cannot reach a tip, then raise this").toBe(8);
  });

  it("no refund path reads the tips table", () => {
    const bad = refunders.filter((p) => /\.from\(\s*["']tips["']\s*\)/.test(outsideTipBranch(code(p)))).map((p) => relative(ROOT, p));
    expect(bad).toEqual([]);
  });

  it("the tip chargers issue no refund", () => {
    const auto = code(join(FNS, "auto-tip-charge/index.ts"));
    expect(auto).toMatch(/type:\s*"tip"/);
    expect(auto).not.toMatch(/refunds\.create/);

    const cp = code(join(FNS, "create-payment/index.ts"));
    const start = cp.indexOf(TIP_START);
    const end = cp.indexOf(TIP_END);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const tipBranch = cp.slice(start, end);
    expect(tipBranch).toMatch(/type:\s*"tip"/);
    expect(tipBranch).not.toMatch(/refunds\.create/);
  });

  it("the admin runbook states the rule with both Dashboard flags", () => {
    const rb = readFileSync(join(ROOT, "docs/runbooks/admin-refunds.md"), "utf8");
    expect(rb).toMatch(/Tips are final/);
    expect(rb).toMatch(/`reverse_transfer=true`/);
    expect(rb).toMatch(/`refund_application_fee=true`/);
  });
});
