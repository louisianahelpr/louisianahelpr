/**
 * Q2245 (d): the approval notice's payout promise counts what a Helpr owes
 * for a series visit refunded in full because their setup lapsed
 * (helpr_card_fee_debts), because the payout takes it (take_helpr_fault_fee
 * reads both debts since 20261102072106). Without it the notice promised $X
 * and the payout sent $X less that amount. Words: Declutter's debt wording,
 * no fee name (membersSeeNoFeeWords).
 *
 * @mutate supabase/functions/_shared/payoutPromise.ts |     const debtOwedCents = faultOwedCents + lapsedOwedCents; |     const debtOwedCents = faultOwedCents;
 * @mutate supabase/functions/_shared/payoutPromise.ts |     if (settings.error \|\| profile.error \|\| debts.error \|\| cardDebts.error) return null; |     if (settings.error \|\| profile.error \|\| debts.error) return null;
 * @mutate supabase/functions/_shared/payoutPromise.ts |   lapsed_visit: "for the cost of refunding a visit you couldn't do", |   lapsed_visit: "owed from a job you were ruled at fault on",
 */
import { describe, expect, it } from "vitest";
import { payoutPromiseSentence, readPromisedPayout } from "../../supabase/functions/_shared/payoutPromise";

const HELPR = "h-1";
type Res = { data: unknown; error: { message: string } | null };

/** A fake admin client: each table answers one read. */
function db(tables: Record<string, Res>) {
  return {
    from(table: string) {
      const res = tables[table] ?? { data: null, error: { message: `unexpected table ${table}` } };
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "gt", "limit"]) chain[m] = () => chain;
      chain.single = async () => res;
      chain.maybeSingle = async () => res;
      chain.then = (resolve: (v: Res) => void) => resolve(res);
      return chain;
    },
  };
}
const base = (fault: number[], lapsed: number[] | "error"): Record<string, Res> => ({
  platform_settings: { data: { onboarding_fee_cents: 200 }, error: null },
  profiles: { data: { onboarding_fee_paid: true }, error: null },
  job_helpr_fault_rulings: { data: fault.map((c) => ({ card_fee_remaining_cents: c })), error: null },
  helpr_card_fee_debts: lapsed === "error"
    ? { data: null, error: { message: "boom" } }
    : { data: lapsed.map((c) => ({ remaining_cents: c })), error: null },
});
const JOB = { budget: 100 } as never;

describe("Q2245: the payout promise counts a lapsed visit's debt", () => {
  it("a lapsed-visit debt alone comes off, named as the cost of refunding a visit", async () => {
    const p = await readPromisedPayout(db(base([], [320])), HELPR, JOB, 89);
    expect(p).toMatchObject({ cents: 8580, debtCents: 320, debtFrom: "lapsed_visit" });
    const said = payoutPromiseSentence(p, "Tue, Nov 3");
    expect(said).toBe("$85.80 will be sent to your account Tue, Nov 3, after $3.20 for the cost of refunding a visit you couldn't do.");
    expect(said).not.toMatch(/card fee|card cost|processing/i);
  });

  it("both kinds owed: one total, said plainly", async () => {
    const p = await readPromisedPayout(db(base([150], [320])), HELPR, JOB, 89);
    expect(p).toMatchObject({ debtCents: 470, debtFrom: "both" });
    expect(payoutPromiseSentence(p, "Tue, Nov 3")).toContain("after $4.70 owed from earlier jobs");
  });

  it("an at-fault ruling alone keeps its words", async () => {
    const p = await readPromisedPayout(db(base([150], [])), HELPR, JOB, 89);
    expect(p).toMatchObject({ debtCents: 150, debtFrom: "fault" });
    expect(payoutPromiseSentence(p, "Tue, Nov 3")).toContain("$1.50 owed from a job you were ruled at fault on");
  });

  it("an unread lapsed-visit debt names no figure (a wrong promise is worse than none)", async () => {
    expect(await readPromisedPayout(db(base([], "error")), HELPR, JOB, 89)).toBeNull();
  });
});
