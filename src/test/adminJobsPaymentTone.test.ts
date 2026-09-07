import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PAYMENT_TONE, paymentColors } from "@/components/admin/adminJobs/types";
import { toneBadgeClasses } from "@/components/admin/tones";

/**
 * The admin money badge must have a tone for every payment_status the DATABASE
 * will accept — not for every one somebody remembered to add to the map.
 *
 * This is deliberately NOT `expect(Object.keys(PAYMENT_TONE)).toEqual([...])`
 * with a hand-written list. That shape is a registry checked against itself: it
 * passes for a missing member, because the thing under test is also the thing
 * defining correctness. The expectation here is PARSED OUT OF THE MIGRATION
 * that last defined `jobs_payment_status_check`, so adding a value in SQL and
 * forgetting the map is a red test rather than an uncoloured pill in prod.
 *
 * Found 2026-09-06: the constraint admitted 10 values and the map defined 5.
 * `paymentColors[...] || ""` meant cancelled / abandoned / failed / chargeback /
 * cancelling rendered with no background and no foreground colour at all.
 */

const MIGRATIONS = join(__dirname, "../../supabase/migrations");

/** The value list from the LAST migration that defines the constraint. */
function paymentStatusesFromMigrations(): string[] {
  const defining = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) =>
      /ADD\s+CONSTRAINT\s+jobs_payment_status_check/i.test(
        readFileSync(join(MIGRATIONS, f), "utf8"),
      ),
    );

  expect(
    defining.length,
    "no migration defines jobs_payment_status_check — this test has lost its source of truth",
  ).toBeGreaterThan(0);

  const sql = readFileSync(join(MIGRATIONS, defining[defining.length - 1]), "utf8");
  const body = sql
    .slice(sql.search(/ADD\s+CONSTRAINT\s+jobs_payment_status_check/i))
    .match(/ARRAY\s*\[([\s\S]*?)\]/i);

  expect(body, "could not parse the ARRAY[...] value list out of the constraint").toBeTruthy();

  const values = [...body![1].matchAll(/'([a-z_]+)'/gi)].map((m) => m[1]);
  expect(values.length, "parsed an empty value list").toBeGreaterThan(1);
  return values;
}

describe("admin jobs payment-status tone map", () => {
  const statuses = paymentStatusesFromMigrations();

  it("parses the real constraint (guards the parser itself)", () => {
    // If the parser silently matched nothing useful, every other assertion
    // below would pass vacuously. Anchor on two values that have existed since
    // the constraint was introduced.
    expect(statuses).toContain("unpaid");
    expect(statuses).toContain("escrow");
  });

  it.each(statuses.map((s) => [s]))(
    "gives payment_status %s a tone",
    (status) => {
      expect(
        PAYMENT_TONE[status],
        `payment_status '${status}' is accepted by jobs_payment_status_check but has no entry in PAYMENT_TONE, so its admin badge renders with no colour`,
      ).toBeDefined();
    },
  );

  it("resolves every status to real, non-empty badge classes", () => {
    for (const status of statuses) {
      const classes = paymentColors[status];
      expect(classes, `paymentColors['${status}'] is empty`).toBeTruthy();
      expect(Object.values(toneBadgeClasses)).toContain(classes);
    }
  });

  it("maps no status the database would reject", () => {
    // The other direction: a tone for a value the CHECK does not admit is dead
    // vocabulary, and usually a typo of a real one.
    for (const status of Object.keys(PAYMENT_TONE)) {
      expect(
        statuses,
        `PAYMENT_TONE has '${status}', which jobs_payment_status_check does not admit`,
      ).toContain(status);
    }
  });
});
