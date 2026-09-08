import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * THE REGISTRY ANTIPATTERN, CAUGHT GENERICALLY.
 *
 * A hand-written list that is both a test's input and its definition of
 * correctness cannot fail for a missing member. That exact shape has shipped
 * real defects here at least nine times — `SEED_GATED_SURFACES` missing
 * `get_public_open_jobs` (fixtures would have kept showing on the landing
 * teaser after the launch flip), `PAYMENT_TONE` covering 5 of 10 payment
 * statuses (five uncoloured pills in the admin money table), a dead agent-name
 * registry, a tier list short one tier. Each was fixed one at a time, and each
 * fix produced a bespoke parity test that derives its expectation from the
 * world: `showSeedJobs.parity.test.ts` reads the migration tree,
 * `adminJobsPaymentTone.test.ts` parses the CHECK constraint,
 * `tierPerks.parity.test.ts` reads the perk matrix, `check-agent-refs.mjs`
 * enumerates the installed agents.
 *
 * What none of them do is stop the TENTH one from being written. This test is
 * the repo-wide net: it derives the true vocabularies from the world and then
 * looks for any NEW hand-written literal that is trying to be one of them.
 *
 * ── WHAT COUNTS AS AN OFFENDER ─────────────────────────────────────────────
 *
 * An array literal or a string-literal union, outside the modules that DEFINE
 * a vocabulary, whose members are all drawn from one vocabulary and which
 * covers the whole vocabulary or all-but-one of it.
 *
 * "All-but-one" is the threshold on purpose, and it is what makes this
 * checkable rather than noisy:
 *   * a list holding 3 of 10 payment statuses is a QUERY FILTER
 *     (`.in("payment_status", ["escrow", "payout_pending"])`) — a legitimate
 *     statement about which states a screen wants, not a registry, and it is
 *     not flagged;
 *   * a list holding 10 of 10 is a list trying to BE the set;
 *   * a list holding 9 of 10 is a registry that has already drifted, which is
 *     the defect itself, not a false positive. Three of those were sitting in
 *     the repo when this guard was written — `statusLabels.test.ts`,
 *     `statusColors.test.ts` and `activityConstants.test.ts` each asserted
 *     they covered "every value in the job_status enum" against a hand-written
 *     seven of the eight. All three now derive from `Constants`.
 *
 * ── HOW TO MAKE IT GREEN ───────────────────────────────────────────────────
 *
 * Derive the list instead of typing it: `Constants.public.Enums.job_status`,
 * `Object.keys(TIER_PERK_MATRIX)`, or the CHECK constraint the way
 * `adminJobsPaymentTone.test.ts` parses it. Adding to LEDGER is the last
 * resort and needs the reason written down.
 */

const ROOT = join(__dirname, "../..");

/* ───────────────────────── the world ─────────────────────────────────────
   Every vocabulary below is READ FROM SOMETHING ELSE. None is typed out here,
   because a guard against hand-written registries that carries a hand-written
   registry is the joke telling itself. */

/** `src/integrations/supabase/types.ts` is generated from the live database. */
function enumFromGeneratedTypes(name: string): string[] {
  const types = readFileSync(join(ROOT, "src/integrations/supabase/types.ts"), "utf8");
  // The `Constants` block at the end of the file emits each enum as a plain
  // array; the `Database` type above emits it as a union. The array is read,
  // because its extent is unambiguous — it ends at the first `]`.
  const at = types.indexOf(`${name}: [`);
  expect(at, `no ${name} enum in the generated types — this guard lost a source of truth`).toBeGreaterThan(-1);
  const values = [...types.slice(at, types.indexOf("]", at)).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  expect(values.length, `parsed an empty ${name} enum`).toBeGreaterThan(1);
  return values;
}

/** The keys of TIER_PERK_MATRIX — the same authority `tierPerks.parity.test.ts` grades against. */
function tiersFromPerkMatrix(): string[] {
  const src = readFileSync(join(ROOT, "supabase/functions/_shared/tierPerks.ts"), "utf8");
  const at = src.indexOf("export const TIER_PERK_MATRIX");
  expect(at, "TIER_PERK_MATRIX is gone — this guard lost a source of truth").toBeGreaterThan(-1);
  const tiers = [...src.slice(at).matchAll(/^ {2}([a-z]+): \{/gm)].map((m) => m[1]);
  expect(tiers.length, "parsed no tiers out of TIER_PERK_MATRIX").toBeGreaterThan(1);
  return tiers;
}

/**
 * The value list of the LAST migration that defines `jobs_payment_status_check`
 * — not the first, which would keep passing forever after being superseded.
 * Same parse as `adminJobsPaymentTone.test.ts`, which is the test that found
 * the five uncoloured pills.
 */
function paymentStatusesFromMigrations(): string[] {
  const dir = join(ROOT, "supabase/migrations");
  const defining = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => /ADD\s+CONSTRAINT\s+jobs_payment_status_check/i.test(readFileSync(join(dir, f), "utf8")));
  expect(defining.length, "no migration defines jobs_payment_status_check").toBeGreaterThan(0);

  const sql = readFileSync(join(dir, defining[defining.length - 1]), "utf8");
  const array = sql
    .slice(sql.search(/ADD\s+CONSTRAINT\s+jobs_payment_status_check/i))
    .match(/ARRAY\s*\[([\s\S]*?)\]/i);
  expect(array, "could not parse the ARRAY[...] out of jobs_payment_status_check").toBeTruthy();
  const values = [...array![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  expect(values.length, "parsed an empty payment_status list").toBeGreaterThan(1);
  return values;
}

const VOCABULARIES: Record<string, string[]> = {
  tier: tiersFromPerkMatrix(),
  job_status: enumFromGeneratedTypes("job_status"),
  application_status: enumFromGeneratedTypes("application_status"),
  payment_status: paymentStatusesFromMigrations(),
};

/**
 * Files that DEFINE a vocabulary. Their literals are the source of truth, not
 * a copy of it, so flagging them would be backwards. This is a permanent
 * exclusion list, not the grandfather ledger below — nothing here is ever
 * expected to change.
 */
const SOURCES_OF_TRUTH = [
  "src/integrations/supabase/types.ts",
  "supabase/functions/_shared/tierPerks.ts",
  "src/test/literalRegistryGuard.test.ts",
];

/**
 * ── THE GRANDFATHER LEDGER ─────────────────────────────────────────────────
 *
 * Every hand-written registry that already existed when this guard landed.
 *
 * IT MAY ONLY EVER GET SMALLER. Adding a row is admitting a new copy of a set
 * the database already knows; if you are about to, derive the list instead.
 *
 * AND IT IS ITSELF GUARDED. The test below fails if a row here no longer
 * matches an offender — because a suppression list that outlives what it
 * suppresses is the same defect one level up: it reads as "known and
 * accepted" while actually protecting nothing, and the next real offender in
 * that file inherits the exemption for free. (`lh-silent-failure` hit exactly
 * that: a stale ignore entry silently covering a live bug.) When a row goes
 * stale, DELETE it.
 *
 * Keyed by file + vocabulary, deliberately not by line: a line number churns
 * on every edit above it, and a ledger nobody can keep accurate is a ledger
 * people disable.
 */
const LEDGER: Array<{ file: string; vocabulary: string; reason: string }> = [
  {
    file: "src/components/admin/AdminSettings.tsx",
    vocabulary: "tier",
    reason:
      "FEE_LADDER types the five tier ids to order the read-only fee table. The VALUES it shows are " +
      "already derived from TIER_PERKS; only the order is hand-held. Deriving from TIER_ORDER would " +
      "close it.",
  },
  {
    file: "src/lib/iap.ts",
    vocabulary: "tier",
    reason:
      "IAP_TIERS is the four PURCHASABLE tiers — deliberately not the whole vocabulary (`free` is not " +
      "bought), which is why it reads as 4-of-5 rather than as drift. src/test/appleIap.test.ts already " +
      "grades it against the Deno-side product-id map.",
  },
  {
    file: "supabase/functions/_shared/appleAppStore.ts",
    vocabulary: "tier",
    reason: "The Deno half of the same purchasable-tier set as src/lib/iap.ts, and parity-tested against it.",
  },
  {
    file: "supabase/functions/_shared/proTiers.ts",
    vocabulary: "tier",
    reason:
      "The paid-tier ladder used to resolve a Stripe price. Paid tiers only, so `free` is correctly " +
      "absent; drift here is caught by the Stripe price parity check instead.",
  },
  {
    file: "supabase/functions/create-pro-checkout/index.ts",
    vocabulary: "tier",
    reason: "Validates the requested tier against the paid set before creating a checkout session.",
  },
  {
    file: "src/lib/helperFees.parity.test.ts",
    vocabulary: "tier",
    reason: "Parity test; iterates the tier ladder to compare two fee tables.",
  },
  {
    file: "src/lib/moneyFigures.parity.test.ts",
    vocabulary: "tier",
    reason: "Parity test; iterates the tier ladder.",
  },
  {
    file: "src/lib/roleFeeParity.test.ts",
    vocabulary: "tier",
    reason: "Parity test; iterates the tier ladder.",
  },
  {
    file: "src/lib/subscriptionTiers.test.ts",
    vocabulary: "tier",
    reason: "Unit test for the tier table itself; the literals are the fixtures under test.",
  },
  {
    file: "src/lib/tierNames.parity.test.ts",
    vocabulary: "tier",
    reason: "Parity test; compares display names across the ladder.",
  },
  {
    file: "src/lib/tierPerks.parity.test.ts",
    vocabulary: "tier",
    reason: "Parity test for the perk matrix; the literals are the expectation being compared to it.",
  },
  {
    file: "src/test/fixtureSchemaContract.test.ts",
    vocabulary: "payment_status",
    reason:
      "Deliberate: this asserts the EXACT live value list so a mis-parse that silently drops entries is " +
      "caught. The literal is the point — it is compared against a value read from the database, not " +
      "used as the definition of the set.",
  },
];

/* ─────────────────────────── the scan ────────────────────────────────────── */

const SCAN_ROOTS = ["src", "supabase/functions"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

type Offender = { file: string; line: number; vocabulary: string; covered: number; of: number };

/**
 * Array literals (`[...]`, no nesting) and string-literal unions
 * (`"a" | "b" | …`). Both are how a set gets typed out by hand here; both are
 * bounded enough to match with a regex without dragging in a TypeScript parser
 * for a guard that has to stay fast.
 */
const LITERAL_GROUP =
  /\[([^[\]]{0,800}?)\]|("[a-z_]+"(?:\s*\|\s*"[a-z_]+")+)|('[a-z_]+'(?:\s*\|\s*'[a-z_]+')+)/gs;

function offendersIn(file: string, source: string): Offender[] {
  const found: Offender[] = [];
  for (const match of source.matchAll(LITERAL_GROUP)) {
    const body = match[1] ?? match[2] ?? match[3];
    if (!body) continue;
    const members = new Set([...body.matchAll(/["']([a-z_]+)["']/g)].map((m) => m[1]));
    if (members.size < 2) continue;

    for (const [vocabulary, values] of Object.entries(VOCABULARIES)) {
      const set = new Set(values);
      // Every member must belong, or it is a list about something else that
      // happens to share a word ("cancelled" is in three vocabularies).
      if (![...members].some((m) => set.has(m))) continue;
      if (![...members].every((m) => set.has(m))) continue;
      // Complete, or one short — see the threshold argument in the header.
      // The floor of 3 matters for a SHORT vocabulary: `application_status`
      // has three values, so "all but one" would be two, and
      // `.in("status", ["pending", "accepted"])` is an ordinary query filter,
      // not a registry. On a three-value set only a complete copy counts.
      if (members.size < Math.max(3, values.length - 1)) continue;
      found.push({
        file,
        line: source.slice(0, match.index).split("\n").length,
        vocabulary,
        covered: members.size,
        of: values.length,
      });
    }
  }
  return found;
}

function scan(): Offender[] {
  const found: Offender[] = [];
  for (const root of SCAN_ROOTS) {
    for (const abs of walk(join(ROOT, root))) {
      const file = relative(ROOT, abs).split(sep).join("/");
      if (SOURCES_OF_TRUTH.includes(file)) continue;
      found.push(...offendersIn(file, readFileSync(abs, "utf8")));
    }
  }
  return found;
}

describe("hand-written registries of database-owned sets", () => {
  const offenders = scan();
  const ledgered = new Set(LEDGER.map((e) => `${e.file}::${e.vocabulary}`));

  it("derives every vocabulary from the world, not from this file", () => {
    // If a source of truth is renamed or reshaped, the parsers above return
    // nothing and this whole guard passes vacuously — which is the failure it
    // exists to prevent, one level up. So assert the shapes.
    expect(Object.keys(VOCABULARIES).sort()).toEqual([
      "application_status",
      "job_status",
      "payment_status",
      "tier",
    ]);
    for (const [name, values] of Object.entries(VOCABULARIES)) {
      expect(values.length, `${name} vocabulary came back too small to be real`).toBeGreaterThan(2);
      expect(new Set(values).size, `${name} vocabulary has duplicates — the parse is wrong`).toBe(values.length);
    }
  });

  it("has no NEW hand-written copy of a tier / status / payment-status set", () => {
    const unledgered = offenders.filter((o) => !ledgered.has(`${o.file}::${o.vocabulary}`));
    expect(
      unledgered.map((o) => `${o.file}:${o.line} lists ${o.covered} of the ${o.of} ${o.vocabulary} values`),
      "A list that covers a database-owned set (or all but one of it) is a registry checked against " +
        "itself: it cannot fail for a missing member, and it has shipped nine real defects here. " +
        "Derive it — Constants.public.Enums.job_status, Object.keys(TIER_PERK_MATRIX), or the CHECK " +
        "constraint (see adminJobsPaymentTone.test.ts). Only add to LEDGER with a written reason.",
    ).toEqual([]);
  });

  it("carries no ledger entry that has stopped suppressing anything", () => {
    const live = new Set(offenders.map((o) => `${o.file}::${o.vocabulary}`));
    const stale = LEDGER.filter((e) => !live.has(`${e.file}::${e.vocabulary}`)).map(
      (e) => `${e.file} (${e.vocabulary})`,
    );
    expect(
      stale,
      "These ledger rows no longer match any hand-written list — either the file was fixed or it was " +
        "moved. DELETE the row. A suppression that outlives what it suppressed reads as reviewed-and- " +
        "accepted while protecting nothing, and silently exempts the next real offender in that file.",
    ).toEqual([]);
  });
});
