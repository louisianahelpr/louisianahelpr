// @mutate src/lib/jobPaymentCardState.ts | chargeback: "chargeback", | chargeback: "paid_out",
// @mutate src/lib/jobPaymentCardState.ts |   failed: "failed",\n  chargeback | failed: "unfunded",\n  chargeback
// @mutate src/components/job-card/jobStatusLine.ts | if (problem) return problem;\n  switch (job.status) { | switch (job.status) {
// @mutate src/pages/posts/PostedJobCard.tsx | <PaymentProblemNotice job={job} /> | {null}
// @mutate src/pages/jobs/AppliedJobCard.tsx | <PaymentProblemNotice job={job} /> | {null}
// @mutate src/components/job-card/activityFilters.ts | if (cardPaymentProblem(j)) return "needs_you"; | if (false) return "needs_you";
// @mutate src/components/job-card/activityFilters.ts | if (app.status !== "rejected" && cardPaymentProblem(app.job)) return "needs_you"; | if (false) return "needs_you";
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { blankComments } from "@/test/helpers/blankNonCode";
import { PAYMENT_STATUSES, type PaymentStatus } from "@/lib/statusLabels";
import {
  CARD_PAYMENT_STATE,
  PAYMENT_PROBLEM_COPY,
  PAYMENT_PROBLEM_STATES,
  cardPaymentProblem,
  jobPaymentProblem,
} from "@/lib/jobPaymentCardState";
import {
  POSTER_WAIT,
  HELPER_WAIT,
  posterStatusLine,
  helperStatusLine,
} from "@/components/job-card/jobStatusLine";
import { PaymentProblemNotice } from "@/components/job-card/PaymentProblemNotice";
import { appliedActivityBucket, postedActivityBucket } from "@/components/job-card/activityFilters";
import { Constants } from "@/integrations/supabase/types";
import type { AppliedApp, Job } from "@/components/job-card/activityConstants";

/**
 * CLASS GUARD (Q360, audit ME-009 remainder): every `payment_status` the
 * stripe-webhook can write onto a job lands on an EXPLICIT job-card state, and
 * the two money problems `jobs.status` cannot show (a chargeback, a declined
 * card) are visible on BOTH parties' cards, in the same words.
 *
 * THE DEFECT AS IT STOOD. AppliedJobCard / PostedJobCard and the collapsed
 * status line (jobStatusLine.ts) keyed on `jobs.status` only. The webhook's
 * charge.dispute.created writes `payment_status='chargeback'` and leaves the
 * status alone, so a job whose money the bank took back read "Done · paid and
 * closed" to the poster and "Paid out" to the Helpr.
 *
 * INVENTORY, from the app's own source, both directions:
 *   A. WRITES: every `payment_status: "x"` / `.payment_status = "x"` in
 *      supabase/functions/stripe-webhook (comments blanked). A write chained
 *      straight off `.from("<table>")` is attributed to that table; any other
 *      ("detached": built in a variable first) must be listed in DETACHED with
 *      its table, and DETACHED may hold nothing the source no longer has.
 *      Every jobs write must be a key of CARD_PAYMENT_STATE.
 *   B. STATES: CARD_PAYMENT_STATE's keys are exactly PAYMENT_STATUSES (pinned
 *      to the DB CHECK by paymentStatusExhaustive.test.ts), and every
 *      money-problem state is one the webhook really writes onto a job.
 *   C. CARDS: for every payment status, the poster's line, the Helpr's line and
 *      the expanded-card notice show the problem iff the state is one, with
 *      identical words on both sides.
 */

const WEBHOOK = join(process.cwd(), "supabase", "functions", "stripe-webhook");
const CARDS = {
  poster: join(process.cwd(), "src", "pages", "posts", "PostedJobCard.tsx"),
  helper: join(process.cwd(), "src", "pages", "jobs", "AppliedJobCard.tsx"),
};

/** Writes built in a variable before the `.from()` call, with the table they go to. */
const DETACHED: { file: string; value: string; table: string }[] = [
  // The gift-card mint row (`mintRow`), inserted into gift_cards.
  { file: "handlers/checkoutSessionCompleted.ts", value: "paid", table: "gift_cards" },
  // `updateData` for the job's own checkout: escrow, or payout_pending on a re-pay.
  { file: "handlers/checkoutSessionCompleted.ts", value: "escrow", table: "jobs" },
  { file: "handlers/checkoutSessionCompleted.ts", value: "payout_pending", table: "jobs" },
];

/** Writes whose value is a variable, with every value it can hold. */
const VARIABLE_WRITES: { file: string; ident: string; values: string[]; table: string }[] = [
  // A dismissed inquiry restores the pre-chargeback state:
  // preChargebackPaymentStatus() returns "escrow" | "payout_pending".
  { file: "handlers/chargeDisputeClosed.ts", ident: "restoredPaymentStatus", values: ["escrow", "payout_pending"], table: "jobs" },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

interface WriteSite { file: string; value: string; table: string | null }

/** Every payment_status write in one source file, attributed where it can be. */
export function paymentStatusWrites(file: string, source: string): WriteSite[] {
  const code = blankComments(source);
  const sites: WriteSite[] = [];
  const tableAt = (index: number) => {
    const before = code.slice(Math.max(0, index - 200), index);
    const chained = [...before.matchAll(/\.from\(\s*["']([a-z_]+)["']\s*\)\s*\.(?:update|insert|upsert)\(\s*\{[^;]*$/g)].pop();
    return chained ? chained[1] : null;
  };
  // Double quotes only: code writes use them, while the ops-alert prose in
  // template strings says payment_status='x' in single quotes.
  for (const m of code.matchAll(/\bpayment_status\s*(?::|=(?!=))\s*"([a-z_]+)"/g)) {
    sites.push({ file, value: m[1], table: tableAt(m.index!) });
  }
  // A write from a variable: every value it can hold must be declared in VARIABLE_WRITES.
  for (const m of code.matchAll(/\bpayment_status\s*:\s*([A-Za-z_]\w*)\s*[,}\n]/g)) {
    const declared = VARIABLE_WRITES.find((v) => v.file === file && v.ident === m[1]);
    if (!declared) {
      sites.push({ file, value: `<variable ${m[1]}>`, table: null });
      continue;
    }
    for (const value of declared.values) sites.push({ file, value, table: tableAt(m.index!) ?? declared.table });
  }
  return sites;
}

const sites = walk(WEBHOOK).flatMap((f) =>
  paymentStatusWrites(f.slice(WEBHOOK.length + 1), readFileSync(f, "utf8")),
);
const resolved = sites.map((s) => {
  if (s.table) return s;
  const d = DETACHED.find((x) => x.file === s.file && x.value === s.value);
  return { ...s, table: d ? d.table : null };
});
const jobWrites = new Set(resolved.filter((s) => s.table === "jobs").map((s) => s.value));

describe("A. every payment_status the stripe-webhook writes onto a job has a card state", () => {
  it("inventory floor: the parse finds the webhook's job writes", () => {
    expect(sites.length).toBeGreaterThan(8);
    expect(jobWrites.size).toBeGreaterThanOrEqual(6);
    expect(jobWrites.has("chargeback")).toBe(true);
    expect(jobWrites.has("failed")).toBe(true);
  });

  it("every write is attributed to a table (unlisted detached writes fail)", () => {
    const unknown = resolved.filter((s) => s.table === null).map((s) => `${s.file} → "${s.value}"`);
    expect(unknown, `add these to DETACHED with the table they are written to:\n  ${unknown.join("\n  ")}`).toEqual([]);
  });

  it("DETACHED holds nothing the source no longer has, and each named table is written in that file", () => {
    for (const d of DETACHED) {
      expect(sites.some((s) => s.file === d.file && s.value === d.value && s.table === null), `stale DETACHED ${d.file} ${d.value}`).toBe(true);
      expect(readFileSync(join(WEBHOOK, d.file), "utf8")).toContain(`.from("${d.table}")`);
    }
  });

  it("VARIABLE_WRITES: each variable is still written, and each value it can hold is in that file", () => {
    for (const v of VARIABLE_WRITES) {
      const src = blankComments(readFileSync(join(WEBHOOK, v.file), "utf8"));
      expect(src, `stale VARIABLE_WRITES ${v.file} ${v.ident}`).toMatch(new RegExp(`payment_status\\s*:\\s*${v.ident}\\b`));
      for (const value of v.values) expect(src, `${v.ident} can no longer be "${value}"`).toContain(`"${value}"`);
    }
  });

  it("every job write maps to an explicit card state", () => {
    const unmapped = [...jobWrites].filter((v) => !(v in CARD_PAYMENT_STATE));
    expect(unmapped, "the webhook writes these onto jobs and no card state says what they mean").toEqual([]);
  });
});

describe("B. the card-state map is two-way with the database's value set", () => {
  it("keys are exactly PAYMENT_STATUSES (the jobs CHECK)", () => {
    expect(Object.keys(CARD_PAYMENT_STATE).sort()).toEqual([...PAYMENT_STATUSES].sort());
  });

  it("every money-problem state is written onto a job by the webhook (none is dead)", () => {
    for (const problem of PAYMENT_PROBLEM_STATES) {
      const values = (Object.keys(CARD_PAYMENT_STATE) as PaymentStatus[]).filter((v) => CARD_PAYMENT_STATE[v] === problem);
      expect(values.length, `no payment_status maps to ${problem}`).toBeGreaterThan(0);
      expect(values.some((v) => jobWrites.has(v)), `${problem} is never written by the webhook`).toBe(true);
    }
  });

  it("chargeback and failed are the problems; nothing else is", () => {
    const problems = PAYMENT_STATUSES.filter((s) => jobPaymentProblem(s) !== null);
    expect(problems.sort()).toEqual(["chargeback", "failed"]);
  });
});

/* ═════════════════════ C. what both cards show ═════════════════════ */

const HELPER = "helper-1";
const job = (over: Record<string, unknown>) =>
  ({
    id: "job-1", title: "Porch repaint", category: "painting", budget: 200,
    status: "completed", customer_id: "poster-1", helper_id: HELPER,
    date_needed: "2024-09-20", start_time: "09:00", payment_status: "released", ...over,
  }) as unknown as Job;
const app = (j: Job) =>
  ({ id: "app-1", job_id: j.id, helper_id: HELPER, status: "accepted", posterName: "Pierre B.", job: j }) as unknown as AppliedApp;

describe("C. both parties' cards show the money problem, in the same words", () => {
  for (const status of ["completed", "in_progress", "accepted", "disputed"] as const) {
    for (const ps of PAYMENT_STATUSES) {
      it(`${status} × payment_status=${ps}`, () => {
        const j = job({ status, payment_status: ps });
        const problem = cardPaymentProblem(j);
        const poster = posterStatusLine(j);
        const helper = helperStatusLine(app(j));
        const { container, unmount } = render(<PaymentProblemNotice job={j} />);
        const notice = container.querySelector("[data-payment-problem]");
        if (problem) {
          const copy = PAYMENT_PROBLEM_COPY[problem];
          for (const line of [poster, helper]) {
            expect(line.tone).toBe("alarm");
            expect(line.eyebrow).toBe(copy.eyebrow);
            expect(line.detail).toBe(copy.detail);
          }
          expect(notice?.textContent).toContain(copy.title);
        } else {
          for (const line of [poster, helper]) {
            expect(Object.values(PAYMENT_PROBLEM_COPY).map((c) => c.eyebrow)).not.toContain(line.eyebrow);
          }
          expect(notice).toBeNull();
        }
        unmount();
      });
    }
  }

  it("the defect as it stood: a charged-back completed job no longer reads as paid", () => {
    const j = job({ status: "completed", payment_status: "chargeback" });
    expect(posterStatusLine(j).detail).not.toBe(POSTER_WAIT.done_paid.detail);
    expect(helperStatusLine(app(j)).detail).not.toBe(HELPER_WAIT.done_paid.detail);
  });

  it("a declined card on a cancelled job stays 'didn't happen' (nothing was charged)", () => {
    const j = job({ status: "cancelled", payment_status: "failed" });
    expect(cardPaymentProblem(j)).toBeNull();
    expect(posterStatusLine(j).id).toBe("cancelled");
  });

  it("both cards mount the notice in their expanded body", () => {
    for (const [side, file] of Object.entries(CARDS)) {
      const src = blankComments(readFileSync(file, "utf8"));
      expect(src, `${side} card no longer renders PaymentProblemNotice`).toMatch(/<PaymentProblemNotice job=\{job\} \/>/);
      expect(src, `${side} card no longer gates the notice on cardPaymentProblem`).toMatch(/cardPaymentProblem\(job\)/);
    }
  });
});

/* ═════════════ D. the card is filed where someone looks (Q360 review) ═════════════ */

describe("D. a money problem files the card under Needs You, for both parties", () => {
  const STATUSES: readonly string[] = Constants.public.Enums.job_status;

  it("inventory floor: every job status x every payment status", () => {
    expect(STATUSES.length).toBeGreaterThan(6);
    expect(PAYMENT_STATUSES.length).toBeGreaterThan(8);
  });

  it("poster and Helpr: needs_you iff cardPaymentProblem (for a party still on the job)", () => {
    const wrong: string[] = [];
    let problems = 0;
    for (const status of STATUSES) {
      for (const ps of PAYMENT_STATUSES) {
        const j = job({ status, payment_status: ps });
        if (!cardPaymentProblem(j)) continue;
        problems++;
        const posted = postedActivityBucket(j);
        const applied = appliedActivityBucket(app(j));
        if (posted !== "needs_you") wrong.push(`poster ${status}/${ps} -> ${posted}`);
        if (applied !== "needs_you") wrong.push(`helper ${status}/${ps} -> ${applied}`);
      }
    }
    expect(problems).toBeGreaterThan(10);
    expect(wrong, "a money-problem card filed where nobody looks").toEqual([]);
  });

  it("the defect as reviewed: a chargeback after completion is not filed under Done", () => {
    const j = job({ status: "completed", payment_status: "chargeback" });
    expect(postedActivityBucket(j)).toBe("needs_you");
    expect(appliedActivityBucket(app(j))).toBe("needs_you");
    // Without the money problem the same job is Done on both sides.
    const paid = job({ status: "completed", payment_status: "released" });
    expect(postedActivityBucket(paid)).toBe("done");
    expect(appliedActivityBucket(app(paid))).toBe("done");
  });

  it("a passed-over applicant is not pulled into Needs You by someone else's payment", () => {
    const j = job({ status: "completed", payment_status: "chargeback", helper_id: "someone-else" });
    const rejected = { ...app(j), status: "rejected" } as unknown as AppliedApp;
    expect(appliedActivityBucket(rejected)).toBe("cancelled");
    expect(helperStatusLine(rejected).id).not.toBe("bank_dispute");
  });

  it("the tab counts come from the same bucket functions (badges stay in sync)", () => {
    const src = blankComments(readFileSync(join(process.cwd(), "src", "components", "job-card", "activityFilters.ts"), "utf8"));
    expect(src).toMatch(/counts\[appliedActivityBucket\(a\)\]\+\+/);
    expect(src).toMatch(/counts\[postedActivityBucket\(j,/);
  });
});
