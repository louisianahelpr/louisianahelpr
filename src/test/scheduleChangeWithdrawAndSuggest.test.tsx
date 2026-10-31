/**
 * Board 66/172 slice 3 (owner default 6, 2026-10-21): whoever asked to move a booked job can take the request back
 * while it is pending (withdraw_job_schedule_change), and whoever is asked can answer with another time ("Suggest
 * another time" opens the same ask, which replaces the request and tells them). Behaviour on the server:
 * src/test/pglite/withdrawJobScheduleChange.pglite.mjs. Also pins the Q2291 request-time address rule
 * (src/test/pglite/detailChangeAddressInLouisiana.pglite.mjs).
 */
// @mutate src/components/schedule/ScheduleChangeControl.tsx |             Withdraw request |             Keep request
// @mutate src/components/schedule/ScheduleChangeControl.tsx |                 const s = await withdrawScheduleChange(pending.id); |                 const s = "withdrawn";
// @mutate src/components/schedule/ScheduleChangeControl.tsx |               Suggest another time |               Another day
// @mutate src/components/schedule/ScheduleChangeControl.tsx |       {(!hideAsk \|\| askedOfMe) && ( |       {!hideAsk && (
// @mutate supabase/migrations/20261021110847_withdraw_job_schedule_change.sql |   IF v_uid IS DISTINCT FROM v_req.requested_by\n |   IF false\n
// @mutate supabase/migrations/20261021111244_detail_change_address_in_louisiana.sql |   BEFORE INSERT ON public.job_detail_change_requests |   BEFORE UPDATE ON public.job_detail_change_requests
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { triggerInventory } from "./helpers/migrationTriggers";

const state = vi.hoisted(() => ({ pending: null as null | Record<string, unknown>, withdrawn: [] as string[] }));
vi.mock("@/lib/scheduleChange", () => ({
  fetchPendingScheduleChange: async () => state.pending,
  requestScheduleChange: vi.fn(),
  respondScheduleChange: vi.fn(),
  withdrawScheduleChange: vi.fn(async (id: string) => { state.withdrawn.push(id); return "withdrawn"; }),
}));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());

import { ScheduleChangeControl } from "@/components/schedule/ScheduleChangeControl";

const ME = "me";
const req = (requestedBy: string, responder: string) => ({
  id: "r1", job_id: "j1", requested_by: requestedBy, responder_id: responder, old_date: "2037-10-22", old_start_time: "09:00:00",
  new_date: "2037-10-23", new_start_time: "14:00:00", status: "pending", expires_at: "2037-10-22T14:00:00Z",
});
async function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><ScheduleChangeControl jobId="j1" jobTitle="Mow" userId={ME} dateNeeded="2037-10-22" startTime="09:00" hideAsk /></QueryClientProvider>);
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe("a pending date or time request (board 66/172 slice 3)", () => {
  beforeEach(() => { state.withdrawn = []; });

  it("the person who asked can withdraw it", async () => {
    state.pending = req(ME, "other");
    await show();
    fireEvent.click(await screen.findByRole("button", { name: "Withdraw request" }));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(state.withdrawn).toEqual(["r1"]);
    expect(screen.queryByRole("button", { name: "Suggest another time" })).toBeNull();
  });

  it("the person asked can suggest another time; it opens the ask even where the card draws its own", async () => {
    state.pending = req("other", ME);
    await show();
    expect(screen.queryByRole("button", { name: "Withdraw request" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Suggest another time" }));
    expect(await screen.findByText(/New date or time for "Mow"/)).toBeTruthy();
  });
});

describe("the server rules behind it", () => {
  const MIG = join(process.cwd(), "supabase/migrations");
  it("withdraw_job_schedule_change only lets the asker take a pending request back", () => {
    const body = (effectiveDefs(MIG).get("withdraw_job_schedule_change")?.stmt ?? "").replace(/\s+/g, " ");
    expect(body).toContain("IF v_uid IS DISTINCT FROM v_req.requested_by");
    expect(body).toContain("IF v_req.status <> 'pending' THEN");
    expect(body).toContain("SET status = 'withdrawn'");
  });
  it("an out-of-state address is refused when a detail change is ASKED (Q2291)", () => {
    const inv = triggerInventory(migrationFiles(MIG).map((name) => ({ name, sql: readFileSync(join(MIG, name), "utf8") })));
    const t = inv.get("job_detail_change_requests.trg_detail_change_address_in_louisiana");
    expect(t?.timing).toBe("BEFORE");
    expect(t?.events).toMatch(/INSERT/);
  });
});
