import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { SignupLeadsCard, leadStatus, type SignupLead } from "./SignupLeadsCard";

/**
 * Q1587: the owner can see the sign-up leads. The card reads
 * admin_signup_leads() and shows the count, how many were reminded and how many
 * signed up, and each email with where it stands; a failed read is an error
 * state, never "No sign-up leads saved". It is mounted on Analytics under
 * Funnels & Retention. Grant shape: src/test/signupLeads.test.ts.
 *
 * @mutate src/components/admin/adminAnalytics/SignupLeadsCard.tsx | queryFn: async () => (unwrap(await supabase.rpc("admin_signup_leads")) ?? []) as SignupLead[], | queryFn: async () => ((await supabase.rpc("admin_signup_leads")).data ?? []) as SignupLead[],
 * @mutate src/components/admin/adminAnalytics/FunnelsAndRetention.tsx |       <SignupLeadsCard />\n | \n
 * @mutate src/components/admin/adminAnalytics/SignupLeadsCard.tsx |   if (l.completed_at) return "Signed up"; |   if (false) return "Signed up";
 */

const rpcResult = vi.hoisted(() => ({ current: { data: null as unknown, error: null as unknown } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: async (name: string) => (name === "admin_signup_leads" ? rpcResult.current : { data: null, error: null }) },
}));

const lead = (over: Partial<SignupLead>): SignupLead => ({
  email: "a@example.com",
  source: "signup",
  created_at: "2026-10-10T15:00:00Z",
  reminder_sent_at: null,
  completed_at: null,
  unsubscribed_at: null,
  ...over,
});

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SignupLeadsCard />
    </QueryClientProvider>,
  );
}

describe("Sign-up Leads card (Q1587)", () => {
  beforeEach(() => {
    rpcResult.current = { data: [], error: null };
  });

  it("shows the totals and each lead with where it stands", async () => {
    rpcResult.current = {
      data: [
        lead({ email: "done@example.com", reminder_sent_at: "2026-10-11T15:00:00Z", completed_at: "2026-10-11T18:00:00Z" }),
        lead({ email: "reminded@example.com", reminder_sent_at: "2026-10-11T15:00:00Z" }),
        lead({ email: "new@example.com" }),
      ],
      error: null,
    };
    renderCard();
    const summary = await screen.findByTestId("signup-leads-summary");
    expect(summary.textContent).toBe("3 saved · 2 reminded · 1 signed up");
    expect(screen.getByText("done@example.com")).toBeInTheDocument();
    expect(screen.getByText("Signed up")).toBeInTheDocument();
    expect(screen.getByText("Reminded")).toBeInTheDocument();
    expect(screen.getByText("Waiting")).toBeInTheDocument();
  });

  it("a failed read is an error state, not an empty list", async () => {
    rpcResult.current = { data: null, error: { message: "permission denied", code: "42501" } };
    renderCard();
    expect(await screen.findByText("We couldn't load the sign-up leads.")).toBeInTheDocument();
    expect(screen.queryByText("No sign-up leads saved")).not.toBeInTheDocument();
  });

  it("no leads reads as empty", async () => {
    renderCard();
    expect(await screen.findByText("No sign-up leads saved")).toBeInTheDocument();
  });

  it("status: completed wins, then unsubscribed, then reminded", () => {
    expect(leadStatus(lead({ completed_at: "x", unsubscribed_at: "x", reminder_sent_at: "x" }))).toBe("Signed up");
    expect(leadStatus(lead({ unsubscribed_at: "x", reminder_sent_at: "x" }))).toBe("Unsubscribed");
    expect(leadStatus(lead({ reminder_sent_at: "x" }))).toBe("Reminded");
    expect(leadStatus(lead({}))).toBe("Waiting");
  });

  it("Analytics mounts it under Funnels & Retention", () => {
    const page = readFileSync("src/components/admin/AdminAnalytics.tsx", "utf8");
    expect(page).toMatch(/<FunnelsAndRetention customerFunnel=/);
    const src = readFileSync("src/components/admin/adminAnalytics/FunnelsAndRetention.tsx", "utf8");
    const at = src.indexOf("<SectionLabel>Funnels &amp; Retention</SectionLabel>");
    expect(at).toBeGreaterThan(0);
    expect(src.indexOf("<SignupLeadsCard />", at)).toBeGreaterThan(at);
  });
});
