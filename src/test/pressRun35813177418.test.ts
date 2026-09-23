/**
 * press-every-control: the harness rules added for run 35813177418 (126 -> 37
 * failures). Each rule is narrow, and each case here holds the narrowness —
 * the rule fires on the measured shape and NOT on its neighbours.
 *
 *   - portaled overlays count toward "did the DOM change" (Manual Override,
 *     notification row) — tested by executing SNAPSHOT in jsdom
 *   - Radix's hidden form mirror is not a control (/complete-profile checkbox)
 *   - a control that vanished from a self-dismissing status region is a
 *     documented skip, only when missing, only in such a region (PayoutCelebration)
 *   - a designed validation refusal is excused only with its exact copy AND the
 *     remediation overlay opening (admin social "Schedule")
 *   - payment presses are paced from create-payment's own limiter (/post-job 429)
 *   - "Finish Paying" is a payment label (it bypassed every gate)
 *
 * @mutate scripts/audit/press-every-control.mjs | const html = stripStyle((rootEl ? rootEl.innerHTML : "") + overlayHtml); | const html = stripStyle(rootEl ? rootEl.innerHTML : "");
 * @mutate scripts/audit/press-every-control.mjs | return tag === "input" && ariaHidden === "true" && Number(tabIndex) === -1 && pointerEvents === "none"; | return tag === "input";
 * @mutate scripts/audit/press-every-control.mjs | return VALIDATION_REFUSALS.some((v) => v.toast === t && changed === v.requires); | return VALIDATION_REFUSALS.some((v) => v.toast === t);
 * @mutate scripts/audit/pressProdSafety.mjs | export const PAYMENT_RX = /\b(pay\|paying\|checkout | export const PAYMENT_RX = /\b(pay\|checkout
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error - plain .mjs tool script, no types
import * as harness from "../../scripts/audit/press-every-control.mjs";
// @ts-expect-error - plain .mjs tool script, no types
import * as safety from "../../scripts/audit/pressProdSafety.mjs";

const repoRoot = resolve(__dirname, "../..");
type Snap = { hash: number };
const SNAPSHOT = harness.SNAPSHOT as (a: { overlaySel: string }) => Snap;
const OPEN_OVERLAY = harness.OPEN_OVERLAY as string;

describe("press-every-control rules from run 35813177418", () => {
  it("a change that happens only inside a portaled dialog is observable", () => {
    document.body.innerHTML = `<div id="root"><main>page</main></div>
      <div role="dialog" data-state="open"><button>Set to open</button></div>`;
    const before = SNAPSHOT({ overlaySel: OPEN_OVERLAY });
    document.querySelector('[role="dialog"] button')!.textContent = "Set to completed";
    const after = SNAPSHOT({ overlaySel: OPEN_OVERLAY });
    expect(after.hash).not.toBe(before.hash);
    // and an identical re-read is identical (the hash is not just noisy)
    expect(SNAPSHOT({ overlaySel: OPEN_OVERLAY }).hash).toBe(after.hash);
  });

  it("Radix's hidden form mirror is skipped, a visible checkbox is not", () => {
    const mirror = { tag: "input", ariaHidden: "true", tabIndex: -1, pointerEvents: "none" };
    expect(harness.isHiddenFormMirror(mirror)).toBe(true);
    expect(harness.isHiddenFormMirror({ ...mirror, pointerEvents: "auto" })).toBe(false);
    expect(harness.isHiddenFormMirror({ ...mirror, ariaHidden: null })).toBe(false);
    expect(harness.isHiddenFormMirror({ ...mirror, tabIndex: 0 })).toBe(false);
    expect(harness.isHiddenFormMirror({ ...mirror, tag: "button" })).toBe(false);
    expect(harness.DOCUMENTED_SKIPS.has(harness.FORM_MIRROR_SKIP)).toBe(true);
    // The mirror really is Radix's: its bubble input carries exactly these three.
    const radix = readFileSync(resolve(repoRoot, "node_modules/@radix-ui/react-checkbox/dist/index.mjs"), "utf8");
    expect(radix).toMatch(/"aria-hidden": true/);
    expect(radix).toMatch(/tabIndex: -1/);
    expect(radix).toMatch(/pointerEvents: "none"/);
  });

  it("a missing control is excused as transient ONLY when it lived in a live status region on the same screen", () => {
    const d = harness.missingControlDisposition as (a: object) => string | null;
    expect(d({ scope: "page", onSameScreen: true, consumed: false, transient: true })).toBe(harness.TRANSIENT_STATUS_SKIP);
    expect(d({ scope: "page", onSameScreen: true, consumed: false, transient: false })).toBeNull();
    expect(d({ scope: "page", onSameScreen: false, consumed: false, transient: true })).toBe(harness.BOUNCED_SKIP);
    expect(harness.DOCUMENTED_SKIPS.has(harness.TRANSIENT_STATUS_SKIP)).toBe(true);
    // PayoutCelebration is still that shape: a live status card that closes itself.
    const card = readFileSync(resolve(repoRoot, "src/components/wallet/PayoutCelebration.tsx"), "utf8");
    expect(card).toMatch(/role="status"/);
    expect(card).toMatch(/aria-live="polite"/);
    expect(card).toMatch(/setTimeout\(\(\) => setOpen\(false\), AUTO_DISMISS_MS\)/);
  });

  it("a validation refusal is excused only with its exact copy and the fix opening", () => {
    const ok = harness.isDesignedValidationRefusal as (a: { toast: string; changed: string }) => boolean;
    expect((harness.VALIDATION_REFUSALS as unknown[]).length).toBeGreaterThan(0);
    for (const v of harness.VALIDATION_REFUSALS as Array<{ toast: string; source: string; requires: string }>) {
      // anti-vacuity: the copy is still what the app prints
      expect(readFileSync(resolve(repoRoot, v.source), "utf8")).toContain(v.toast);
      expect(ok({ toast: v.toast, changed: v.requires })).toBe(true);
      expect(ok({ toast: v.toast, changed: "" })).toBe(false);
      expect(ok({ toast: v.toast + " ", changed: v.requires })).toBe(true); // trimmed
      expect(ok({ toast: "Couldn't schedule that post.", changed: v.requires })).toBe(false);
    }
  });

  it("payment presses are paced by create-payment's own limiter, read from its source", () => {
    const pace = harness.paymentPaceMs as (src?: string) => number;
    const src = readFileSync(resolve(repoRoot, "supabase/functions/create-payment/index.ts"), "utf8");
    const m = /windowMs:\s*([\d_]+),\s*maxRequests:\s*(\d+),\s*keyPrefix:\s*"create-payment"/.exec(src)!;
    const perPress = Number(m[1].replace(/_/g, "")) / Number(m[2]);
    expect(pace()).toBeGreaterThanOrEqual(perPress);
    expect(pace(src.replace(/maxRequests:\s*10,/, "maxRequests: 5,"))).toBeGreaterThan(pace());
    expect(() => pace("serve(() => {})")).toThrow(/checkRateLimit call not found/);
  });

  it("\"Finish Paying\" is a payment label (run 35813177418 pressed it on SEED drafts ungated)", () => {
    const rx = safety.PAYMENT_RX as RegExp;
    expect(rx.test("Finish Paying “SEED Mow and edge a corner lot” isn’t posted yet")).toBe(true);
    expect(rx.test("Pay now")).toBe(true);
    expect(rx.test("Paypal help article")).toBe(false);
  });
});
