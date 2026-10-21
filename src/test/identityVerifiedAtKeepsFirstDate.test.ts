/**
 * profiles.stripe_identity_verified_at is the day a member was FIRST verified
 * (Stripe's ID check at payout setup), not the last time a sync looked
 * (2026-10-21, measured on prod: two members who set up payouts and were
 * verified on 10-09 read 10-15 and 10-16, because every Connect sync and every
 * verified account.updated delivery restamped "now"). Both writers now stamp
 * only on the transition INTO verified.
 *
 * Class: every write of stripe_identity_verified_at in supabase/functions is
 * conditioned on the row not already being verified.
 *
 * @mutate supabase/functions/_shared/connectGateSync.ts | ...(stripeIdentityVerified(account) && profile.stripe_identity_verified !== true | ...(stripeIdentityVerified(account)
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | ...(identityVerified && helperProfile.stripe_identity_verified !== true ? | ...(identityVerified ?
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

describe("stripe_identity_verified_at keeps the first date", () => {
  it("every writer stamps it only when the row was not verified before", () => {
    const files = execFileSync("git", ["grep", "-l", "stripe_identity_verified_at:", "--", "supabase/functions"], { encoding: "utf8" })
      .split("\n").filter((f) => f && !/\.test\./.test(f));
    expect(files.sort()).toEqual(["supabase/functions/_shared/connectGateSync.ts", "supabase/functions/stripe-webhook/handlers/accountUpdated.ts"]);
    const stamps: string[] = [];
    for (const f of files) {
      const src = blankComments(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/stripe_identity_verified_at:/g)) {
        stamps.push(f);
        const before = src.slice(Math.max(0, m.index! - 200), m.index!);
        expect(before, f).toMatch(/stripe_identity_verified !== true\s*\?\s*\{?\s*$/);
      }
    }
    // Floor: 2 stamps of the column checked on 2026-10-21.
    expect(stamps.length).toBeGreaterThan(1);
  });
});
