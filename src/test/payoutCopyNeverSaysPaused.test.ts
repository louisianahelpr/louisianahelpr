/**
 * Q2442 (owner 2026-10-25: no "paused" wording about payouts; lh-money-escrow
 * review of the live gate, 2026-10-26). cash-out-credits and instant-payout
 * told a held member "Payouts on your account are paused while we review it."
 *
 * CLASS, from the edge functions' own inventory: every refusal that answers
 * code PAYOUT_HELD_CODE (a payout hold) words its `error` without "paused";
 * a named message constant is resolved from _shared/payoutHold.ts. Comments
 * are blanked first (shared blankComments).
 *
 * Out of scope on purpose: "Payout setup is paused while our payment provider
 * reviews our account" (the payout-setup pause notice, a different feature)
 * and admin-only Stripe automatic-payout copy.
 */
// @mutate supabase/functions/cash-out-credits/index.ts | "Your payouts are on hold while we review your account. Your credits are safe. | "Payouts on your account are paused while we review it. Your credits are safe.
// @mutate supabase/functions/instant-payout/index.ts | "Your payouts are on hold while we review your account. Contact | "Payouts on your account are paused while we review it. Contact
// @mutate supabase/functions/_shared/payoutHold.ts | export const IDENTITY_HOLD_MESSAGE = "Verify your ID once | export const IDENTITY_HOLD_MESSAGE = "Payouts paused. Verify your ID once
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const read = (f: string) => blankComments(readFileSync(join(ROOT, f), "utf8"));
const edgeFiles = (readdirSync(join(ROOT, "supabase/functions"), { recursive: true }) as string[])
  .map((f) => `supabase/functions/${f.split("\\").join("/")}`)
  .filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes("/node_modules/"));

const shared = read("supabase/functions/_shared/payoutHold.ts");
const constant = (name: string) => shared.match(new RegExp(`export const ${name} = (["'\`])((?:\\\\.|(?!\\1)[^\\\\])*)\\1`))?.[2] ?? null;

/** Every PAYOUT_HELD_CODE refusal: the `error` it answers with (a literal, or a resolved constant). */
function heldRefusals(): Array<{ where: string; error: string | null }> {
  const out: Array<{ where: string; error: string | null }> = [];
  for (const f of edgeFiles) {
    const src = read(f);
    for (const m of src.matchAll(/code:\s*PAYOUT_HELD_CODE/g)) {
      const before = src.slice(Math.max(0, m.index! - 400), m.index);
      const errs = [...before.matchAll(/error:\s*(?:(["'`])((?:\\.|(?!\1)[^\\])*)\1|([A-Z_]+))/g)];
      const last = errs[errs.length - 1];
      out.push({ where: `${f}@${m.index}`, error: last ? (last[2] ?? constant(last[3])) : null });
    }
  }
  return out;
}

describe("payout-hold refusals never say 'paused' (owner 2026-10-25)", () => {
  const refusals = heldRefusals();

  it("inventories the refusals (floor)", () => {
    expect(edgeFiles.length).toBeGreaterThan(200);
    expect(refusals.length).toBeGreaterThan(10);
  });

  it("every refusal has readable wording", () => {
    expect(refusals.filter((r) => r.error === null).map((r) => r.where)).toEqual([]);
  });

  it("no refusal says payouts are paused", () => {
    expect(refusals.filter((r) => /paused/i.test(r.error ?? "")).map((r) => `${r.where}: ${r.error}`)).toEqual([]);
  });

  it("the held member is told what happens instead", () => {
    for (const f of ["supabase/functions/cash-out-credits/index.ts", "supabase/functions/instant-payout/index.ts"]) {
      expect(read(f), f).toContain("Your payouts are on hold while we review your account.");
    }
  });
});
