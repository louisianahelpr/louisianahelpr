/*
 * GUARD (lh-money-escrow final review of Q454, 2026-10-03, must-fix 2): when an
 * admin refund refunds the card but cannot give the poster's gift card back,
 * create-payment answers { giftRestoreFailed: true } (and pages ops). Every
 * screen that calls those refunds must read the flag and tell the admin who
 * pressed the button; before this, both screens showed a plain success.
 */
// @mutate src/components/admin/AdminDisputes.tsx |         warnIfGiftNotReturned(data); |         void data;
// @mutate src/components/admin/AdminJobs.tsx |       warnIfGiftNotReturned(data); |       void data;
// @mutate src/components/admin/giftRestoreWarning.ts |   if ((data as { giftRestoreFailed?: boolean } \| null)?.giftRestoreFailed) { |   if (false) {
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, relative } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");
const ACTIONS = /action:\s*"(admin_refund_dispute|admin_refund_general)"/;

function callers(): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("test/"))
    .filter((f) => ACTIONS.test(blankComments(readFileSync(join(SRC, f), "utf8"))))
    .map((f) => relative(ROOT, join(SRC, f)));
}

describe("an admin refund that could not return the gift card says so on screen (Q454)", () => {
  it("the server still answers the flag", () => {
    const fn = readFileSync(join(ROOT, "supabase/functions/create-payment/index.ts"), "utf8");
    expect((fn.match(/giftRestoreFailed: true/g) ?? []).length).toBe(2);
  });

  it("every screen that calls admin_refund_dispute or admin_refund_general reads giftRestoreFailed", () => {
    const found = callers();
    expect(found.length).toBeGreaterThanOrEqual(2);
    for (const f of found) {
      expect(blankComments(readFileSync(join(ROOT, f), "utf8")), f).toMatch(/\bwarnIfGiftNotReturned\(data\);/);
    }
  });

  it("the shared warning fires on the flag, and only on it", async () => {
    const { toast } = await import("sonner");
    const spy = vi.spyOn(toast, "warning").mockImplementation(() => "id");
    const { warnIfGiftNotReturned } = await import("@/components/admin/giftRestoreWarning");
    warnIfGiftNotReturned({ success: true });
    warnIfGiftNotReturned(null);
    expect(spy).not.toHaveBeenCalled();
    warnIfGiftNotReturned({ success: true, giftRestoreFailed: true });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toMatch(/gift card was not returned/);
  });
});
