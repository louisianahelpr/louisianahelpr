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
  fromMock.mockReset();
  getUserMock.mockReset();
  reportMock.mockReset();
  fromMock.mockReturnValue({ insert: insertMock });
  insertMock.mockResolvedValue({ data: null, error: null });
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

    await expect(logAdminAction("ban_user", "user", "target-1")).resolves.toBeUndefined();
    expect(reportMock).toHaveBeenCalledOnce();
    const [, opts] = reportMock.mock.calls[0];
    expect((opts as { tags: { source: string } }).tags.source).toBe("logAdminAction");
  });

  it("does NOT throw when insert errors (database hiccup must never mask the action)", async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    insertMock.mockRejectedValue(new Error("RLS denied"));

    await expect(logAdminAction("delete_job", "job", "j1")).resolves.toBeUndefined();
    expect(reportMock).toHaveBeenCalledOnce();
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
