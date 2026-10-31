/**
 * LEAD-TOAST2 (lead 10-31): the Declutter handover, problem and refund confirmations ("Handover done. Enjoy your
 * item.", "Sent. Louisiana Helpr reads both sides...", "Refund sent. The buyer is told.") went through toast.success,
 * which renders NOTHING (src/lib/toastPolicy.ts makes success/info/message no-ops unless they carry an action). The tap
 * looked dead. They go through the bare toast(), which always renders.
 *
 * Two checks:
 *  1. Those three screens raise no suppressed toast (source, comments blanked).
 *  2. App-wide, the number of suppressed confirmations in docs/audit/toast-inventory.json (renders:false, generated
 *     from the AST by scripts/toast-inventory.mjs, kept current by check-generated-current) never goes up. Lower
 *     SUPPRESSED_CEILING when you convert more.
 *
 * @mutate src/components/declutter/DeclutterHandoverViews.tsx |       toast("Handover done. Enjoy your item."); |       toast.success("Handover done. Enjoy your item.");
 * @mutate src/components/declutter/DeclutterProblemSides.tsx |       toast("Report taken back. Nothing is held for it now."); |       toast.info("Report taken back. Nothing is held for it now.");
 * @mutate src/components/declutter/DeclutterRefundRequest.tsx |     onSuccess: () => { toast("Refund sent. The buyer is told."); | onSuccess: () => { toast.success("Refund sent. The buyer is told.");
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const FILES = [
  "src/components/declutter/DeclutterHandoverViews.tsx",
  "src/components/declutter/DeclutterProblemSides.tsx",
  "src/components/declutter/DeclutterRefundRequest.tsx",
];
const code = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));

/** Suppressed (renders:false) toasts app-wide on 10-31 after LEAD-TOAST2, SS-2 and LEAD-TOAST3 (81). Never raise it. */
const SUPPRESSED_CEILING = 81;

describe("Declutter handover, problem and refund confirmations are shown", () => {
  it("reads the screens (floor: they raise toasts)", () => {
    expect(FILES.map((f) => code(f).match(/\btoast\(/g)?.length ?? 0).reduce((a, b) => a + b, 0)).toBeGreaterThan(8);
  });

  it.each(FILES)("%s raises no suppressed toast", (f) => {
    expect(code(f).match(/\btoast\.(success|info|message)\(/g) ?? []).toEqual([]);
  });

  it("the app-wide count of suppressed toasts is exactly the recorded one (it only goes down)", () => {
    const inv = JSON.parse(readFileSync(resolve(ROOT, "docs/audit/toast-inventory.json"), "utf8")) as {
      toasts: { file: string; renders: boolean }[];
    };
    expect(inv.toasts.length).toBeGreaterThan(500);
    const suppressed = inv.toasts.filter((t) => t.renders === false);
    expect(suppressed.filter((t) => FILES.includes(t.file))).toEqual([]);
    expect(suppressed.length).toBe(SUPPRESSED_CEILING); // exact: lower it in the commit that converts more
  });
});
