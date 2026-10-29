/**
 * THE GUARANTEE FIX-DAY PICKER OFFERS ONLY DAYS THE HELPR CAN STILL USE, UNDER A LINE THAT SAYS WHAT IS DUE WHEN.
 *
 * Audit 2026-10-28 (part 4 half 2 final leg, F31; shot p4j-hclaim-job-p1-375.png): the hired Helpr read "Pick a
 * day to fix it by Fri, Oct 30, 11:20 PM" over chips for Wed Oct 28 (at 11:20 PM that same day) through Sat
 * Oct 31. Measured from the newest rpc_guarantee_helpr_answer (20261027200455) and the Terms ("The Helpr has 48
 * hours to pick a day to fix it (within 3 days)"): helpr_answer_by is the deadline to ANSWER, and the fix day may
 * be today to 3 days out. So the line named the wrong deadline, and "today" was offered when no visit today was
 * possible any more.
 *
 * Now: the line says "Answer by <helpr_answer_by>"; the chips are the server's window, with today only while the
 * app's own same-day rule (sameDayStartTime: 2 hours' notice, a start by 9:00 PM) still allows a visit today.
 *
 * @mutate src/lib/guarantee/index.ts |   return sameDayStartTime(now) === null ? days.slice(1) : days; |   return days;
 * @mutate src/components/guarantee/HelprGuaranteePanel.tsx | Answer by {endSentence(when(claim.helpr_answer_by))} Pick the day you'll come back to fix it. | Pick a day to fix it by {endSentence(when(claim.helpr_answer_by))}
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GuaranteeClaim, GuaranteeJob } from "@/lib/guarantee";
import { GUARANTEE_RULES } from "@/lib/guarantee/rules";
import { blankSqlComments } from "./helpers/blankNonCode";

const s = vi.hoisted(() => ({ claim: null as unknown }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/hooks/useProofPhotoUrls", () => ({ useProofPhotoUrls: (v: string[]) => v.map(() => null) }));
vi.mock("@/lib/guarantee", async (orig) => ({
  ...(await orig<typeof import("@/lib/guarantee")>()),
  fetchGuaranteeClaim: async () => s.claim,
}));

import { fixDateChoices } from "@/lib/guarantee";
import { HelprGuaranteePanel } from "@/components/guarantee/HelprGuaranteePanel";

/** Louisiana wall time → the instant (CDT, UTC-5, in late October 2026). */
const cdt = (ymd: string, hm: string) => new Date(`${ymd}T${hm}:00-05:00`);

describe("fix days (F31)", () => {
  it("the server's window is today to fix_within_days out (the newest rpc_guarantee_helpr_answer)", () => {
    const sql = blankSqlComments(readFileSync(resolve(__dirname, "../../supabase/migrations/20261027200455_helpr_guarantee.sql"), "utf8"));
    expect(sql).toContain("_fix_date < v_today");
    expect(sql).toContain("_fix_date > v_today + (public.guarantee_rules() ->> 'fix_within_days')::integer");
    expect(GUARANTEE_RULES.fixWithinDays).toBe(3);
  });

  it("at 11:20 PM, the audit's moment, today is not offered; the rest of the window is", () => {
    expect(fixDateChoices(cdt("2026-10-28", "23:20"))).toEqual(["2026-10-29", "2026-10-30", "2026-10-31"]);
  });

  it("in the morning, today is offered with the next 3 days", () => {
    expect(fixDateChoices(cdt("2026-10-28", "09:00"))).toEqual(["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]);
  });

  it("every offered day is one the server accepts, at every hour of the day", () => {
    for (let h = 0; h < 24; h++) {
      const now = cdt("2026-10-28", `${String(h).padStart(2, "0")}:15`);
      const days = fixDateChoices(now);
      expect(days.length).toBeGreaterThanOrEqual(GUARANTEE_RULES.fixWithinDays);
      for (const d of days) {
        expect(d >= "2026-10-28" && d <= "2026-10-31", `${h}:15 offered ${d}`).toBe(true);
      }
    }
  });
});

describe("the Helpr's line names the answer deadline as the answer deadline (F31)", () => {
  it("says Answer by <helpr_answer_by>, never 'fix it by' that time", async () => {
    const job: GuaranteeJob = {
      id: "j1", customer_id: "p1", helper_id: "me", status: "completed", payment_status: "payout_pending", is_group_job: false,
      helper_completed_at: new Date(Date.now() - 3 * 3600e3).toISOString(), poster_completed_at: new Date(Date.now() - 2 * 3600e3).toISOString(),
    };
    s.claim = {
      id: "c1", job_id: "j1", poster_id: "p1", helper_id: "me", note: "The bathroom mirror was skipped.", photo_paths: [],
      status: "awaiting_helpr", helpr_answer_by: new Date(Date.now() + 40 * 3600e3).toISOString(), fix_date: null, fixed_at: null,
      poster_answer_by: null, closed_at: null, close_reason: null, poster_reject_note: null, created_at: new Date().toISOString(),
    } satisfies GuaranteeClaim;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><HelprGuaranteePanel job={job} userId="me" side="helpr" /></QueryClientProvider>);
    const line = await screen.findByText(/^Answer by /);
    expect(line.textContent).toMatch(/Pick the day you'll come back to fix it\./);
    expect(document.body.textContent).not.toMatch(/fix it by/i);
  });
});
