// userBlocks.blockUser is the most consequential function here:
// blocking another user auto-cancels any active job between them
// and invokes void-cancelled-payments to refund. A bug that misses
// the cancellation step leaves a job running with someone the user
// just blocked — bad UX. A bug that misses the void invocation leaves
// money in escrow on a dead job — real money exposure.

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

  it("returns empty Set on error", async () => {
    fromMock.mockReturnValue({
      select: () => ({ or: blocksOrMock }),
    });
    blocksOrMock.mockResolvedValue({ data: null, error: new Error("RLS denied") });

    const result = await getBlockedUserIds("me");
    expect(result.size).toBe(0);
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

  it("auto-cancels active jobs between the two users + invokes void-cancelled-payments", async () => {
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

    // void-cancelled-payments invoked exactly once for the batch
    expect(invokeMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith("void-cancelled-payments", { body: {} });
  });

  it("does NOT invoke void-cancelled-payments when there are no active jobs", async () => {
    setupHappyPath({ activeJobs: [] });
    await blockUser("blocker", "blocked");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("reports (but does not throw) when void-cancelled-payments invocation fails", async () => {
    const activeJobs = [{ id: "job-1", customer_id: "blocker", helper_id: "blocked" }];
    setupHappyPath({ activeJobs });
    invokeMock.mockRejectedValue(new Error("function timeout"));

    const result = await blockUser("blocker", "blocked");
    // Block + cancel still considered successful even if refund invocation hiccups
    expect(result.ok).toBe(true);
    expect(result.cancelledJobIds).toEqual(["job-1"]);
    expect(reportMock).toHaveBeenCalledOnce();
    const [, opts] = reportMock.mock.calls[0];
    expect((opts as { tags: { source: string } }).tags.source).toBe("userBlocks.autoVoidAfterBlock");
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
