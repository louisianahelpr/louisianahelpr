/**
 * NOID-23 (admin audit: "no filters"): the audit log can be read by who acted. "By an admin" shows only rows with an
 * admin; "Automatic" only rows with none (cron, service-role, migrations). Each chip states its count.
 *
 * @mutate src/components/admin/AdminAuditLog.tsx |   who === "all" \|\| (who === "people" ? !!e.admin_id : !e.admin_id); |   true;
 * @mutate src/components/admin/AdminAuditLog.tsx |           {entries.filter((e) => auditWhoMatches(who, e)).map(entry => { |           {entries.map(entry => {
 */
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const ADMIN = "11111111-0000-0000-0000-000000000001";
const rows = [
  { id: "a1", admin_id: ADMIN, action: "ban_user", target_type: "user", target_id: "u1", details: null, created_at: "2026-10-30T10:00:00Z" },
  { id: "a2", admin_id: null, action: "UPDATE", target_type: "payment_refunds", target_id: "r1", details: null, created_at: "2026-10-30T09:00:00Z" },
  { id: "a3", admin_id: null, action: "set_feature_switch", target_type: "feature_switch", target_id: "x", details: null, created_at: "2026-10-30T08:00:00Z" },
];
vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const op of ["select", "order", "limit", "in", "eq"]) b[op] = () => b;
    b.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: table === "profiles" ? [{ user_id: ADMIN, full_name: "Lexi Lombas" }] : rows, error: null }).then(resolve);
    return b;
  };
  return { supabase: { from: (t: string) => builder(t) } };
});

import AdminAuditLog from "./AdminAuditLog";

const badges = () => screen.queryAllByText(/^(Ban User|UPDATE|Update|Set Feature Switch)$/i).map((n) => n.textContent);

describe("NOID-23: the audit log filters by who acted", () => {
  it("All, By an admin, Automatic: each with its count, each showing only its rows", async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AdminAuditLog /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByRole("button", { name: "All (3)" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "By an admin (1)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Automatic (2)" })).toBeTruthy();
    expect(badges()).toHaveLength(3);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "By an admin (1)" })); });
    expect(badges()).toHaveLength(1);
    expect(screen.getByRole("button", { name: "By an admin (1)" }).getAttribute("aria-pressed")).toBe("true");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Automatic (2)" })); });
    expect(badges()).toHaveLength(2);
    expect(screen.queryByText("Lexi Lombas")).toBeNull();
  });
});
