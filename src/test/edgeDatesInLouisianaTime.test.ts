/**
 * Every date or time an edge function writes for a member is in Louisiana time (owner's message review 11-09, F183).
 * The suspension email and push built the restore date with `toLocaleDateString()` on the server, which runs in UTC:
 * a strike given after 6 PM Central showed the next day's date, written "11/16/2026" unlike every other message.
 * The weekly Helpr report did the same.
 *
 * The class, from the source: every `toLocaleDateString(` / `toLocaleTimeString(` call under supabase/functions
 * (comments blanked) names a `timeZone`; and the shared label is "Mon, Nov 16 at 7:42 PM" in America/Chicago.
 *
 * @mutate supabase/functions/admin-user-actions/index.ts |         const restoreLabel = centralDateTimeLabel(suspendUntil) |         const restoreLabel = suspendUntil.toLocaleDateString()
 * @mutate supabase/functions/weekly-helper-report/index.ts | (${centralDayLabel(weekAgo)} – ${centralDayLabel(now)}) | (${weekAgo.toLocaleDateString()} – ${now.toLocaleDateString()})
 * @mutate supabase/functions/_shared/centralDateTime.ts | const MEMBER_TIMEZONE = "America/Chicago"; | const MEMBER_TIMEZONE = "UTC";
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
// The repo's readdirSync (lists src/ from git; anything else, here supabase/, straight from disk).
import { readdirSync } from "./helpers/trackedFiles";
import { centralDateTimeLabel, centralDayLabel } from "../../supabase/functions/_shared/centralDateTime";

const ROOT = resolve(__dirname, "..", "..");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === "node_modules" ? [] : walk(join(dir, e.name))) : [join(dir, e.name)],
  );
}

/** The argument text of the call whose "(" is at `open`, balancing parentheses. */
function callArgs(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

/** Calls still on the server's zone (the weekly digest's 2 left with F186, 11-09). Exact. */
// @two-way src/test/edgeDatesInLouisianaTime.test.ts:expect(offenders.sort()).toEqual([...KNOWN].sort());
const KNOWN: string[] = [];

describe("edge functions write dates in Louisiana time (F183)", () => {
  it("every toLocaleDateString / toLocaleTimeString call names a timeZone", () => {
    const files = walk(join(ROOT, "supabase/functions")).filter((f) => /\.(ts|tsx)$/.test(f));
    expect(files.length).toBeGreaterThan(300);
    const offenders: string[] = [];
    let calls = 0;
    for (const f of files) {
      const src = blankComments(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/\.toLocale(?:Date|Time)String\(/g)) {
        calls++;
        if (!/timeZone/.test(callArgs(src, m.index! + m[0].length - 1))) offenders.push(f.slice(ROOT.length + 1));
      }
    }
    expect(calls).toBeGreaterThan(3);
    expect(offenders.sort()).toEqual([...KNOWN].sort());
  });

  it("the shared label is the house style in America/Chicago", () => {
    // 2026-11-17 01:42 UTC is Mon, Nov 16 at 7:42 PM in Louisiana (CST, UTC-6): the UTC date would say Nov 17.
    const lateEvening = new Date(Date.UTC(2026, 10, 17, 1, 42));
    expect(centralDateTimeLabel(lateEvening)).toBe("Mon, Nov 16 at 7:42 PM Central");
    expect(centralDayLabel(lateEvening)).toBe("Nov 16");
  });
});
