/**
 * Deep audit 11-22 #44: an overdue fix request still looked upcoming. On Nov 22 the What to fix box said "The fix is
 * due by Thu, Nov 12", with no overdue cue, and nothing said what happens when the time runs out. On prod,
 * auto-release-payment (cron "5,35 * * * *", read 11-25) opens a dispute for a held payment (payment_status escrow)
 * whose fix was never marked done by revision_deadline (open_dispute_as, 20260912023326), and Helpr support decides.
 *
 * Fix: RevisionAsk says "The fix was due <when> and isn't marked done." once the deadline has passed (in the danger
 * ink), and, while the payment is held, what happens next ("If it isn't marked done by then, Helpr support steps in
 * and decides the payment." / "Helpr support will step in and decide the payment.").
 *
 * CLASS GUARD (below): every user-facing "due by ${...}" / "mark it done by ${...}" deadline sentence in src/ sits in a
 * function that also has its overdue twin ("was due"), so no deadline line can read as upcoming after it passes.
 *
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx |   const overdue = due !== null && dueMs <= Date.now(); |   const overdue = false;
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx |   const held = job.payment_status === "escrow"; |   const held = false;
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { JobPageRow } from "@/pages/jobs/jobPage/useJobPage";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { RevisionAsk } from "@/pages/jobs/jobPage/JobPageParts";

const row = (over: Partial<JobPageRow>): JobPageRow => ({
  id: "j", title: "Scrub a back deck", description: null, category: "cleaning", budget: 80, date_needed: null, start_time: null,
  is_flexible_schedule: false, location: null, customer_id: "p", helper_id: "h", status: "revision_requested", payment_status: "escrow",
  urgent_fee: null, helpers_needed: 1, is_group_job: false, photos: [], helper_fee_flat_cents: 70, helper_fee_percent: 5, poster_fee_flat_cents: null,
  revision_note: "The rail was missed.",
  ...over,
});
const PAST = "2026-11-12T18:00:00Z";
const FUTURE = "2037-10-21T14:30:00Z";

afterEach(cleanup);

describe("deep audit 11-22 #44: an overdue fix says it is late, and what happens next", () => {
  it("poster, past the deadline: 'was due … and isn't marked done', support steps in", () => {
    const { container } = render(<RevisionAsk job={row({ revision_deadline: PAST })} side="poster" />);
    const line = container.querySelector("[data-revision-overdue]");
    expect(line?.textContent).toBe("The fix was due Thu, Nov 12, 12:00 PM and isn't marked done. Helpr support will step in and decide the payment.");
    expect(container.textContent).not.toContain("is due by");
  });

  it("Helpr, past the deadline: the same late line", () => {
    const { container } = render(<RevisionAsk job={row({ revision_deadline: PAST })} side="helpr" posterFirst="Dana" />);
    expect(container.querySelector("[data-revision-overdue]")?.textContent).toContain("The fix was due Thu, Nov 12, 12:00 PM and isn't marked done.");
  });

  it("before the deadline: due by, plus what happens if it isn't done", () => {
    const { container } = render(<RevisionAsk job={row({ revision_deadline: FUTURE })} side="poster" />);
    expect(container.querySelector("[data-revision-overdue]")).toBeNull();
    expect(container.textContent).toContain("The fix is due by Wed, Oct 21, 9:30 AM. If it isn't marked done by then, Helpr support steps in and decides the payment.");
  });

  it("no held payment, no promise about support deciding it", () => {
    const { container } = render(<RevisionAsk job={row({ revision_deadline: PAST, payment_status: "released" })} side="poster" />);
    expect(container.textContent).toContain("The fix was due Thu, Nov 12, 12:00 PM and isn't marked done.");
    expect(container.textContent).not.toContain("Helpr support");
  });
});

/** The text of the function (or arrow) body that encloses `at`, by brace matching outward from it. */
function enclosingBlock(code: string, at: number): string {
  let depth = 0;
  let start = at;
  for (; start > 0; start--) {
    if (code[start] === "}") depth++;
    else if (code[start] === "{") { if (depth === 0 && /export function|function |=>\s*$/.test(code.slice(Math.max(0, start - 200), start))) break; if (depth > 0) depth--; }
  }
  depth = 0;
  let end = start;
  for (; end < code.length; end++) {
    if (code[end] === "{") depth++;
    else if (code[end] === "}" && --depth === 0) break;
  }
  return code.slice(start, end + 1);
}
const DEADLINE = /(?:due by|mark it done by) \$\{/g;

describe("CLASS: a deadline sentence has its overdue twin", () => {
  it("the walker finds the sentence in a block and reads the twin", () => {
    const loud = "function A() { const x = late ? `was due ${d}` : `is due by ${d}`; return x; }";
    const quiet = "function B() { return `is due by ${d}`; }";
    const at = (s: string) => s.search(DEADLINE);
    expect(enclosingBlock(loud, at(loud))).toContain("was due");
    expect(enclosingBlock(quiet, at(quiet))).not.toContain("was due");
  });

  it("every 'due by ${…}' / 'mark it done by ${…}' sentence sits beside a 'was due' branch", () => {
    const root = process.cwd();
    const sites: string[] = [];
    const offenders: string[] = [];
    for (const f of walkSource([join(root, "src")]).filter((x) => !/\.test\.tsx?$|\/src\/test\//.test(x))) {
      const code = blankComments(readFileSync(f, "utf8"));
      for (const m of code.matchAll(DEADLINE)) {
        sites.push(relative(root, f));
        if (!enclosingBlock(code, m.index ?? 0).includes("was due")) offenders.push(relative(root, f));
      }
    }
    // RevisionAsk's two before-deadline lines (poster, Helpr).
    expect(sites.length).toBeGreaterThan(1);
    expect(offenders).toEqual([]);
  });
});
