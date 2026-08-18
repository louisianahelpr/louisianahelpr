// Seat-limit ladder parity: MARKETING/CHECKOUT <-> CLIENT <-> DATABASE.
//
// WHY THIS EXISTS. The seat ladder was maintained in four places at once and
// nothing checked them against each other, so they silently disagreed for
// months:
//
//   BUSINESS_SEAT_TIERS (marketing + Stripe)  1 / 2 / 3 / 4+
//   SEAT_LIMITS (src/hooks/useMyBusiness.ts)  1 / 2 / 3 / 4
//   enforce_business_member_limit()  trigger  hardcoded 2, tier never read
//   get_business_seat_limit()  /  business_seat_limit()   2/5/10/25, 2/5/10/15
//
// The trigger is the one that BINDS, so Team and Enterprise customers paid for
// seats the database refused to let them use, and the UI answered by telling
// them to upgrade again. `businessSeatTiers.parity.test.ts` guarded client<->edge
// parity but had no opinion about the DB, which is exactly where the drift was.
//
// This test closes that gap by reading the ladder back out of the migration
// that defines it. It resolves the LATEST migration defining
// `business_seat_limit_for_tier`, so it keeps checking the ladder that actually
// ships rather than pinning one historical file — change the ladder in a new
// migration and this test follows it there and demands the client move too.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BUSINESS_SEAT_TIERS } from "@/lib/businessSeatTiers";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const FN = "business_seat_limit_for_tier";

/**
 * Pull `WHEN '<tier>' THEN <n>` out of the newest migration that defines the
 * canonical helper. Deliberately a dumb regex over the SQL text: the point is
 * to read the number a reviewer would read, without a Postgres to ask.
 */
function ladderFromMigrations(): Record<string, number> {
  const defining = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8").includes(`FUNCTION public.${FN}(`))
    .sort(); // timestamp-prefixed, so lexical sort === apply order
  expect(
    defining,
    `no migration defines public.${FN}() — the DB seat ladder has no canonical source`,
  ).not.toHaveLength(0);

  const sql = readFileSync(join(MIGRATIONS_DIR, defining[defining.length - 1]), "utf8");
  // Narrow to that function's body so an unrelated CASE elsewhere in the file
  // cannot feed this test the wrong numbers.
  const start = sql.indexOf(`FUNCTION public.${FN}(`);
  const end = sql.indexOf("$$;", start);
  // `slice(start, -1)` would silently become "rest of the file" and let the
  // regex harvest numbers out of an unrelated CASE — fail open. Refuse.
  expect(end, `could not find the end of ${FN}()'s body`).toBeGreaterThan(start);
  const body = sql.slice(start, end);
  const ladder: Record<string, number> = {};
  for (const m of body.matchAll(/WHEN\s+'(\w+)'\s+THEN\s+(\d+)/g)) {
    ladder[m[1]] = Number(m[2]);
  }
  return ladder;
}

/** Body of the newest migration that (re)defines a given plpgsql function. */
function latestFunctionBody(fnName: string): string {
  const defining = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) =>
      readFileSync(join(MIGRATIONS_DIR, f), "utf8").includes(
        `CREATE OR REPLACE FUNCTION public.${fnName}(`,
      ),
    )
    .sort();
  expect(defining, `no migration defines public.${fnName}()`).not.toHaveLength(0);
  const sql = readFileSync(join(MIGRATIONS_DIR, defining[defining.length - 1]), "utf8");
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fnName}(`);
  const end = sql.indexOf("$$;", start);
  expect(end, `could not find the end of ${fnName}()'s body`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe("seat-limit ladder parity (marketing ↔ client ↔ database)", () => {
  const dbLadder = ladderFromMigrations();

  // Guard the guard: `it.each([])` generates ZERO cases and still reports
  // green when the describe has other tests, so an emptied or renamed
  // BUSINESS_SEAT_TIERS would silently switch the marketing leg off.
  it("the marketing tier array is non-empty (so the it.each below runs)", () => {
    expect(BUSINESS_SEAT_TIERS).toHaveLength(4);
  });

  // The ladder numbers agreeing is not the same as the CAP READING them. This
  // is the assertion that fails if anyone puts `>= 2` back into the trigger.
  it("the seat-cap trigger reads the helper instead of a hardcoded number", () => {
    const body = latestFunctionBody("enforce_business_member_limit");
    expect(body).toContain("business_seat_limit_for_tier(");
    // No bare integer on the right of the cap comparison.
    expect(body).not.toMatch(/>=\s*\d+/);
  });

  it("both seat-limit helper functions delegate to the canonical ladder", () => {
    for (const fn of ["get_business_seat_limit", "business_seat_limit"]) {
      expect(latestFunctionBody(fn), fn).toContain("business_seat_limit_for_tier(");
    }
  });

  it("the database ladder covers exactly the four canonical tiers", () => {
    expect(Object.keys(dbLadder).sort()).toEqual(["crew", "enterprise", "starter", "team"]);
  });

  it.each(BUSINESS_SEAT_TIERS.map((t) => [t.key, t.seats] as const))(
    "%s: the DB trigger allows exactly the %s seat(s) the pricing page sells",
    (key, seats) => {
      // "4+" → 4: the display string is the marketing label, the integer is the
      // enforced cap (see businessTeamHelpers.ts, which parses it the same way).
      expect(dbLadder[key]).toBe(parseInt(seats, 10));
    },
  );

  it("the client SEAT_LIMITS map is the same ladder", async () => {
    // SEAT_LIMITS is module-private, so read it through the public surface the
    // UI actually consumes rather than exporting internals just for a test.
    const src = readFileSync(join(process.cwd(), "src", "hooks", "useMyBusiness.ts"), "utf8");
    const block = src.slice(src.indexOf("const SEAT_LIMITS"), src.indexOf("};", src.indexOf("const SEAT_LIMITS")));
    const clientLadder: Record<string, number> = {};
    for (const m of block.matchAll(/(\w+):\s*(\d+)/g)) clientLadder[m[1]] = Number(m[2]);

    expect(clientLadder).toEqual(dbLadder);
    // Guard the guard: if the regex ever stops matching, an empty object would
    // silently equal an empty object.
    expect(Object.keys(clientLadder)).toHaveLength(4);
  });

  // ---------------------------------------------------------------------
  // The per-business override (migration 20260818150000).
  //
  // Enterprise is SOLD as "4+" but was ENFORCED at exactly 4, so the first
  // six-seat deal would have been refused its fifth invite — the same revenue
  // bug 20260817120000 fixed, moved to the top-paying tier. The fix adds
  // `businesses.extra_seats` on top of the tier base. That creates a NEW way
  // for the numbers to drift, so it gets guarded here too: the ladder above
  // stays pure (tier → base), and every resolver of a SPECIFIC business's cap
  // must add the override exactly ONCE.
  // ---------------------------------------------------------------------
  describe("per-business extra_seats override", () => {
    it("the tier ladder helper stays PURE — the override is not folded into it", () => {
      // If the override leaked in here, `business_seat_limit_for_tier` would
      // need a table read inside an IMMUTABLE function and every assertion
      // above would be measuring the wrong thing.
      const defining = readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".sql"))
        .filter((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8").includes(`FUNCTION public.${FN}(`))
        .sort();
      const sql = readFileSync(join(MIGRATIONS_DIR, defining[defining.length - 1]), "utf8");
      const start = sql.indexOf(`FUNCTION public.${FN}(`);
      const end = sql.indexOf("$$;", start);
      expect(end).toBeGreaterThan(start);
      expect(sql.slice(start, end)).not.toContain("extra_seats");
    });

    it.each(["get_business_seat_limit", "business_seat_limit"])(
      "%s(uuid) returns the EFFECTIVE cap (tier base + extra_seats)",
      (fn) => {
        // These take a business id, so "the seat limit" for them means the
        // enforced number. Returning the tier base while the trigger enforces
        // base+override would be a fifth contradictory ladder.
        expect(latestFunctionBody(fn), fn).toContain("extra_seats");
      },
    );

    it("enforce_business_member_limit adds the override to the tier base", () => {
      const body = latestFunctionBody("enforce_business_member_limit");
      expect(body).toContain("extra_seats");
    });

    it("enforce_business_seat_limit picks the override up exactly ONCE", () => {
      // This trigger delegates to get_business_seat_limit(), which already
      // includes the override — so adding `+ extra_seats` here as well would
      // DOUBLE-COUNT it and hand the business twice the seats it bought.
      // Either it delegates (and stays silent about extra_seats) or it adds
      // the override itself. Never both, never neither.
      const body = latestFunctionBody("enforce_business_seat_limit");
      const delegates = body.includes("get_business_seat_limit(");
      const addsItself = body.includes("extra_seats");
      expect(
        delegates !== addsItself,
        delegates && addsItself
          ? "double-counts extra_seats: it delegates to get_business_seat_limit() AND adds the override itself"
          : "ignores extra_seats: it neither delegates to get_business_seat_limit() nor adds the override",
      ).toBe(true);
    });

    it("the client folds extra_seats into seat_limit, so the UI meter matches the trigger", () => {
      const src = readFileSync(join(process.cwd(), "src", "hooks", "useMyBusiness.ts"), "utf8");
      // The `seat_limit:` in the interface declaration comes first in the
      // file, so match the ASSIGNMENT — the line that computes the number.
      const line = src
        .split("\n")
        .find((l) => l.includes("seat_limit:") && l.includes("SEAT_LIMITS["));
      expect(line, "no `seat_limit:` assignment found in useMyBusiness.ts").toBeTruthy();
      // The tier base alone would under-report an overridden business and the
      // invite gate would block invites the server would accept.
      expect(line).toMatch(/SEAT_LIMITS\[tier\][\s\S]*\+\s*extraSeats/);
    });
  });

  it("every tier counts the OWNER inside its limit, so starter is a solo seat", () => {
    // The owner is a row in business_members and useTeamMembers returns it, so
    // "X of N seats used" already includes them. starter === 1 is the assertion
    // that keeps that convention honest: a free business is the owner alone.
    expect(dbLadder.starter).toBe(1);
    expect(dbLadder.crew).toBe(dbLadder.starter + 1);
    expect(dbLadder.team).toBe(dbLadder.crew + 1);
    expect(dbLadder.enterprise).toBe(dbLadder.team + 1);
  });
});
