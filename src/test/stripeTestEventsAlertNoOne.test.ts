/**
 * Lead 11-04 (owner rule: test data never reaches the owner): the TEST tax probe (run 41930346999) was processed by
 * stripe-webhook and paged the owner three times (chargeback filed, chargeback LOST $109, "Refund made, but the card
 * holder was not fully told" $40). Now stripe-webhook runs a livemode=false event's handler (and its processing-error
 * alert) inside the TEST-mode scope (supabase/functions/_shared/stripeTestMode.ts): postSlackOpsAlert only logs it as
 * test, and loadAdminIds answers no admins. The handlers themselves run unchanged.
 *
 * @mutate supabase/functions/stripe-webhook/index.ts | await runForStripeMode(event.livemode === false, async () => { await handler(event, ctx); }); | await handler(event, ctx);
 * @mutate supabase/functions/stripe-webhook/index.ts | await runForStripeMode(event?.livemode === false, () => postSlackOpsAlert({ | await runForStripeMode(false, () => postSlackOpsAlert({
 * @mutate supabase/functions/_shared/slack-alerts.ts |     if (inStripeTestMode()) { |     if (false) {
 * @mutate supabase/functions/_shared/adminIds.ts |   if (inStripeTestMode()) { |   if (false) {
 * @mutate supabase/functions/_shared/stripeTestMode.ts |   return typeof read === "function" && (read as () => boolean)() === true; |   return false;
 * @mutate supabase/functions/stripe-webhook/testModeScope.ts | registerStripeTestModeReader(() => scope.getStore() === true); | registerStripeTestModeReader(() => false);
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";
import { inStripeTestMode } from "../../supabase/functions/_shared/stripeTestMode";
import { runForStripeMode } from "../../supabase/functions/stripe-webhook/testModeScope";

const read = (f: string) => blankComments(readFileSync(f, "utf8"));
const body = (src: string, start: string) => {
  const i = src.indexOf(start);
  return i < 0 ? "" : src.slice(i, src.indexOf("\n}\n", i));
};

describe("Stripe TEST-mode events alert and notify no one", () => {
  it("the scope is on only inside a TEST event's run, across awaits, and never leaks to a live one beside it", async () => {
    expect(inStripeTestMode()).toBe(false);
    const seen: boolean[] = [];
    const tick = () => new Promise((r) => setTimeout(r, 5));
    await Promise.all([
      runForStripeMode(true, async () => { await tick(); seen.push(inStripeTestMode()); await tick(); seen.push(inStripeTestMode()); }),
      runForStripeMode(false, async () => { await tick(); seen.push(!inStripeTestMode()); }),
    ]);
    expect(seen).toEqual([true, true, true]);
    expect(inStripeTestMode()).toBe(false);
  });

  it("only stripe-webhook imports node:async_hooks; the shared module every function loads imports nothing", () => {
    expect(read("supabase/functions/_shared/stripeTestMode.ts")).not.toMatch(/^\s*import\b/m);
    expect(read("supabase/functions/stripe-webhook/testModeScope.ts")).toContain('import { AsyncLocalStorage } from "node:async_hooks";');
    expect(read("supabase/functions/stripe-webhook/index.ts")).toContain('import { runForStripeMode } from "./testModeScope.ts";');
  });

  it("stripe-webhook runs the handler and its processing-error alert in the scope, keyed on livemode === false", () => {
    const idx = read("supabase/functions/stripe-webhook/index.ts");
    expect(idx).toContain("await runForStripeMode(event.livemode === false, async () => { await handler(event, ctx); });");
    expect(idx).toContain("await runForStripeMode(event?.livemode === false, () => postSlackOpsAlert({");
    expect(idx).not.toMatch(/\n\s*await handler\(event, ctx\);/);
  });

  it("postSlackOpsAlert logs a TEST-mode alert first, before seed rows, the ledger or Slack", () => {
    const fn = body(read("supabase/functions/_shared/slack-alerts.ts"), "export async function postSlackOpsAlert(");
    expect(fn.length).toBeGreaterThan(2000);
    const test = fn.indexOf("if (inStripeTestMode()) {");
    expect(test).toBeGreaterThan(0);
    for (const later of ["if (input.seed)", "recordOpsAlertLedger(", "recordAlertRow("]) {
      expect(fn.indexOf(later), later).toBeGreaterThan(test);
    }
    expect(fn.slice(test, test + 300)).toMatch(/console\.log\([^\n]*ops_alert_stripe_test_mode[^\n]*\)\s*return true/);
  });

  it("loadAdminIds answers no admins in the scope, before it reads user_roles", () => {
    const fn = body(read("supabase/functions/_shared/adminIds.ts"), "export async function loadAdminIds(");
    const test = fn.indexOf("if (inStripeTestMode()) {");
    expect(test).toBeGreaterThan(0);
    expect(fn.indexOf('.from("user_roles")')).toBeGreaterThan(test);
    expect(fn.slice(test, test + 300)).toMatch(/console\.log\([^\n]*admin_notice_stripe_test_mode[^\n]*\);\s*return \{ ok: true, ids: \[\] \};/);
  });
});
