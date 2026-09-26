/**
 * Series copy never promises "not charged" for a date that may already be
 * paid (review 2026-09-25 LOW-4; owner decision Q407 (12)).
 *
 * A date nobody picked is never charged. But a VACATED visit (its Helpr gave it
 * up, or a ban handed it back) was charged when it was booked, and if nobody
 * takes it the poster gets it back LESS the card processing fee. So every
 * series surface that says a date "isn't charged" must, in the same sentence
 * or the next, say a paid one is refunded (less the processing fee).
 *
 * Inventory: the series UI files and the SQL functions that write series
 * notifications (their newest definitions), comments blanked, strings kept.
 *
 * @mutate src/components/series/SeriesDatesPanel.tsx | Different Helprs can take different dates. A date nobody takes isn't charged, or is refunded less the card processing fee if it was already paid. | Different Helprs can take different dates. A date nobody takes is not charged.
 * @mutate src/components/postjob/RecurringSchedulePicker.tsx | A date nobody takes isn't charged, or is refunded less the card processing fee if it was already paid." | A date nobody takes isn't charged."
 * @mutate supabase/migrations/20260925160645_recurring_split_days.sql | A date nobody takes isn''t charged, or is refunded less the card processing fee if you already paid for it. | A date nobody takes is not charged.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const UI = [
  "src/components/postjob/RecurringSchedulePicker.tsx",
  "src/components/series/SeriesDatesPanel.tsx",
  "src/components/series/SeriesTermsLine.tsx",
  "src/components/series/EndSeriesControl.tsx",
  "src/components/schedule/ScheduleChangeControl.tsx",
];
const SQL = [
  "series_release_dates", "end_series_for_banned_account", "helper_cancel_booking", "series_holds_on_hire",
  "claim_series_dates", "give_up_series_dates", "offer_series_dates", "end_recurring_series",
];
const NOT_CHARGED = /(?:isn'?t|isn''t|is not|won'?t be|won''t be|aren'?t|are not|not be) charged/gi;

function unqualified(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(NOT_CHARGED)) {
    // The same sentence or the next, inside the SAME string literal: stop at
    // the literal's end (a TS quote, or a SQL literal followed by a comma).
    const rest = text.slice(m.index!, m.index! + 180);
    const end = rest.search(/"|',/);
    const after = end >= 0 ? rest.slice(0, end) : rest;
    if (!/refunded/i.test(after)) out.push(text.slice(Math.max(0, m.index! - 60), m.index! + 40).replace(/\s+/g, " "));
  }
  return out;
}

describe("series copy: 'not charged' always names the refund of a paid date (LOW-4, Q407 12)", () => {
  it("UI", () => {
    let seen = 0;
    const bad: string[] = [];
    for (const f of UI) {
      const code = blankComments(readFileSync(f, "utf8"));
      seen += (code.match(NOT_CHARGED) ?? []).length;
      bad.push(...unqualified(code).map((s) => `${f}: ${s}`));
    }
    expect(seen).toBeGreaterThanOrEqual(2);
    expect(bad).toEqual([]);
  });

  it("SQL notifications", () => {
    const defs = effectiveDefs(join(process.cwd(), "supabase/migrations"));
    let seen = 0;
    const bad: string[] = [];
    for (const n of SQL) {
      const body = blankSqlComments(defs.get(n)?.stmt ?? "");
      expect(body, `${n} is not defined`).not.toBe("");
      seen += (body.match(NOT_CHARGED) ?? []).length;
      bad.push(...unqualified(body).map((s) => `${n}: ${s}`));
    }
    expect(seen).toBeGreaterThanOrEqual(2);
    expect(bad).toEqual([]);
  });
});
