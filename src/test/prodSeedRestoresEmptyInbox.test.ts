/**
 * THE "EMPTY INBOX" FIXTURE IS PUT BACK BY EVERY SEED RUN.
 *
 * e2e/prod-audit/activity-tabs-visible.spec.ts drives its EMPTY-inbox tests
 * with the `admin` seed account. prod-audit 38689259675 (2026-10-15) failed 8
 * of them at 4 widths: the account carried a thread. Measured 2026-10-17: two
 * rows from a hand-run Q1590 live check (2026-10-12 14:37Z, "will be deleted")
 * were never deleted. Anything can message a shared account, so the fixture's
 * state is owned by the seed that runs before every leg, not by the hope that
 * each writer cleans up.
 *
 * @mutate scripts/audit/prod-seed.mjs |   await restoreEmptyInbox(ids.admin); |   void restoreEmptyInbox;
 * @mutate scripts/audit/prod-seed.mjs |   if (foreign.length) { |   if (false) {
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const SEED = blankComments(readFileSync(resolve(ROOT, "scripts/audit/prod-seed.mjs"), "utf8"));
const SPEC = blankComments(readFileSync(resolve(ROOT, "e2e/prod-audit/activity-tabs-visible.spec.ts"), "utf8"));

describe("prod-seed restores the admin seed account's empty inbox", () => {
  it("the spec's empty inbox is still the admin account (what the seed restores)", () => {
    expect(SPEC).toMatch(/emptyInbox = await sessionFor\(request, "admin"\);/);
    expect(SEED).toMatch(/admin: \{ email: "helpr-seed-admin-0912@louisianahelpr\.com"/);
  });

  it("apply() empties it after the accounts exist", () => {
    const apply = SEED.slice(SEED.indexOf("async function apply()"));
    const enrol = apply.indexOf("await enrolTestAccounts(");
    const restore = apply.indexOf("await restoreEmptyInbox(ids.admin);");
    expect(enrol).toBeGreaterThan(0);
    expect(restore).toBeGreaterThan(enrol);
  });

  it("it removes every message the account is party to, but never a real person's", () => {
    const fn = SEED.slice(SEED.indexOf("async function restoreEmptyInbox("), SEED.indexOf("async function apply()"));
    expect(fn).toMatch(/messages\?or=\(sender_id\.eq\.\$\{adminId\},receiver_id\.eq\.\$\{adminId\},team_thread_user_id\.eq\.\$\{adminId\}\)/);
    expect(fn).toMatch(/is_seed=is\.true/);
    expect(fn).toMatch(/if \(foreign\.length\) \{\s*throw new Error/);
    expect(fn, "the delete is read back by count").toMatch(/gone\.length !== ids\.length/);
  });
});
