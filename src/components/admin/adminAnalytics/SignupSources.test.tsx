import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SignupSources } from "./SignupSources";

/**
 * OPS-5 (owner 10-29): Admin > Analytics shows which links bring sign-ups and first posts, from
 * admin_signup_source_report (20261031220447). A not-yet-deployed RPC (PGRST202) keeps the card out; any other
 * failure is an error with a retry, never an empty table.
 *
 * @mutate src/components/admin/adminAnalytics/SignupSources.tsx | supabase.rpc("admin_signup_source_report", { p_days: days }) | supabase.rpc("admin_signup_source_report", { p_days: 365 })
 * @mutate src/components/admin/adminAnalytics/SignupSources.tsx |       if (res.error && isMissingRpcNamed(res.error, "admin_signup_source_report")) return null; |
 * @mutate src/components/admin/adminAnalytics/SignupSources.tsx |   if (source === "direct") return "Direct (no link)"; |
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
  return render(
    <QueryClientProvider client={qc}>
      <SignupSources />
    </QueryClientProvider>,
  );
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
    expect(rows[1]).toHaveTextContent(/facebook\s*post-12\s*4\s*2/);
    expect(rows[2]).toHaveTextContent(/Direct \(no link\)\s*3\s*0/);
    expect(rpcResult.calls[0]).toEqual({ name: "admin_signup_source_report", args: { p_days: 30 } });
  });

  it("stays out while the function is not deployed yet (PGRST202)", async () => {
    rpcResult.current = {
      data: null,
      error: { code: "PGRST202", message: "Could not find the function public.admin_signup_source_report", hint: null },
    };
    const { container } = renderCard();
    await vi.waitFor(() => expect(rpcResult.calls).toHaveLength(1));
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("any other failure is an error with a retry, never an empty table", async () => {
    rpcResult.current = { data: null, error: { code: "42501", message: "admin only" } };
    renderCard();
    expect(await screen.findByText("Couldn't load sign-up sources")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
