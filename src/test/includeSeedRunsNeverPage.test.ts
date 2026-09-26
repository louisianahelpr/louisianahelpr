/**
 * CLASS GUARD: a `?include_seed=1` run never pages the owner's channel.
 *
 * THE BUG (docs/OPEN.md Q90, measured on prod 2026-09-23). Manual
 * `money-reconciliation?include_seed=1` verification runs at ~07:54Z found 17
 * discrepancies, every one on an is_seed job, and posted them to #ops-alerts at
 * `critical`, opening ops_alert_ledger item c974c7b3. The seed-policy rule
 * (public.error_log_is_seed, postSlackOpsAlert `seed`, migration
 * 20260923052520) existed, but the reconciler's include_seed branch never used
 * it: seed hits and real hits went out in one paging alert.
 *
 * THE CLASS, derived from the tree: every supabase/functions/<fn>/index.ts
 * whose CODE (comments blanked) reads the `include_seed` query parameter AND
 * calls postSlackOpsAlert(. Such a function knowingly processes seed subjects,
 * so at least one of its alerts must be routed with a `seed:` flag. A function
 * that has not been fixed yet sits in KNOWN_UNROUTED with its OPEN.md item;
 * that list may only shrink (an entry that gains routing fails until removed).
 *
 * The behavioural half (seed-only hits -> digest, 200, no defect; a real hit on
 * the same run still pages naming only the real job) is pinned in
 * src/test/edge/money-reconciliation.test.ts "seed findings (?include_seed=1)"
 * and, for the other three, src/test/edge/includeSeedAlertRouting.test.ts.
 *
 * RED ON THE ORIGINAL: against origin/main 46413558e money-reconciliation has
 * no `seed:` in code and is not in KNOWN_UNROUTED.
 *
 * @mutate supabase/functions/money-reconciliation/index.ts | seed: true, | unrouted: true,
 * @mutate supabase/functions/subscription-reconciliation/index.ts | seed: true, | unrouted: true,
 * @mutate supabase/functions/process-scheduled-payouts/index.ts | const { ids: adminIds } = job.is_seed === true\n          ? { ids: [] as string[] }\n          : await loadAdminIds( | const { ids: adminIds } = await loadAdminIds(
 *
 * THE ADMIN INBOX IS A CHANNEL TOO (docs/OPEN.md Q93, 2026-09-26): Q91 routed
 * the Slack pages, but process-scheduled-payouts still inserted an in-app
 * `admin_alert` for every admin on a seed job's failure. So in an
 * include_seed function every loadAdminIds( (the admin fan-out) must sit
 * behind the subject's own `is_seed === true` check.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const FNS = join(process.cwd(), "supabase", "functions");

/**
 * Not yet routed. EMPTY since docs/OPEN.md Q91 (2026-09-23) routed the last
 * three (auto-release-payment, process-scheduled-payouts,
 * subscription-reconciliation). Exact and shrink-only: never add to it.
 */
// @two-way src/test/includeSeedRunsNeverPage.test.ts:KNOWN_UNROUTED only shrinks
const KNOWN_UNROUTED = new Set<string>([]);

const READS_INCLUDE_SEED = /searchParams\.get\(\s*["']include_seed["']\s*\)/;
const ALERTS = /postSlackOpsAlert\(/;
const ROUTES_SEED = /\bseed\s*:/;

const inventory = readdirSync(FNS)
  .filter((d) => existsSync(join(FNS, d, "index.ts")))
  .map((d) => ({ fn: d, code: blankComments(readFileSync(join(FNS, d, "index.ts"), "utf8")) }))
  .filter(({ code }) => READS_INCLUDE_SEED.test(code) && ALERTS.test(code));

describe("include_seed runs route seed alerts to the digest", () => {
  it("found the class (inventory floor, 2026-09-23: 4 functions)", () => {
    expect(inventory.length).toBeGreaterThanOrEqual(4);
    expect(inventory.map((i) => i.fn)).toContain("money-reconciliation");
  });

  it("every include_seed function passes `seed:` to postSlackOpsAlert", () => {
    const bad = inventory
      .filter(({ fn, code }) => !ROUTES_SEED.test(code) && !KNOWN_UNROUTED.has(fn))
      .map(({ fn }) => fn);
    expect(bad, "route seed subjects with postSlackOpsAlert({ seed: <subject is_seed> }) — see money-reconciliation").toEqual([]);
  });

  it("KNOWN_UNROUTED only shrinks: a listed function that now routes must be removed", () => {
    const stale = inventory.filter(({ fn, code }) => KNOWN_UNROUTED.has(fn) && ROUTES_SEED.test(code)).map(({ fn }) => fn);
    const gone = [...KNOWN_UNROUTED].filter((fn) => !inventory.some((i) => i.fn === fn));
    expect(stale).toEqual([]);
    expect(gone).toEqual([]);
  });

  it("Q93: in an include_seed function, every admin in-app fan-out is gated on the subject's is_seed", () => {
    const withFanOut = readdirSync(FNS)
      .filter((d) => existsSync(join(FNS, d, "index.ts")))
      .map((d) => ({ fn: d, code: blankComments(readFileSync(join(FNS, d, "index.ts"), "utf8")) }))
      .filter(({ code }) => READS_INCLUDE_SEED.test(code) && /loadAdminIds\(/.test(code));
    // Floor: process-scheduled-payouts fans out to admins (2 call sites, 2026-09-26).
    expect(withFanOut.map((f) => f.fn)).toContain("process-scheduled-payouts");
    const ungated: string[] = [];
    for (const { fn, code } of withFanOut) {
      for (const m of code.matchAll(/loadAdminIds\(/g)) {
        const before = code.slice(Math.max(0, (m.index ?? 0) - 160), m.index);
        if (!/is_seed === true/.test(before)) ungated.push(`${fn} @${m.index}`);
      }
    }
    expect(ungated, "a seed job's failure reaches /admin notifications; gate the fan-out on `<subject>.is_seed === true`").toEqual([]);
  });

  it("the predicate ignores comments", () => {
    const src = `// seed: true\nconst x = url.searchParams.get("include_seed");\nawait postSlackOpsAlert({})`;
    expect(ROUTES_SEED.test(blankComments(src))).toBe(false);
  });
});
