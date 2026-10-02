/**
 * NOT "the world is currently clean". Prod today is six accounts, no strikes,
 * all active — a check that only read prod would be green for that reason and
 * for no other. Every case here is a FIXTURE fed to the script's own pure
 * `findStrikes`, so the dirty cases fail on demand without anyone striking,
 * banning or restricting a real account.
 *
 * COVERAGE LIMIT, on the record: this proves the DECISION, not the fetch. The
 * three service-role reads in `main()` — their table names, their `in.(…)`
 * email filter, the `is_active` predicate — are not exercised by any test, so a
 * query that silently returned zero rows would run green here and green
 * nightly.
 *
 * @mutate scripts/check-test-account-strikes.mjs | if (s.length \|\| v.length \|\| status !== "active") { | if (false) {
 * @mutate scripts/check-test-account-strikes.mjs |   "helpr-e2e-helper-0902@mailinator.com",\n |
 * @mutate scripts/check-test-account-strikes.mjs | else if (live.user_id !== a.userId) | else if (false)
 * @mutate scripts/check-test-account-strikes.mjs | if (!live) drift.push | if (false) drift.push
 * @mutate scripts/check-test-account-strikes.mjs |   if (problems.length === 0 && drift.length === 0) { |   if (problems.length === 0) {
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - plain .mjs tool script, no types
import { findStrikes, findPinnedIdDrift, SHARED_TEST_ACCOUNTS } from "../../scripts/check-test-account-strikes.mjs";
// @ts-expect-error - plain .mjs tool script, no types
import { ACCOUNTS } from "../../scripts/test-signin-link.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Problem = { email: string; ban_status: string; strikes: unknown[]; violations: unknown[] };
const find = findStrikes as (p: unknown[], s: unknown[], v: unknown[]) => Problem[];

const poster = { user_id: "u-poster", email: "helpr-e2e-poster-0902@mailinator.com", ban_status: "active" };
const helper = { user_id: "u-helper", email: "helpr-e2e-helper-0902@mailinator.com", ban_status: null };

describe("check-test-account-strikes", () => {
  it("covers the journey poster and helper", () => {
    expect(SHARED_TEST_ACCOUNTS).toContain(poster.email);
    expect(SHARED_TEST_ACCOUNTS).toContain(helper.email);
  });

  it("clean accounts pass", () => {
    expect(find([poster, helper], [], [])).toEqual([]);
  });

  // The 2026-09-13 state on prod: one off_platform warning + final_warning.
  it("fails on a leftover violation and the final_warning it caused", () => {
    const out = find([{ ...poster, ban_status: "final_warning" }, helper], [], [{ id: "v1", user_id: "u-poster" }]);
    expect(out).toHaveLength(1);
    expect(out[0].email).toBe(poster.email);
    expect(out[0].ban_status).toBe("final_warning");
  });

  it("fails on a cancellation strike alone", () => {
    expect(find([poster, helper], [{ id: "s1", user_id: "u-helper" }], [])).toHaveLength(1);
  });

  it("fails on a restricted status with no rows left", () => {
    expect(find([{ ...helper, ban_status: "temp_banned" }], [], [])).toHaveLength(1);
  });

  // Q905: the `helper` pin pointed at an auth id deleted on re-creation.
  describe("pinned test-account ids (Q905)", () => {
    type Drift = { role: string; pinned: string; live: string | null };
    const drift = findPinnedIdDrift as (a: unknown, p: unknown[]) => Drift[];
    const accounts = {
      helper: { email: "eli.test.helper@louisianahelpr.com", userId: "old-id" },
      seeded: { email: "helpr-seed-admin-0912@louisianahelpr.com", userId: null },
    };

    it("passes when every pinned id matches the live account", () => {
      expect(drift(accounts, [{ email: "eli.test.helper@louisianahelpr.com", user_id: "old-id" }])).toEqual([]);
    });

    it("fails the 2026-10-01 state: the email is live under a NEW id", () => {
      const out = drift(accounts, [{ email: "Eli.Test.Helper@louisianahelpr.com", user_id: "new-id" }]);
      expect(out).toEqual([{ role: "helper", email: "eli.test.helper@louisianahelpr.com", pinned: "old-id", live: "new-id" }]);
    });

    it("fails when a pinned account is gone entirely", () => {
      expect(drift(accounts, [])).toHaveLength(1);
      expect(drift(accounts, [])[0].live).toBeNull();
    });

    it("every pinned account is one the nightly read fetches", () => {
      const pinned = Object.values(ACCOUNTS as Record<string, { email: string; userId: string | null }>).filter((a) => a.userId);
      // Floor: four ids are pinned today (poster, helper, poster-e2e, helper-e2e).
      expect(pinned.length).toBeGreaterThanOrEqual(4);
      for (const a of pinned) expect(SHARED_TEST_ACCOUNTS).toContain(a.email);
    });

    it("a drift fails the run even when no account has a strike", () => {
      const src = readFileSync(resolve(__dirname, "../../scripts/check-test-account-strikes.mjs"), "utf8");
      expect(src).toMatch(/findPinnedIdDrift\(ACCOUNTS, profiles\)/);
      expect(src).toMatch(/if \(problems\.length === 0 && drift\.length === 0\) \{/);
    });
  });
});
