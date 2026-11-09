import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SignupSources, sourceLabel } from "./SignupSources";

/**
 * OPS-5 (owner 10-29): Admin > Analytics shows which links bring sign-ups and first posts, from
 * admin_signup_source_report (20261031220447). A not-yet-deployed RPC (PGRST202) keeps the card out; any other
 * failure is an error with a retry, never an empty table.
 *
 * @mutate src/components/admin/adminAnalytics/SignupSources.tsx | supabase.rpc("admin_signup_source_report", { p_days: days }) | supabase.rpc("admin_signup_source_report", { p_days: 365 })
 * @mutate src/components/admin/adminAnalytics/SignupSources.tsx |       if (res.error && isMissingRpcNamed(res.error, "admin_signup_source_report")) return null; |
 * @mutate src/components/admin/adminAnalytics/SignupSources.tsx |   direct: "Direct (no link)", |
 * @mutate src/components/admin/adminAnalytics/SignupSources.tsx |   "com.google.android.gm": "Gmail app", |
 * @mutate src/components/admin/adminAnalytics/SignupSources.tsx |   return SOURCE_NAMES[source] ?? source; |   return source;
 * @mutate src/components/admin/adminAnalytics/SignupSources.tsx | <td className="py-2.5 text-right tabular-nums">{r.first_posts}</td> | <td className="py-2.5 text-right tabular-nums">{r.signups}</td>
 */

const rpcResult = vi.hoisted(() => ({
  current: { data: null as unknown, error: null as unknown },
  calls: [] as Array<{ name: string; args: unknown }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string, args: unknown) => {
      rpcResult.calls.push({ name, args });
      return rpcResult.current;
    },
  },
}));

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return Object.assign(render(
    <QueryClientProvider client={qc}>
      <SignupSources />
    </QueryClientProvider>,
  ), { qc });
}

beforeEach(() => {
  rpcResult.calls = [];
  rpcResult.current = { data: null, error: null };
});

describe("Admin sign-up sources (OPS-5)", () => {
  it("lists each source and campaign with its sign-ups and first posts, for the last 30 days", async () => {
    rpcResult.current = {
      data: [
        { source: "facebook", campaign: "post-12", signups: 4, first_posts: 2 },
        { source: "direct", campaign: null, signups: 3, first_posts: 0 },
      ],
      error: null,
    };
    renderCard();
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent(/Facebook\s*post-12\s*4\s*2/);
    expect(rows[2]).toHaveTextContent(/Direct \(no link\)\s*3\s*0/);
    expect(rpcResult.calls[0]).toEqual({ name: "admin_signup_source_report", args: { p_days: 30 } });
  });

  // Owner's UI audit 11-09, F144: the card showed raw ids ("com.google.android.gm", "mail.google.com"). The five
  // sources prod held on 2026-11-09 (read-only count of member_signup_sources) each read as a name.
  it("shows names, not raw source ids (F144)", async () => {
    rpcResult.current = {
      data: [
        { source: "com.google.android.gm", campaign: null, signups: 1, first_posts: 0 },
        { source: "mail.google.com", campaign: null, signups: 1, first_posts: 0 },
        { source: "facebook.com", campaign: null, signups: 1, first_posts: 0 },
        { source: "www.google.com", campaign: null, signups: 1, first_posts: 0 },
        { source: "some-new-site.example", campaign: null, signups: 1, first_posts: 0 },
      ],
      error: null,
    };
    renderCard();
    const table = await screen.findByRole("table");
    const names = within(table).getAllByRole("row").slice(1).map((r) => r.querySelector("td span")?.textContent);
    expect(names).toEqual(["Gmail app", "Gmail (web)", "Facebook", "Google search", "some-new-site.example"]);
    // The raw id stays one hover away.
    expect(within(table).getByText("Gmail app").getAttribute("title")).toBe("com.google.android.gm");
    expect(sourceLabel("direct")).toBe("Direct (no link)");
  });

  it("stays out while the function is not deployed yet (PGRST202)", async () => {
    rpcResult.current = {
      data: null,
      error: { code: "PGRST202", message: "Could not find the function public.admin_signup_source_report", hint: null },
    };
    const { container, qc } = renderCard();
    // Wait for the DATA (the read settled to "not deployed" = null), then assert the card is out.
    await vi.waitFor(() => expect(qc.getQueryState(["admin", "signup-sources", 30])?.status).toBe("success"));
    expect(qc.getQueryData(["admin", "signup-sources", 30])).toBeNull();
    expect(rpcResult.calls).toHaveLength(1);
    expect(container).toBeEmptyDOMElement();
  });

  it("any other failure is an error with a retry, never an empty table", async () => {
    rpcResult.current = { data: null, error: { code: "42501", message: "admin only" } };
    renderCard();
    expect(await screen.findByText("Couldn't load sign-up sources")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
