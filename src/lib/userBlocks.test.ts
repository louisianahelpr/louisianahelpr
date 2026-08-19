// userBlocks.blockUser is the most consequential function here:
// blocking another user auto-cancels any active job between them.
// A bug that misses the cancellation step leaves a job running with
// someone the user just blocked — bad UX. Escrow on those cancelled
// jobs is refunded by the void-cancelled-payments cron (which sweeps
// every cancelled + escrow job), NOT by a client invoke — a user JWT
// can't authorize that function, so blockUser never calls it.

import { describe, it, expect, vi, beforeEach } from "vitest";

// Builders for chained query mocks. Supabase's pseudo-fluent API needs
// each chain step to return an object with the next method.
const insertMock = vi.fn();
const updateEqMock = vi.fn();
const updateMock = vi.fn((_payload: Record<string, unknown>) => ({ eq: updateEqMock }));
const selectOrInMock = vi.fn();
const selectOrMock = vi.fn(() => ({ in: selectOrInMock }));
const selectMock = vi.fn(() => ({ or: selectOrMock }));
const blocksOrMock = vi.fn();
const blocksSelectMock = vi.fn(() => ({ or: blocksOrMock }));
const deleteEqEqMock = vi.fn();
const deleteEqMock = vi.fn(() => ({ eq: deleteEqEqMock }));
const deleteMock = vi.fn(() => ({ eq: deleteEqMock }));
const fromMock = vi.fn();
const rpcMock = vi.fn();
const invokeMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => fromMock(table),
    rpc: (...args: unknown[]) => rpcMock(...args),
    functions: {
      invoke: (...args: unknown[]) => invokeMock(...args),
    },
  },
}));

const reportMock = vi.fn();
vi.mock("@/lib/errorLogger", () => ({
  report: (...args: unknown[]) => reportMock(...args),
}));

import { getBlockedUserIds, areUsersBlocked, blockUser, unblockUser } from "./userBlocks";

beforeEach(() => {
  fromMock.mockReset();
  insertMock.mockReset();
  updateEqMock.mockReset();
  updateMock.mockClear();
  selectOrInMock.mockReset();
  selectOrMock.mockClear();
  selectMock.mockClear();
  blocksOrMock.mockReset();
  blocksSelectMock.mockClear();
  deleteEqEqMock.mockReset();
  deleteEqMock.mockClear();
  deleteMock.mockClear();
  rpcMock.mockReset();
  invokeMock.mockReset();
  reportMock.mockReset();
});

describe("getBlockedUserIds", () => {
  it("returns Set of users blocked-by-or-blocking the current user (bidirectional)", async () => {
    fromMock.mockReturnValue({
      select: () => ({ or: blocksOrMock }),
    });
    blocksOrMock.mockResolvedValue({
      data: [
        { blocker_id: "me", blocked_id: "alice" },
        { blocker_id: "bob", blocked_id: "me" },
      ],
      error: null,
    });

    const result = await getBlockedUserIds("me");
    expect(result.has("alice")).toBe(true);
    expect(result.has("bob")).toBe(true);
    expect(result.size).toBe(2);
  });

  it("THROWS on error — must fail closed, not open", async () => {
    // This test used to assert `result.size === 0`, i.e. it encoded the bug as
    // the contract. An empty set reads as "nobody is blocked", so any failed
    // read — an RLS denial, a network blip — silently un-blocked every
    // harassment block the user had set, and blocked people reappeared in the
    // inbox, the nav badge, the applicant list and the desktop rail.
    fromMock.mockReturnValue({
      select: () => ({ or: blocksOrMock }),
    });
    blocksOrMock.mockResolvedValue({ data: null, error: new Error("RLS denied") });

    await expect(getBlockedUserIds("me")).rejects.toThrow("RLS denied");
  });

  it("returns empty Set when no blocks exist", async () => {
    fromMock.mockReturnValue({
      select: () => ({ or: blocksOrMock }),
    });
    blocksOrMock.mockResolvedValue({ data: [], error: null });

    const result = await getBlockedUserIds("me");
    expect(result.size).toBe(0);
  });
});

describe("areUsersBlocked", () => {
  it("returns true when RPC returns true", async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    expect(await areUsersBlocked("a", "b")).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("are_users_blocked", { _user_a: "a", _user_b: "b" });
  });

  it("returns false when RPC returns false", async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });
    expect(await areUsersBlocked("a", "b")).toBe(false);
  });

  it("returns false on RPC error", async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error("rpc failed") });
    expect(await areUsersBlocked("a", "b")).toBe(false);
  });
});

describe("blockUser", () => {
  function setupHappyPath({ activeJobs = [] }: { activeJobs?: unknown[] } = {}) {
    fromMock.mockImplementation((table: string) => {
      if (table === "user_blocks") {
        return { insert: insertMock, delete: deleteMock };
      }
      if (table === "jobs") {
        return {
          select: () => ({ or: () => ({ in: () => Promise.resolve({ data: activeJobs, error: null }) }) }),
          update: updateMock,
        };
      }
      return {};
    });
    insertMock.mockResolvedValue({ error: null });
    updateEqMock.mockResolvedValue({ error: null });
    invokeMock.mockResolvedValue({ data: {}, error: null });
  }

  it("inserts a user_blocks row with reason", async () => {
    setupHappyPath();
    const result = await blockUser("blocker", "blocked", "Harassment");
    expect(result.ok).toBe(true);
    expect(insertMock).toHaveBeenCalledWith({
      blocker_id: "blocker",
      blocked_id: "blocked",
      reason: "Harassment",
    });
  });

  it("inserts with reason=null when none provided", async () => {
    setupHappyPath();
    await blockUser("blocker", "blocked");
    expect(insertMock).toHaveBeenCalledWith({
      blocker_id: "blocker",
      blocked_id: "blocked",
      reason: null,
    });
  });

  it("treats duplicate-block (idempotent) as success, not error", async () => {
    setupHappyPath();
    insertMock.mockResolvedValue({ error: { message: "duplicate key value violates unique constraint" } });
    const result = await blockUser("blocker", "blocked");
    expect(result.ok).toBe(true);
  });

  it("returns ok=false with error when insert fails for a non-duplicate reason", async () => {
    setupHappyPath();
    insertMock.mockResolvedValue({ error: { message: "RLS denied" } });
    const result = await blockUser("blocker", "blocked");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("RLS denied");
  });

  it("auto-cancels active jobs between the two users (refund left to the cron)", async () => {
    const activeJobs = [
      { id: "job-1", title: "Yard", customer_id: "blocker", helper_id: "blocked", status: "accepted" },
      { id: "job-2", title: "Move", customer_id: "blocked", helper_id: "blocker", status: "in_progress" },
    ];
    setupHappyPath({ activeJobs });

    const result = await blockUser("blocker", "blocked");
    expect(result.ok).toBe(true);
    expect(result.cancelledJobIds).toEqual(["job-1", "job-2"]);

    // Each job got a status='cancelled' update
    expect(updateMock).toHaveBeenCalledTimes(2);
    const firstUpdateCall = updateMock.mock.calls[0][0];
    expect(firstUpdateCall.status).toBe("cancelled");
    expect(firstUpdateCall.cancelled_by).toBe("blocker");
    expect(firstUpdateCall.cancellation_reason).toMatch(/blocked/i);
    expect(firstUpdateCall.cancellation_fee).toBe(0);

    // blockUser must NOT call void-cancelled-payments — a user JWT can't
    // authorize it (guaranteed 401); the cron handles escrow instead.
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("never invokes void-cancelled-payments, even with no active jobs", async () => {
    setupHappyPath({ activeJobs: [] });
    await blockUser("blocker", "blocked");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("reports (but does not throw) when a job fails to cancel", async () => {
    const activeJobs = [{ id: "job-1", customer_id: "blocker", helper_id: "blocked" }];
    setupHappyPath({ activeJobs });
    updateEqMock.mockResolvedValue({ error: { message: "RLS denied" } });

    const result = await blockUser("blocker", "blocked");
    // Block itself still succeeds; the un-cancelled job is reported, not silent.
    expect(result.ok).toBe(true);
    expect(result.cancelledJobIds).toEqual([]);
    expect(reportMock).toHaveBeenCalledOnce();
    const [, opts] = reportMock.mock.calls[0];
    expect((opts as { tags: { source: string } }).tags.source).toBe("userBlocks.autoCancelJob");
  });

  it("reports (but does not throw) when the active-jobs lookup fails", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "user_blocks") return { insert: insertMock, delete: deleteMock };
      if (table === "jobs") {
        return {
          select: () => ({ or: () => ({ in: () => Promise.resolve({ data: null, error: { message: "RLS denied" } }) }) }),
          update: updateMock,
        };
      }
      return {};
    });
    insertMock.mockResolvedValue({ error: null });

    const result = await blockUser("blocker", "blocked");
    expect(result.ok).toBe(true);
    expect(result.cancelledJobIds).toEqual([]);
    expect(reportMock).toHaveBeenCalledOnce();
    const [, opts] = reportMock.mock.calls[0];
    expect((opts as { tags: { source: string } }).tags.source).toBe("userBlocks.activeJobsLookup");
  });
});

describe("unblockUser", () => {
  it("deletes the block row and returns true on success", async () => {
    fromMock.mockReturnValue({ delete: deleteMock });
    deleteEqEqMock.mockResolvedValue({ error: null });

    const result = await unblockUser("blocker", "blocked");
    expect(result).toBe(true);
    expect(fromMock).toHaveBeenCalledWith("user_blocks");
    expect(deleteEqMock).toHaveBeenCalledWith("blocker_id", "blocker");
    expect(deleteEqEqMock).toHaveBeenCalledWith("blocked_id", "blocked");
  });

  it("returns false on delete error", async () => {
    fromMock.mockReturnValue({ delete: deleteMock });
    deleteEqEqMock.mockResolvedValue({ error: new Error("RLS denied") });

    expect(await unblockUser("blocker", "blocked")).toBe(false);
  });
});

