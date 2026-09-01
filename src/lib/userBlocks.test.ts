// userBlocks.blockUser is the most consequential function here: blocking
// another user settles any live job between them.
//
// It is now a single server-owned RPC (block_user_and_settle). The client used
// to insert the block and then write `jobs` itself — cancellation_fee: 0,
// cancellation_fee_status: null, and no consequence ladder — which made
// "block the Helpr" a one-tap late cancel with no strike. These tests pin the
// two properties that matter: the client never writes `jobs` in this path, and
// an RPC failure fails CLOSED rather than falling back to the old client cancel.
//
// Escrow is still settled by the void-cancelled-payments cron (which sweeps
// every cancelled + escrow job and recomputes the fee from trusted job
// fields), NOT by a client invoke — a user JWT can't authorize that function.
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
const deleteSelectMock = vi.fn();
// The delete chain now ends in `.select("id")` — a DELETE that matches zero
// rows is `{ data: [], error: null }`, so the row count has to come back.
const deleteEqEqMock = vi.fn(() => ({ select: deleteSelectMock }));
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
  deleteSelectMock.mockReset();
  deleteEqEqMock.mockClear();
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
  // blockUser no longer touches `jobs` at all. The whole gesture — block +
  // settle every live shared job through the real cancellation rules + record
  // the strike — is one server-owned RPC, so these tests assert the call and
  // the failure handling, not a client-side cancel sequence.
  it("calls block_user_and_settle with the target and trimmed reason", async () => {
    rpcMock.mockResolvedValue({ data: { blocked: "blocked", settled: [] }, error: null });
    const result = await blockUser("blocker", "blocked", "  Harassment  ");
    expect(result.ok).toBe(true);
    expect(rpcMock).toHaveBeenCalledWith("block_user_and_settle", {
      p_blocked: "blocked",
      p_reason: "Harassment",
    });
  });

  it("sends reason=null when none is provided", async () => {
    rpcMock.mockResolvedValue({ data: { settled: [] }, error: null });
    await blockUser("blocker", "blocked");
    expect(rpcMock).toHaveBeenCalledWith("block_user_and_settle", {
      p_blocked: "blocked",
      p_reason: null,
    });
  });

  it("returns the settled job ids the server reports", async () => {
    rpcMock.mockResolvedValue({
      data: {
        settled: [
          { job_id: "job-1", title: "Yard", cancellation_fee: 50, fee_percent: 25 },
          { job_id: "job-2", title: "Move", cancellation_fee: 0, fee_percent: 0 },
        ],
      },
      error: null,
    });
    const result = await blockUser("blocker", "blocked");
    expect(result.cancelledJobIds).toEqual(["job-1", "job-2"]);
    expect(result.settled[0].cancellation_fee).toBe(50);
  });

  it("never writes the jobs table itself", async () => {
    rpcMock.mockResolvedValue({ data: { settled: [] }, error: null });
    await blockUser("blocker", "blocked");
    expect(fromMock).not.toHaveBeenCalledWith("jobs");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("never invokes void-cancelled-payments (a user JWT can't authorize it)", async () => {
    rpcMock.mockResolvedValue({ data: { settled: [] }, error: null });
    await blockUser("blocker", "blocked");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("fails closed on RPC error and does NOT fall back to a client-side cancel", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "RLS denied", code: "42501" } });
    const result = await blockUser("blocker", "blocked");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("RLS denied");
    expect(fromMock).not.toHaveBeenCalledWith("jobs");
    expect(reportMock).toHaveBeenCalledOnce();
    const [, opts] = reportMock.mock.calls[0];
    expect((opts as { tags: { source: string } }).tags.source).toBe("userBlocks.blockUserAndSettle");
  });

  it("explains the merge-to-deploy window on PGRST202 instead of a raw error", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "Could not find the function", code: "PGRST202" },
    });
    const result = await blockUser("blocker", "blocked");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/deploying/i);
  });
});
describe("unblockUser", () => {
  it("deletes the block row and returns true on success", async () => {
    fromMock.mockReturnValue({ delete: deleteMock });
    deleteSelectMock.mockResolvedValue({ data: [{ id: "block-1" }], error: null });

    const result = await unblockUser("blocker", "blocked");
    expect(result).toBe(true);
    expect(fromMock).toHaveBeenCalledWith("user_blocks");
    expect(deleteEqMock).toHaveBeenCalledWith("blocker_id", "blocker");
    expect(deleteEqEqMock).toHaveBeenCalledWith("blocked_id", "blocked");
    // Without this the row count is invisible and a zero-row delete reads as success.
    expect(deleteSelectMock).toHaveBeenCalledWith("id");
  });

  it("returns false on delete error", async () => {
    fromMock.mockReturnValue({ delete: deleteMock });
    deleteSelectMock.mockResolvedValue({ data: null, error: new Error("RLS denied") });

    expect(await unblockUser("blocker", "blocked")).toBe(false);
  });

  // The whole point of the .select("id"): PostgREST answers a DELETE that
  // matched nothing with `{ data: [], error: null }`. This used to return true
  // — "unblocked!" over a block that is still in force.
  it("returns false when the delete matched zero rows", async () => {
    fromMock.mockReturnValue({ delete: deleteMock });
    deleteSelectMock.mockResolvedValue({ data: [], error: null });

    expect(await unblockUser("blocker", "blocked")).toBe(false);
  });
});
