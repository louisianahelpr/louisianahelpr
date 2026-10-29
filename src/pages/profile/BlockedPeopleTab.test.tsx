/**
 * A3-C16 (app audit 2026-10-29): there was no list of blocked people in
 * Settings; a member could unblock only from the blocked person's profile,
 * which the block itself hides. You › Settings › Your account › Blocked people
 * lists the member's own blocks by name, each with Unblock (useUnblock).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const ME = "me-1";
const db = vi.hoisted(() => ({
  blocks: [] as { blocker_id: string; blocked_id: string; created_at: string }[],
  eqs: [] as [string, string][],
}));
const unblockUser = vi.hoisted(() => vi.fn(async (blocker: string, blocked: string) => {
  db.blocks = db.blocks.filter((b) => !(b.blocker_id === blocker && b.blocked_id === blocked));
  return true;
}));

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: ME }, profile: null, isAdmin: false }) }));
vi.mock("@/lib/userBlocks", () => ({ unblockUser }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const filters: [string, string][] = [];
      const chain = {
        select: () => chain,
        eq: (col: string, val: string) => {
          filters.push([col, val]);
          db.eqs.push([col, val]);
          return chain;
        },
        order: () =>
          Promise.resolve({
            data: db.blocks.filter((b) => filters.every(([c, v]) => (b as Record<string, string>)[c] === v)),
            error: null,
          }),
      };
      return chain;
    },
    rpc: (_fn: string, args: { user_ids: string[] }) =>
      Promise.resolve({
        data: args.user_ids.filter((id) => id !== "gone-1").map((id) => ({ user_id: id, full_name: id === "hallie-1" ? "Hallie H." : "Sam S." })),
        error: null,
      }),
  },
}));

import BlockedPeopleTab from "./BlockedPeopleTab";

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BlockedPeopleTab onBack={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  db.eqs = [];
  db.blocks = [
    { blocker_id: ME, blocked_id: "hallie-1", created_at: "2026-10-28T00:00:00Z" },
    { blocker_id: ME, blocked_id: "gone-1", created_at: "2026-10-27T00:00:00Z" },
    // Someone else blocked ME: never listed as "my" block.
    { blocker_id: "sam-1", blocked_id: ME, created_at: "2026-10-26T00:00:00Z" },
  ];
  unblockUser.mockClear();
});
afterEach(cleanup);

describe("Settings › Blocked people", () => {
  it("lists only the people I blocked, by name, each with Unblock", async () => {
    renderTab();
    expect(await screen.findByText("Hallie H.")).toBeTruthy();
    expect(screen.getByText("A deleted account")).toBeTruthy();
    expect(screen.queryByText("Sam S.")).toBeNull();
    expect(db.eqs).toContainEqual(["blocker_id", ME]);
    expect(screen.getAllByRole("button", { name: /^Unblock / }).length).toBeGreaterThan(1);
  });

  it("Unblock removes the block and the row", async () => {
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Unblock Hallie H." }));
    await waitFor(() => expect(unblockUser).toHaveBeenCalledWith(ME, "hallie-1"));
    // The list re-read after the unblock: the other block is still there, Hallie's row is gone.
    await waitFor(() => {
      expect(screen.getByText("A deleted account")).toBeTruthy();
      expect(screen.queryByText("Hallie H.")).toBeNull();
    });
  });

  it("says how to block someone when the list is empty", async () => {
    db.blocks = [];
    renderTab();
    expect(await screen.findByText(/You haven't blocked anyone/)).toBeTruthy();
  });
});

// @mutate src/pages/profile/BlockedPeopleTab.tsx |       .eq("blocker_id", me) |       .eq("blocked_id", me)
// @mutate src/pages/profile/BlockedPeopleTab.tsx |   const { unblocking, handleUnblock } = useUnblock(me, person.id, blockedPeopleKey(me)); |   const { unblocking, handleUnblock } = useUnblock(me, null, blockedPeopleKey(me));
