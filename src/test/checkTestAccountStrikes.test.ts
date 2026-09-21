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
 * @mutate scripts/check-test-account-strikes.mjs | if (s.length || v.length || status !== "active") { | if (false) {
 * @mutate scripts/check-test-account-strikes.mjs |   "helpr-e2e-helper-0902@mailinator.com",\n |
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - plain .mjs tool script, no types
import { findStrikes, SHARED_TEST_ACCOUNTS } from "../../scripts/check-test-account-strikes.mjs";

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
});
