import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SignupLeadsCard } from "./SignupLeadsCard";

/**
 * Q1587 (owner 2026-10-11): the admin card for the sign-up leads. It reads
 * admin_list_signup_leads() and shows the count, each email, when it was
 * saved, whether the one reminder went, and whether the person finished.
 * A not-yet-deployed RPC (PGRST202) says so instead of reading as "no leads";
 * any other failure is an error with a retry, never an empty list.
 * Grant shape of the RPC: src/test/signupLeads.test.ts.
 *
 * @mutate src/components/admin/adminAnalytics/SignupLeadsCard.tsx | supabase.rpc("admin_list_signup_leads") | supabase.rpc("admin_list_signup_leads_x")
 * @mutate src/components/admin/adminAnalytics/SignupLeadsCard.tsx | {lead.reminder_sent_at ? `Reminded ${formatShortDate(lead.reminder_sent_at)}` : "Not reminded"} | {"Not reminded"}
 * @mutate src/components/admin/adminAnalytics/SignupLeadsCard.tsx | {lead.completed_at ? `Completed ${formatShortDate(lead.completed_at)}` : "Not completed"} | {"Not completed"}
 * @mutate src/components/admin/adminAnalytics/SignupLeadsCard.tsx | === "PGRST202") return { unavailable: true }; | === "never") return { unavailable: true };
 * @mutate src/components/admin/adminAnalytics/SignupLeadsCard.tsx | rows: (unwrap(res) ?? []) as SignupLead[] | rows: (res.data ?? []) as SignupLead[]
 */

const rpcResult = vi.hoisted(() => ({
  current: { data: null as unknown, error: null as unknown },
  calls: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string) => {
      rpcResult.calls.push(name);
      return rpcResult.current;
    },
  },
}));

const lead = (email: string, created: string, reminded: string | null, completed: string | null, total: number) => ({
  email,
  created_at: created,
  reminder_sent_at: reminded,
  completed_at: completed,
  total_count: total,
});

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SignupLeadsCard />
    </QueryClientProvider>,
  );
}

describe("SignupLeadsCard (Q1587)", () => {
  beforeEach(() => {
    rpcResult.current = { data: null, error: null };
    rpcResult.calls = [];
  });

  it("reads admin_list_signup_leads and shows the count, every email, and each lead's dates", async () => {
    rpcResult.current = {
      data: [
        lead("new@example.org", "2026-10-11T15:00:00Z", null, null, 3),
        lead("reminded@example.org", "2026-10-09T15:00:00Z", "2026-10-10T16:00:00Z", null, 3),
        lead("done@example.org", "2026-10-08T15:00:00Z", "2026-10-09T16:00:00Z", "2026-10-09T20:00:00Z", 3),
      ],
      error: null,
    };
    renderCard();
    expect(await screen.findByText("new@example.org")).toBeInTheDocument();
    expect(rpcResult.calls).toEqual(["admin_list_signup_leads"]);

    const leadsStat = screen.getByText("Leads").parentElement!;
    expect(within(leadsStat).getByText("3")).toBeInTheDocument();
    expect(within(screen.getByText("Reminded").parentElement!).getByText("2")).toBeInTheDocument();
    expect(within(screen.getByText("Completed").parentElement!).getByText("1")).toBeInTheDocument();

    const row = (email: string) => screen.getByText(email).closest("li")!;
    expect(within(row("new@example.org")).getByText("Not reminded")).toBeInTheDocument();
    expect(within(row("new@example.org")).getByText("Not completed")).toBeInTheDocument();
    expect(within(row("reminded@example.org")).getByText(/^Reminded Oct 10$/)).toBeInTheDocument();
    expect(within(row("done@example.org")).getByText(/^Completed Oct 9$/)).toBeInTheDocument();
    expect(within(row("done@example.org")).getByText(/^Saved Oct 8$/)).toBeInTheDocument();
  });

  it("no leads: a zero count and an empty state, not a blank card", async () => {
    rpcResult.current = { data: [], error: null };
    renderCard();
    expect(await screen.findByText("No sign-up leads yet")).toBeInTheDocument();
    expect(within(screen.getByText("Leads").parentElement!).getByText("0")).toBeInTheDocument();
  });

  it("the RPC not deployed yet (PGRST202) says so, never 'no leads'", async () => {
    rpcResult.current = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    renderCard();
    expect(await screen.findByText(/Not available yet/)).toBeInTheDocument();
    expect(screen.queryByText("No sign-up leads yet")).not.toBeInTheDocument();
  });

  it("any other failure (e.g. admin_only) is an error with a retry, never an empty list", async () => {
    rpcResult.current = { data: null, error: { code: "42501", message: "admin_only" } };
    renderCard();
    expect(await screen.findByText("Couldn't load sign-up leads")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText("No sign-up leads yet")).not.toBeInTheDocument();
  });

  it("shows the newest 10 first, and Show all reveals the rest", async () => {
    rpcResult.current = {
      data: Array.from({ length: 12 }, (_, i) => lead(`lead${i}@example.org`, `2026-10-${String(11 - (i % 9)).padStart(2, "0")}T12:00:00Z`, null, null, 12)),
      error: null,
    };
    renderCard();
    expect(await screen.findByText("lead0@example.org")).toBeInTheDocument();
    expect(screen.queryByText("lead11@example.org")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all 12" }));
    expect(screen.getByText("lead11@example.org")).toBeInTheDocument();
  });
});
