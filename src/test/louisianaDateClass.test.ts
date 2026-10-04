/**
 * CLASS GUARD (Q1203): no job or visit date in `supabase/functions` is made or
 * compared with a UTC date string.
 *
 * WHAT IT CATCHES. `create-payment` refused a recurring visit when
 * `visit_date <= new Date().toISOString().slice(0, 10)`, and
 * `charge-recurring-visits` had its own `todayUtc()`. `visit_date` and
 * `date_needed` are Postgres `date`s that mean a day on the LOUISIANA calendar
 * (America/Chicago); `toISOString()` is UTC, which is already tomorrow from
 * 19:00 CDT. The payment window closed a day early every evening. The fix is
 * ONE helper, `louisianaToday()` (`_shared/louisianaDate.ts`).
 *
 * HOW. The inventory is every non-test `.ts` under `supabase/functions`, with
 * comments blanked (`blankComments`; the fix and this header quote the broken
 * spelling in prose). Every UTC date-string producer left in code must be in
 * EXCEPTIONS with a reason and an exact count. The check fails in BOTH
 * directions: an unlisted producer is a new offender, and a listed one that no
 * longer exists is a stale excuse (CLAUDE.md: baselines are exact).
 *
 * An exception is only valid when the value is NOT an instant standing in for a
 * Louisiana day: calendar arithmetic on a bare date, a display string, or a
 * Stripe deadline. Anything compared with `date_needed` / `visit_date` /
 * `today` belongs on `louisianaToday()` or `jobLocalMidnightMs`.
 *
 * @mutate supabase/functions/create-payment/index.ts | if (String(row.visit_date) <= louisianaToday()) | if (String(row.visit_date) <= new Date().toISOString().slice(0, 10))
 * @mutate supabase/functions/charge-recurring-visits/index.ts | const today = louisianaToday(); | const today = new Date().toISOString().slice(0, 10);
 * @mutate supabase/functions/_shared/louisianaDate.ts | export function louisianaToday(now: Date = new Date()): string { | export function louisianaToday(now: Date = new Date()): string { return now.toISOString().slice(0, 10);
 */
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { louisianaToday } from "../../supabase/functions/_shared/louisianaDate";

const ROOT = resolve(__dirname, "..", "..");
const FUNCTIONS = join(ROOT, "supabase", "functions");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** The UTC day of an instant: `.toISOString()` then `.slice/.substring/.substr(0, 10)` or `.split("T")[0]`. */
const UTC_DAY_STRING = /\.toISOString\(\)\s*(?:\.\s*(?:slice|substring|substr)\(\s*0\s*,\s*10\s*\)|\.\s*split\(\s*["']T["']\s*\)\s*\[\s*0\s*\])/g;

/** Exact count of UTC date-string producers allowed per file, each with the reason it is not a Louisiana-day comparison. */
const EXCEPTIONS: Record<string, { count: number; reason: string }> = {
  "supabase/functions/_shared/recurringSchedule.ts": {
    count: 1,
    reason: "toYmd formats a Date that parseYmd built at NOON UTC from a bare YYYY-MM-DD: pure calendar arithmetic on a date string, no instant is read.",
  },
  "supabase/functions/charge-recurring-visits/index.ts": {
    count: 1,
    reason: "addDays steps a bare YYYY-MM-DD at noon UTC and formats it back: calendar arithmetic. The 'today' it is given comes from louisianaToday().",
  },
  "supabase/functions/_shared/accountPurge.ts": {
    count: 1,
    reason: "`since` is the lower bound of a series scan (371 days back, one week wider than the 364-day series cap), not a comparison with today; a one-day offset cannot change which series are scanned.",
  },
  "supabase/functions/admin-user-actions/index.ts": {
    count: 1,
    reason: "'Suspended until' is a display field in a Slack ops alert, not compared with any job or visit date.",
  },
  "supabase/functions/str-ical-sync/index.ts": {
    count: 1,
    reason: "checkoutDate is UTC midnight built by parseIcalDate from a bare iCal date, so the slice returns that same calendar date, not an instant's UTC day. (Its look-ahead window against a UTC 'today' is a separate defect, filed in docs/OPEN.md.)",
  },
  "supabase/functions/stripe-webhook/handlers/chargeDisputeCreated.ts": {
    count: 2,
    reason: "Both format Stripe's evidence_details.due_by deadline (the dispute notice text and the Slack 'Evidence Due' field); it is a Stripe deadline, not a job or visit date.",
  },
};

function inventory(): Map<string, number> {
  const found = new Map<string, number>();
  for (const file of walk(FUNCTIONS)) {
    const code = blankComments(readFileSync(file, "utf8"));
    const n = (code.match(UTC_DAY_STRING) ?? []).length;
    if (n > 0) found.set(relative(ROOT, file), n);
  }
  return found;
}

describe("Q1203: Louisiana dates in edge functions are never UTC date strings", () => {
  const found = inventory();

  it("louisianaToday() is the Chicago day on both sides of 19:00 CDT and 18:00 CST", () => {
    expect(louisianaToday(new Date("2026-10-01T23:59:00Z"))).toBe("2026-10-01"); // 18:59 CDT
    expect(louisianaToday(new Date("2026-10-02T00:00:00Z"))).toBe("2026-10-01"); // 19:00 CDT: UTC is already Oct 2
    expect(louisianaToday(new Date("2026-10-02T05:00:00Z"))).toBe("2026-10-02"); // midnight CDT
    expect(louisianaToday(new Date("2026-12-02T05:59:00Z"))).toBe("2026-12-01"); // 23:59 CST
    expect(louisianaToday(new Date("2026-12-02T06:00:00Z"))).toBe("2026-12-02"); // midnight CST
  });

  it("scans a real inventory (floor)", () => {
    expect(walk(FUNCTIONS).length).toBeGreaterThan(100);
    // The exceptions are the only producers left; if this drops to zero the regex stopped matching.
    expect(found.size).toBeGreaterThan(3);
  });

  it("every UTC date-string producer is a listed exception, with its exact count", () => {
    const unlisted = [...found].filter(([f, n]) => (EXCEPTIONS[f]?.count ?? 0) !== n).map(([f, n]) => `${f}: ${n} found, ${EXCEPTIONS[f]?.count ?? 0} listed`);
    expect(unlisted, "use louisianaToday() / jobLocalMidnightMs, or list it in EXCEPTIONS with the reason it is not a Louisiana-day comparison").toEqual([]);
  });

  it("no listed exception is stale", () => {
    const stale = Object.keys(EXCEPTIONS).filter((f) => !found.has(f));
    expect(stale).toEqual([]);
  });

  it("every exception carries a reason", () => {
    for (const [f, e] of Object.entries(EXCEPTIONS)) expect(e.reason.length, f).toBeGreaterThan(40);
  });

  it("the two payment paths use the one helper and keep no UTC 'today' of their own", () => {
    for (const f of ["supabase/functions/create-payment/index.ts", "supabase/functions/charge-recurring-visits/index.ts"]) {
      const code = blankComments(readFileSync(join(ROOT, f), "utf8"));
      expect(code, f).toMatch(/import \{ louisianaToday \} from "\.\.\/_shared\/louisianaDate\.ts"/);
      expect(code, f).not.toMatch(/\btodayUtc\b/);
    }
  });
});
