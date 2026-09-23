// adminAudit.logAdminAction is the audit-trail writer for every admin
// action. Bugs here lose accountability — an admin could ban a user,
// delete a job, override a status, and we'd have no record of who did it.
//
// The contract:
//  - silently no-op when no auth user (script context, signed-out admin)
//  - never throw to caller (audit logging must NEVER mask the action)
//  - write all 5 fields when provided

import { describe, it, expect, vi, beforeEach } from "vitest";

const insertMock = vi.fn();
const selectMock = vi.fn();
const fromMock = vi.fn();
const getUserMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: () => getUserMock() },
    from: (table: string) => fromMock(table),
  },
}));

const reportMock = vi.fn();
vi.mock("@/lib/errorLogger", () => ({
  report: (...args: unknown[]) => reportMock(...args),
}));

import { logAdminAction } from "./adminAudit";

beforeEach(() => {
  insertMock.mockReset();
  selectMock.mockReset();
  fromMock.mockReset();
  getUserMock.mockReset();
  reportMock.mockReset();
  fromMock.mockReturnValue({ insert: insertMock });
  insertMock.mockReturnValue({ select: selectMock });
  selectMock.mockResolvedValue({ data: [{ id: "audit-1" }], error: null });
});

describe("logAdminAction", () => {
  it("inserts a row with all 5 fields when called with full args", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1" } } });

    await logAdminAction("ban_user", "user", "target-1", { reason: "spam" });

    expect(fromMock).toHaveBeenCalledWith("admin_audit_log");
    expect(insertMock).toHaveBeenCalledWith({
      admin_id: "admin-1",
      action: "ban_user",
      target_type: "user",
      target_id: "target-1",
      details: { reason: "spam" },
    });
  });

  it("inserts with action only (target_type, target_id, details all undefined)", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1" } } });

    await logAdminAction("export_data");

    expect(insertMock).toHaveBeenCalledWith({
      admin_id: "admin-1",
      action: "export_data",
      target_type: undefined,
      target_id: undefined,
      details: undefined,
    });
  });

  it("silently no-ops when no auth user (signed-out / script context)", async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    await logAdminAction("anything");

    expect(insertMock).not.toHaveBeenCalled();
    // No error reported either — this is expected, not a failure
    expect(reportMock).not.toHaveBeenCalled();
  });

  it("does NOT throw when getUser rejects (audit logging must never mask the action)", async () => {
    getUserMock.mockRejectedValue(new Error("auth subsystem down"));

    await expect(logAdminAction("ban_user", "user", "target-1")).resolves.toBe(false);
    expect(reportMock).toHaveBeenCalledOnce();
    const [, opts] = reportMock.mock.calls[0];
    expect((opts as { tags: { source: string } }).tags.source).toBe("logAdminAction");
  });

  it("does NOT throw when insert errors (database hiccup must never mask the action)", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    selectMock.mockRejectedValue(new Error("RLS denied"));

    await expect(logAdminAction("delete_job", "job", "j1")).resolves.toBe(false);
    expect(reportMock).toHaveBeenCalledOnce();
  });

  it("REPORTS the error the insert RESOLVES with — a lost audit row must not be silent", async () => {
    // HOLLOW UNTIL 2026-09-21. supabase-js resolves `{ error }` instead of
    // throwing, so the surrounding try/catch never sees an RLS refusal — which
    // is exactly why `if (error) report(...)` exists. Every test above used the
    // beforeEach default `insertMock.mockResolvedValue({ data: null, error: null })`
    // or a REJECTION, so that line could be deleted with the file still green:
    // an admin could ban a user, the audit insert could be refused by RLS, and
    // nothing anywhere would say so.
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    selectMock.mockResolvedValue({
      data: null,
      error: { message: "new row violates row-level security policy", code: "42501" },
    });

    await expect(logAdminAction("ban_user", "user", "target-1")).resolves.toBe(false);

    expect(reportMock).toHaveBeenCalledOnce();
    const [err, opts] = reportMock.mock.calls[0];
    expect((err as { code?: string }).code).toBe("42501");
    // The source tag is how this is told apart from the getUser failure above —
    // one means "we never tried", the other means "we tried and were refused".
    expect((opts as { tags: { source: string } }).tags.source).toBe("logAdminAction.insert");
  });

  it("REPORTS a zero-row insert — an RLS refusal resolves { data: [], error: null } (Q76)", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    selectMock.mockResolvedValue({ data: [], error: null });

    await expect(logAdminAction("unban_user", "user", "target-1")).resolves.toBe(false);

    expect(selectMock).toHaveBeenCalledWith("id");
    expect(reportMock).toHaveBeenCalledOnce();
    const [, opts] = reportMock.mock.calls[0];
    expect((opts as { tags: { source: string } }).tags.source).toBe("logAdminAction.zeroRows");
  });

  it("resolves true when the row was written", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    await expect(logAdminAction("unban_user", "user", "target-1")).resolves.toBe(true);
    expect(reportMock).not.toHaveBeenCalled();
  });

  it("forwards complex details object verbatim", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1" } } });

    const details = {
      previous_status: "in_progress",
      new_status: "completed",
      override_reason: "Manual closeout — helper unreachable",
      affected_jobs: ["j1", "j2"],
    };

    await logAdminAction("status_override", "job", "j1", details);

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ details }),
    );
  });
});

// @mutate src/lib/adminAudit.ts | report(error, { tags: { source: "logAdminAction.insert" }, context: { action, targetType, targetId } }); | void error;
// @mutate src/lib/adminAudit.ts | if (!user) return false; | if (!user) { /* no-op */ }
// @mutate src/lib/adminAudit.ts | if (!data \|\| data.length === 0) { | if (false) {
