import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, it, expect } from "vitest";

import { earlyAccessDelayMs } from "./earlyAccess";
import { TIER_PERKS, type SubscriptionTier } from "./subscriptionTiers";

/**
 * The early-access delay exists in TWO places: this module (the client
 * pre-filters) and `public.early_access_cutoff()` in SQL (THE enforcement
 * point — all three browse surfaces compare against it, and the perk is paid
 * for, so the client's copy is advisory).
 *
 * They must agree exactly. If the SQL is stricter, rows vanish from a surface
 * the client thought it had earned; if it's looser, the perk leaks. That
 * inconsistency is the exact class of bug migration 20260720120000 was written
 * to fix, so it is worth a guard rather than a comment.
 */
/**
 * The migration that currently DEFINES the cutoff — the newest file containing
 * `CREATE OR REPLACE FUNCTION public.early_access_cutoff()`.
 *
 * This used to be a hardcoded path. That is a trap twice over: migrations are
 * append-only, so a later redefinition is the live one and a pinned path grades
 * a body Postgres has already replaced; and the pin silently survives the very
 * change it should catch. It did exactly that on 2026-09-05, when the Plus
 * branch was added to the function and this test kept reading the 2026-09-01
 * file and passing.
 */
const SQL = (() => {
  const dir = resolve(__dirname, "../../supabase/migrations");
  const file = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) =>
      readFileSync(resolve(dir, f), "utf8").includes(
        "CREATE OR REPLACE FUNCTION public.early_access_cutoff()",
      ),
    )
    .sort()
    .pop();
  if (!file) throw new Error("No migration defines early_access_cutoff()");
  return readFileSync(resolve(dir, file), "utf8");
})();

/**
 * The executable body of `early_access_cutoff()`, prose headers excluded. The
 * migration's header explains at length WHY the retired `business` tier and
 * the old NULL-expiry reading are gone, so grading the whole file would fail
 * on the explanation rather than on any live SQL.
 */
const CUTOFF_BODY = (() => {
  const start = SQL.indexOf("CREATE OR REPLACE FUNCTION public.early_access_cutoff()");
  if (start === -1) throw new Error("early_access_cutoff() is missing from the migration");
  const end = SQL.indexOf("$function$;", start);
  if (end === -1) throw new Error("early_access_cutoff() has no closing $function$;");
  return SQL.slice(start, end);
})();

/** Every surface that must sit behind the shared cutoff, and its object name. */
const GATED_SURFACES: Array<[string, string]> = [
  ["/jobs", "public.get_ranked_open_jobs"],
  ["dashboard list", "public.open_jobs_browse"],
  ["map", "public.get_open_jobs_for_map"],
];

/** Minutes each tier shaves off the 20-minute base, as the SQL declares them. */
function sqlEarnedMinutes(): Record<string, number> {
  const earned: Record<string, number> = {};
  // DERIVED from TIER_PERKS, not hand-listed. The literal
  // ["elite","pro","basic"] could not fail for a tier it never had, so when
  // Plus was restored this loop simply never checked it — the perk was missing
  // server-side and the guard reported agreement.
  const paidTiers = (Object.keys(TIER_PERKS) as SubscriptionTier[]).filter(
    (t) => t !== "free" && TIER_PERKS[t].earlyAccess,
  );
  for (const tier of paidTiers) {
    const m = CUTOFF_BODY.match(
      new RegExp(`WHEN p\\.subscription_tier = '${tier}'\\s+THEN (\\d+)`),
    );
    expect(m, `${tier} branch missing from early_access_cutoff()`).not.toBeNull();
    earned[tier] = Number(m![1]);
  }
  return earned;
}

describe("early-access delay — client/SQL parity", () => {
  it("uses the same 20-minute base on both sides", () => {
    expect(earlyAccessDelayMs(null)).toBe(20 * 60 * 1000);
    expect(CUTOFF_BODY).toContain("make_interval(mins => 20 -");
  });

  it("shaves the same minutes off per tier", () => {
    const earned = sqlEarnedMinutes();
    for (const [tier, minutes] of Object.entries(earned)) {
      expect(earlyAccessDelayMs(tier), `tier "${tier}" disagrees`).toBe((20 - minutes) * 60 * 1000);
    }
  });

  it("treats an unknown or absent tier as free on both sides", () => {
    expect(earlyAccessDelayMs("gold-plated")).toBe(20 * 60 * 1000);
    expect(earlyAccessDelayMs(undefined)).toBe(20 * 60 * 1000);
    // The COALESCE covers "no profile row at all" — which is every anonymous
    // caller, and therefore both guest surfaces. ELSE 0 covers a row whose
    // tier is off the ladder. Unknown must never earn minutes.
    expect(CUTOFF_BODY).toContain("ELSE 0");
    expect(CUTOFF_BODY).toMatch(/COALESCE\(/);
  });

  it("grants the retired 'business' tier NOTHING, on both sides", () => {
    // `business` shared Elite's 20-minute branch until 2026-09-01. Nothing can
    // sell or store that tier (see subscriptionTiers.ts) and the prod census
    // was zero rows, so it now falls to ELSE 0 and waits the full 20 minutes —
    // the safe direction: an unrecognised tier loses a perk, never gains one.
    expect(earlyAccessDelayMs("business")).toBe(20 * 60 * 1000);
    // Grade the SQL LITERAL, not the word: the body carries a comment naming
    // the retired tier so the next reader knows its absence is deliberate
    // rather than an oversight. A `'business'` in quotes is a live branch.
    expect(CUTOFF_BODY.slice(CUTOFF_BODY.indexOf("AS $function$"))).not.toMatch(/'business'/);
  });

  it("lapses a paid tier on a stamped PAST date only — never on a NULL expiry", () => {
    // The convention, shared with tierFeePercent / feePercentForTier /
    // resolveEarlyAccessTier: expire-subscriptions nulls the TIER on lapse, so
    // a NULL expiry is an ACTIVE grant and only a stamped past date is expired.
    //
    // get_open_jobs_for_map read this backwards until 20260901022522 — it
    // lapsed anyone whose expiry was NULL — and the old assertion here could
    // not tell, because it only checked the file contained the substring
    // "subscription_expires_at <= now()", which was true of BOTH readings.
    // Grade the guard clause instead.
    expect(CUTOFF_BODY).toMatch(
      /WHEN p\.subscription_expires_at IS NOT NULL\s*\n?\s*AND p\.subscription_expires_at <= now\(\) THEN 0/,
    );
    expect(CUTOFF_BODY).not.toMatch(/subscription_expires_at IS NULL OR/);
  });

  it("puts ALL THREE browse surfaces behind the one cutoff", () => {
    // The defect this migration fixed was not a wrong number, it was a missing
    // gate: /jobs had none and the dashboard's lived in JavaScript. If a later
    // migration redefines one of these without the predicate, the perk leaks
    // again on that surface alone — silently, because the other two still work.
    // Each surface is graded against ITS OWN newest defining migration, not
    // against whichever file happens to define the cutoff. Those were the same
    // file while one migration created all four objects; they stopped being the
    // same the moment early_access_cutoff() could be changed on its own (which
    // is the point of having hoisted it). Demanding they stay co-located would
    // force every future cutoff tweak to pointlessly re-emit three unrelated
    // objects — and the invariant that actually matters is unchanged: whatever
    // defines a surface last must still compare against the shared cutoff.
    const dir = resolve(__dirname, "../../supabase/migrations");
    const migrations = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const [surface, object] of GATED_SURFACES) {
      const re = new RegExp(`CREATE OR REPLACE (?:FUNCTION|VIEW) ${object.replace(".", "\\.")}\\b`);
      const owner = [...migrations]
        .reverse()
        .find((f) => re.test(readFileSync(resolve(dir, f), "utf8")));
      expect(owner, `${surface} (${object}) is not defined by any migration`).toBeTruthy();
      const ownerSql = readFileSync(resolve(dir, owner!), "utf8");
      const start = ownerSql.search(re);
      const nextSection = ownerSql.indexOf("\n-- ═", start);
      const body = ownerSql.slice(start, nextSection === -1 ? undefined : nextSection);
      expect(
        /early_access_cutoff\(\)|cutoff\.ts\b/.test(body),
        `${surface} (${object}) does not compare against early_access_cutoff()`,
      ).toBe(true);
    }
  });

  it("keeps the client honest that it is NOT the gate", () => {
    // A future edit that "moves the cutoff back into the client for speed"
    // reintroduces the exact defect. The comment is load-bearing.
    const hook = readFileSync(resolve(__dirname, "../hooks/useDashboardData.ts"), "utf8");
    expect(hook).toContain("THIS IS NO LONGER THE GATE");
    expect(hook).toContain("early_access_cutoff()");
  });
});
