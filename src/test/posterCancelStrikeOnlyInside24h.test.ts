/**
 * JOBS-14 (owner ruling, 10-30): a poster gets a strike for cancelling a hired
 * Helpr only within 24 hours of the start, matching Helprs. The behaviour is
 * proved by src/test/pglite/posterCancelStrikeOnlyInside24h.pglite.mjs; this
 * keeps the newest definition on that gate, and every poster-facing sentence
 * that names the rule true.
 *
 * @mutate supabase/migrations/20261031015647_poster_cancel_strike_only_inside_24h.sql |   IF v_late THEN\n    v_verdict |   IF v_committed THEN\n    v_verdict
 * @mutate src/pages/info/helpCenter/helpCenterContent.ts | It isn't a strike either. | A strike is still recorded.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const root = join(__dirname, "..", "..");
const defs = effectiveDefs(join(root, "supabase", "migrations"));
const body = (name: string): string => {
  const d = defs.get(name);
  if (!d) throw new Error(`no effective definition of ${name}`);
  return blankSqlComments(d.stmt);
};
const read = (p: string) => blankComments(readFileSync(join(root, p), "utf8"));

describe("a poster's cancel strike is gated on the 24 hours, not on commitment alone", () => {
  it("the newest poster_cancel_job files the strike only when late, and late still needs a committed Helpr", () => {
    const fn = body("poster_cancel_job");
    expect(defs.size).toBeGreaterThan(500);
    const calls = [...fn.matchAll(/IF\s+(\w+)\s+THEN\s+v_verdict\s*:=\s*public\.apply_cancellation_violation_consequence/g)];
    expect(calls.map((m) => m[1])).toEqual(["v_late"]);
    expect(fn).toMatch(/v_late\s*:=\s*public\.is_late_cancellation\(v_committed,\s*v_hours\)/);
  });

  it("the strike window is the fee's window: both read the same committed flag and hours", () => {
    const fn = body("poster_cancel_job");
    expect(fn).toMatch(/public\.cancellation_fee_percent\(v_committed,\s*v_hours\)/);
    expect(body("is_late_cancellation")).toMatch(/p_hours_until\s*<\s*24/);
    expect(body("cancellation_fee_percent")).toMatch(/p_hours_until\s*<\s*24\s+THEN\s+25/);
  });

  it("Help and the Community Rules say the 24-hour rule; nothing says a far-out cancel is struck", () => {
    const help = read("src/pages/info/helpCenter/helpCenterContent.ts");
    expect(help).toMatch(/It isn't a strike either\./);
    expect(help).toMatch(/counts as a strike/);
    const rules = read("src/pages/info/legal/CommunitySection.tsx");
    expect(rules).toMatch(/24 or more hours before the start does <strong>not<\/strong> count toward strikes/);
    const dialog = read("src/components/CancellationDialog.tsx");
    expect(dialog).not.toMatch(/A strike is still recorded/);
    expect(dialog).toMatch(/No strike/);
  });
});
