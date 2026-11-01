/**
 * JOBS-3 client (owner 2026-10-31 ~9:35 PM: crew members are paid individually once the poster confirms they
 * worked). The poster's crew roster offers "Confirm work" on a member who marked their part done; it asks first,
 * then calls rpc_poster_approve_member (20261101044659; server proof src/test/pglite/crewMemberPaidOnApproval.pglite.mjs)
 * and says the day they are paid. A confirmed member reads "Work confirmed".
 *
 * @mutate src/components/GroupJobHelpers.tsx |     !!h.helper_completed_at &&\n    h.poster_confirmed_completion_at === null && |     h.poster_confirmed_completion_at === null &&
 * @mutate src/components/GroupJobHelpers.tsx |               {workConfirmable(h) && ( |               {false && (
 * @mutate src/components/GroupJobHelpers.tsx |                   {h.status === "accepted" && h.poster_confirmed_completion_at\n                    ? "Work confirmed" |                   {false\n                    ? "Work confirmed"
 * @mutate src/lib/crewLifecycle.ts |     if (isMissingRpcNamed(error, "rpc_poster_approve_member")) { |     if (false) {
 * @mutate src/lib/crewLifecycle.ts |   if (!d \|\| d.helper_id !== memberId \|\| typeof d.payout_due_at !== "string" \|\| typeof d.approved_at !== "string") { |   if (!d) {
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock("@/lib/haptics", () => ({ hapticSuccess: vi.fn(), hapticError: vi.fn(), hapticMedium: vi.fn(), hapticLight: vi.fn(), hapticWarning: vi.fn() }));

const { GroupJobHelpers } = await import("@/components/GroupJobHelpers");
const { posterApproveMember, CREW_APPROVE_NOT_READY } = await import("@/lib/crewLifecycle");
const { supabase } = await import("@/integrations/supabase/client");
const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

const member = (over: Record<string, unknown> = {}) => ({
  id: "s1", helper_id: "m1", status: "accepted", helperName: "Hallie",
  helper_confirmed_at: "2032-10-29T12:00:00Z", helper_on_the_way_at: "2032-10-30T13:00:00Z", helper_arrived_at: "2032-10-30T14:00:00Z",
  poster_confirmed_arrival_at: "2032-10-30T14:05:00Z", helper_completed_at: "2032-10-30T17:00:00Z", poster_confirmed_completion_at: null, ...over,
});
const roster = (props: { isOwner?: boolean; jobStatus?: string; h?: Record<string, unknown> } = {}) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <GroupJobHelpers jobId="j" helpersNeeded={2} isOwner={props.isOwner ?? true} jobStatus={props.jobStatus ?? "in_progress"}
        initialHelpers={[member(props.h)]} dateNeeded="2032-10-30" startTime="09:00" />
    </QueryClientProvider>,
  );
const chip = () => screen.queryByRole("button", { name: /confirm hallie's work/i });

describe("the poster's crew roster offers Confirm work", () => {
  it("on a member who marked their part done; asks first; confirms through the RPC and names the pay day", async () => {
    rpc.mockResolvedValueOnce({ data: { helper_id: "m1", approved_at: "2032-10-30T18:00:00Z", payout_due_at: "2032-11-02T18:00:00Z" }, error: null });
    roster();
    expect(document.body.textContent).toContain("tap Confirm work and they're paid on their own 3 days later.");
    fireEvent.click(chip()!);
    expect(rpc).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: /^confirm work$/i }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("rpc_poster_approve_member", { _job_id: "j", _member_id: "m1" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Hallie's work is confirmed. They're paid on Tue, Nov 2."));
    expect(await screen.findByText("Work confirmed")).toBeInTheDocument();
    expect(chip()).toBeNull();
  });
  it.each([
    ["to anyone but the poster", { isOwner: false }],
    ["on a member not done yet", { h: { helper_completed_at: null } }],
    ["on a member already confirmed", { h: { poster_confirmed_completion_at: "2032-10-30T18:00:00Z" } }],
    ["when the row did not read the stamp", { h: { poster_confirmed_completion_at: undefined } }],
    ["on a finished job", { jobStatus: "completed" }],
  ])("never %s", (_w, props) => {
    roster(props as never);
    expect(chip()).toBeNull();
  });
});

describe("the client wrapper", () => {
  it("a body that does not name the member and the day is not an approval", async () => {
    rpc.mockResolvedValueOnce({ data: { helper_id: "m2", approved_at: "x", payout_due_at: "y" }, error: null });
    await expect(posterApproveMember("j", "m1")).rejects.toThrow(/returned no approval/);
    rpc.mockResolvedValueOnce({ data: { helper_id: "m1" }, error: null });
    await expect(posterApproveMember("j", "m1")).rejects.toThrow(/returned no approval/);
  });
  it("a refusal reads its copy; an RPC not deployed yet (PGRST202) says so", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "already_approved", code: "P0001" } });
    await expect(posterApproveMember("j", "m1")).rejects.toMatchObject({ copy: "You already confirmed this Helpr's work." });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "Could not find the function public.rpc_poster_approve_member(_job_id, _member_id) in the schema cache", code: "PGRST202" } });
    await expect(posterApproveMember("j", "m1")).rejects.toMatchObject({ copy: CREW_APPROVE_NOT_READY });
  });
});
