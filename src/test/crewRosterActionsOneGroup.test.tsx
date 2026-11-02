/**
 * A3-34 (audit 11-01): the poster's crew roster buttons. The Helpr is told the poster taps "Confirm they've arrived"
 * (CrewMemberSection), but the roster's button said "Confirm Arrived" (title case, a name that did not exist). And at
 * 375 the green step wrapped to its own line on the LEFT while Message stayed right; at 1440 Message sat mid-row on
 * one member and far right on the next. Each row's actions are now one right-aligned group: Message first, the green
 * step last.
 *
 * @mutate src/components/GroupJobHelpers.tsx | label={confirmingId === h.id ? "Confirming…" : "Confirm they've arrived"} | label={confirmingId === h.id ? "Confirming…" : "Confirm Arrived"}
 * @mutate src/components/GroupJobHelpers.tsx | <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2" data-crew-actions=""> | <div className="contents">
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));
vi.mock("@/lib/haptics", () => ({ hapticSuccess: vi.fn(), hapticError: vi.fn(), hapticMedium: vi.fn(), hapticLight: vi.fn(), hapticWarning: vi.fn() }));

const { GroupJobHelpers } = await import("@/components/GroupJobHelpers");

const member = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, helper_id: `h-${id}`, status: "accepted", helperName: name,
  helper_confirmed_at: "2032-10-29T12:00:00Z", helper_on_the_way_at: "2032-10-30T13:00:00Z", helper_arrived_at: "2032-10-30T14:00:00Z",
  poster_confirmed_arrival_at: null, helper_completed_at: null, poster_confirmed_completion_at: null, ...over,
});

describe("the crew roster's buttons (A3-34)", () => {
  it("each row: one action group, Message first and the green step last, named as the Helpr is told", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <GroupJobHelpers jobId="j" helpersNeeded={2} isOwner jobStatus="in_progress" dateNeeded="2032-10-30" startTime="09:00"
          onMessage={() => {}}
          initialHelpers={[
            member("a", "Yusef"),
            member("b", "Marcus", { poster_confirmed_arrival_at: "2032-10-30T14:05:00Z", poster_confirmed_working_at: "2032-10-30T14:05:00Z", helper_completed_at: "2032-10-30T17:00:00Z" }),
          ]} />
      </QueryClientProvider>,
    );
    const rows = [...document.querySelectorAll<HTMLElement>("[data-crew-member]")];
    expect(rows.length).toBeGreaterThan(1);
    const labels = rows.map((r) => [...(r.querySelector("[data-crew-actions]")?.querySelectorAll("button") ?? [])].map((b) => b.textContent?.trim()));
    expect(labels[0]).toEqual(["Message", "Confirm they've arrived"]);
    expect(labels[1]).toEqual(["Message", "Confirm work"]);
    expect(document.body.textContent).not.toMatch(/Confirm Arrived/);
  });
});
