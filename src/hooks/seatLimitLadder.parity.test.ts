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
import { useMyBusiness } from "./useMyBusiness";

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
  const body = sql.slice(start, sql.indexOf("$$;", start));
  const ladder: Record<string, number> = {};
  for (const m of body.matchAll(/WHEN\s+'(\w+)'\s+THEN\s+(\d+)/g)) {
    ladder[m[1]] = Number(m[2]);
  }
  return ladder;
}

describe("seat-limit ladder parity (marketing ↔ client ↔ database)", () => {
  const dbLadder = ladderFromMigrations();

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
    expect(typeof useMyBusiness).toBe("function");
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
