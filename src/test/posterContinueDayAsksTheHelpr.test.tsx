/**
 * Q2606 (owner decision, 11-02): the poster's new continue-day must be ACCEPTED by the Helpr, as the Helpr's is by
 * the poster. Server half: 20261102102402_poster_continue_day_goes_to_the_helpr.sql (every pick 'proposed'; the one
 * who did NOT propose answers), proven in src/test/pglite/posterContinueDayAsksTheHelpr.pglite.mjs. This is the client
 * half: the row says who asked (proposed_by against the job's poster), the Helpr gets Accept / Decline for the
 * poster's day and the poster only waits on it, both sides' next-step lines say so, and the poster's sheet sends
 * ("Send to Eli"), never "Set the day".
 * @mutate src/lib/continueDayReads.ts | row.proposed_by === job.customer_id ? "poster" : "helpr" | row.proposed_by === job.customer_id ? "helpr" : "helpr"
 * @mutate src/lib/continueDayWords.ts |     if (row.proposer === "poster") { |     if (false) {
 * @mutate src/pages/jobs/jobPage/useContinueDayActions.tsx |     if (row?.status === "proposed" && row.proposer !== "poster") { |     if (row?.status === "proposed") {
 * @mutate src/pages/jobs/jobPage/useContinueDayActions.tsx |     if (row?.status === "proposed" && row.proposer === "poster") { |     if (false) {
 * @mutate src/components/jobs/ContinueDaySheet.tsx | {busy ? "Saving…" : `Send to ${other \|\| (poster ? "your Helpr" : "them")}`} | {busy ? "Saving…" : poster ? "Set the day" : `Send to ${other \|\| "them"}`}
 * @mutate src/lib/continueDayReads.ts | const CONTINUE_DAY_COLUMNS = "id, job_id, proposed_by, new_date, new_start_time, note, status, helper_confirmed_at, job:jobs(customer_id)"; | const CONTINUE_DAY_COLUMNS = "id, job_id, proposed_by, new_date, new_start_time, note, status, helper_confirmed_at";
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ContinueDay } from "@/lib/continueDayWords";
import { continueDayNextStep } from "@/lib/continueDayWords";
import { withProposer } from "@/lib/continueDayReads";
import { blankComments, blankSqlComments } from "@/test/helpers/blankNonCode";

const state: { row: ContinueDay | null; answers: Array<[string, boolean]> } = { row: null, answers: [] };
vi.mock("@/lib/continueDay", async (orig) => ({
  ...(await orig<typeof import("@/lib/continueDay")>()),
  fetchContinueDay: async () => state.row,
  answerContinueDay: async (id: string, accept: boolean) => { state.answers.push([id, accept]); },
}));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
import { useContinueDayActions } from "@/pages/jobs/jobPage/useContinueDayActions";
import { ContinueDaySheet } from "@/components/jobs/ContinueDaySheet";

Element.prototype.scrollTo ??= () => {};

const job = { id: "j1", status: "in_progress", is_group_job: false, has_active_dispute: false, helper_arrived_at: "2026-11-02T12:00:00Z", helper_completed_at: null };
const day = (over: Partial<ContinueDay> = {}): ContinueDay => ({
  id: "c1", job_id: "j1", proposed_by: "poster-1", new_date: "2099-11-05", new_start_time: "09:00:00", note: null,
  status: "proposed", helper_confirmed_at: null, proposer: "poster", ...over,
});
function run(side: "poster" | "helpr", other: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useContinueDayActions({ job, side, otherFirst: other, trackingStatus: "working", onChanged: () => {} }), { wrapper });
}

beforeEach(() => { state.row = null; state.answers = []; });

describe("Q2606 the row says who asked", () => {
  it("proposed_by is the job's poster: the poster asked; anyone else (or a gone account): the Helpr", () => {
    const base = { id: "c1", job_id: "j1", new_date: "2099-11-05", new_start_time: "09:00:00", note: null, status: "proposed" as const, helper_confirmed_at: null };
    expect(withProposer({ ...base, proposed_by: "p", job: { customer_id: "p" } }).proposer).toBe("poster");
    expect(withProposer({ ...base, proposed_by: "h", job: { customer_id: "p" } }).proposer).toBe("helpr");
    expect(withProposer({ ...base, proposed_by: null, job: { customer_id: "p" } }).proposer).toBe("helpr");
    expect(withProposer({ ...base, proposed_by: "p", job: { customer_id: "p" } })).not.toHaveProperty("job");
  });

  it("both reads ask for the job's poster with the row", () => {
    const src = blankComments(readFileSync("src/lib/continueDayReads.ts", "utf8"));
    expect(src).toContain('job:jobs(customer_id)"');
    expect(src.match(/\.select\(CONTINUE_DAY_COLUMNS\)/g)?.length).toBe(2);
    expect(src.match(/withProposer\(/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

describe("Q2606 the next-step lines", () => {
  it("the poster's ask: the Helpr's move, the poster waits on them", () => {
    expect(continueDayNextStep(day(), { side: "helpr", otherFirst: "Lexi" })).toEqual({ who: "you", text: "Accept Lexi's new day", by: "Thu 11/5 at 9 AM" });
    expect(continueDayNextStep(day(), { side: "poster", otherFirst: "Eli" })).toEqual({ who: "them", text: "You asked to finish Thu 11/5 at 9 AM", by: "waiting on Eli" });
  });
  it("the Helpr's ask: unchanged (the poster confirms)", () => {
    const h = day({ proposer: "helpr", proposed_by: "helpr-1" });
    expect(continueDayNextStep(h, { side: "poster", otherFirst: "Eli" })).toEqual({ who: "you", text: "Confirm Eli's new day", by: "Thu 11/5 at 9 AM" });
    expect(continueDayNextStep(h, { side: "helpr", otherFirst: "Lexi" })?.who).toBe("them");
  });
});

describe("Q2606 the job page's buttons", () => {
  it("the poster's ask: the Helpr gets Accept new day / Decline new day; the poster gets no Confirm", async () => {
    state.row = day();
    const h = run("helpr", "Lexi");
    await waitFor(() => expect(h.result.current.helprLead?.label).toBe("Accept new day"));
    expect(h.result.current.helprExtras.map((a) => a.label)).toEqual(["Decline new day"]);
    h.result.current.helprLead!.go();
    await waitFor(() => expect(state.answers).toEqual([["c1", true]]));
    const p = run("poster", "Eli");
    await waitFor(() => expect(p.result.current.row?.id).toBe("c1"));
    expect(p.result.current.posterLead).toBeUndefined();
    expect(p.result.current.posterExtras.map((a) => a.key)).not.toContain("continue-decline");
  });

  it("the Helpr's ask: the poster confirms, the Helpr has no Accept", async () => {
    state.row = day({ proposer: "helpr", proposed_by: "helpr-1" });
    const p = run("poster", "Eli");
    await waitFor(() => expect(p.result.current.posterLead?.label).toBe("Confirm new day"));
    const h = run("helpr", "Lexi");
    await waitFor(() => expect(h.result.current.row?.id).toBe("c1"));
    expect(h.result.current.helprLead).toBeNull();
  });
});

describe("Q2606 the poster's sheet sends, never sets", () => {
  it("'Send to Eli' and 'Eli confirms the day'", () => {
    render(<ContinueDaySheet open onOpenChange={() => {}} jobId="j1" side="poster" otherFirst="Eli" onSaved={() => {}} today={new Date(2026, 10, 1, 9, 0)} />);
    expect(screen.getByRole("button", { name: "Send to Eli" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Set the day" })).toBeNull();
    expect(screen.getByText("Eli confirms the day. The payment stays held until the work is done.")).toBeTruthy();
  });
});

describe("Q2606 the server half this copy matches", () => {
  it("the newest propose_job_continue_day makes every pick 'proposed'; answer lets only the other side answer", () => {
    const sql = blankSqlComments(readFileSync("supabase/migrations/20261102102402_poster_continue_day_goes_to_the_helpr.sql", "utf8"));
    expect(sql).toMatch(/v_status := 'proposed';/);
    expect(sql).toMatch(/v_answerer := CASE WHEN v_row\.proposed_by IS NOT NULL AND v_row\.proposed_by = v_job\.customer_id\s+THEN v_job\.helper_id ELSE v_job\.customer_id END;/);
    expect(sql).toMatch(/IF v_answerer IS NULL OR v_uid IS DISTINCT FROM v_answerer THEN\s+RAISE EXCEPTION 'not_authorized'/);
  });
});
