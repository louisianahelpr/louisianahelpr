/**
 * The audit log shows what real admins and real automation did (Admin M1, M2).
 *
 * THE BUG (measured on prod 2026-10-30): of the newest 200 rows, 155 were system
 * UPDATEs of user_bans; of 1126 such rows in 30 days 1096 were about test accounts
 * and 561 changed nothing but updated_at. 200 rows was all the screen could read,
 * with no filter. 11 of 33 job_status_override rows were an admin moving their own
 * job, shown as an override.
 *
 * @mutate src/components/admin/adminAuditLog/auditRows.ts |   keys.delete("updated_at"); |
 * @mutate src/components/admin/adminAuditLog/auditRows.ts | if (filter.actor === "system" && row.admin_id) return false; |
 * @mutate src/components/admin/adminAuditLog/auditRows.ts | if (filter.kind !== "all" && auditKind(row) !== filter.kind) return false; |
 * @mutate src/components/admin/AdminAuditLog.tsx |     if (isNoOpAudit(e)) return false; |
 * @mutate src/components/admin/AdminAuditLog.tsx | return !(about.users.some((id) => seedUsers.has(id)) | return !(false
 * @mutate src/components/admin/AdminAuditLog.tsx |       \|\| about.jobs.some((id) => jobs.get(id)?.is_seed === true) |
 * @mutate src/components/admin/AdminAuditLog.tsx |       \|\| about.items.some((id) => seedItems.has(id))); |       );
 * @mutate src/components/admin/AdminAuditLog.tsx | more: data.length === PAGE_SIZE, | more: false,
 * @mutate src/components/admin/AdminAuditLog.tsx | if (before) query = query.lt("created_at", before); |
 * @mutate src/components/admin/AdminAuditLog.tsx | const rows = shown.map(e => | const rows = loaded.map(e =>
 * @mutate src/components/admin/AdminAuditLog.tsx | {entry.own_job ? "Own job" : formatCategory(entry.action)} | {formatCategory(entry.action)}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => {
  const rows: Record<string, Record<string, unknown>[]> = {};
  const lts: string[] = [];
  const save = vi.fn().mockResolvedValue(undefined);
  const builder = (table: string) => {
    let out = [...(rows[table] ?? [])];
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.order = () => b;
    b.limit = (n: number) => { out = out.slice(0, n); return b; };
    b.lt = (col: string, v: string) => {
      lts.push(v);
      out = (rows[table] ?? []).filter((r) => String(r[col]) < v);
      return b;
    };
    b.in = (col: string, ids: string[]) => { out = out.filter((r) => ids.includes(String(r[col]))); return b; };
    b.eq = (col: string, v: unknown) => { out = out.filter((r) => r[col] === v); return b; };
    b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: out, error: null }).then(res);
    return b;
  };
  return { rows, lts, save, supabase: { from: builder } };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: h.supabase }));
vi.mock("@/lib/fileExport", () => ({ saveOrShareFile: h.save }));

import AdminAuditLog from "../AdminAuditLog";
import { auditKind, auditMatches, auditSubjects, isNoOpAudit, type AuditRow } from "./auditRows";

const ADMIN = "aaaaaaaa-0000-4000-8000-000000000001";
const REAL = "bbbbbbbb-0000-4000-8000-000000000001";
const TEST_USER = "cccccccc-0000-4000-8000-000000000001";
const JOB = "dddddddd-0000-4000-8000-000000000001";
const SEED_JOB = "dddddddd-0000-4000-8000-000000000002";
const SEED_ITEM = "eeeeeeee-0000-4000-8000-000000000002";

const row = (over: Partial<AuditRow>): AuditRow => ({
  id: crypto.randomUUID(), admin_id: ADMIN, action: "ban_user", target_type: "user", target_id: REAL,
  details: null, created_at: "2026-10-30T12:00:00Z", ...over,
});

describe("isNoOpAudit", () => {
  const update = (o: object, n: object) => row({ action: "UPDATE", target_type: "user_bans", details: { op: "UPDATE", old: { ...o }, new: { ...n } } as never });

  it("an update of only updated_at did nothing", () => {
    expect(isNoOpAudit(update({ a: 1, updated_at: "x" }, { a: 1, updated_at: "y" }))).toBe(true);
  });
  it("any other change counts", () => {
    expect(isNoOpAudit(update({ a: 1, updated_at: "x" }, { a: 2, updated_at: "y" }))).toBe(false);
  });
  it("a column present on one side only counts", () => {
    expect(isNoOpAudit(update({ a: 1 }, { a: 1, b: 2 }))).toBe(false);
  });
  it("only an UPDATE with both snapshots can be one", () => {
    expect(isNoOpAudit(row({ action: "INSERT", details: { old: {}, new: {} } as never }))).toBe(false);
    expect(isNoOpAudit(row({ action: "UPDATE", details: { new: { a: 1 } } as never }))).toBe(false);
    expect(isNoOpAudit(row({ action: "UPDATE", details: null }))).toBe(false);
  });
});

describe("auditSubjects", () => {
  it("reads the people in a trigger's snapshots, and not the actor", () => {
    const s = auditSubjects(row({ target_type: "user_bans", target_id: null, details: { old: { user_id: TEST_USER }, new: { user_id: TEST_USER, job_id: JOB } } as never }));
    expect(s.users).toContain(TEST_USER);
    expect(s.users).not.toContain(ADMIN);
    expect(s.jobs).toEqual([JOB]);
  });
  it("a target that is not an id is skipped, so one row never breaks the page's read", () => {
    expect(auditSubjects(row({ target_type: "user", target_id: "declutter_seller_delivery" })).users).toEqual([]);
    expect(auditSubjects(row({ target_type: "job", target_id: "nope" })).jobs).toEqual([]);
  });
});

describe("auditKind", () => {
  it.each([
    [{ action: "UPDATE", target_type: "payout_transfers" }, "money"],
    [{ action: "job_admin_refund", target_type: "job" }, "money"],
    [{ action: "job_status_override", target_type: "job" }, "jobs"],
    [{ action: "ban_user", target_type: "user" }, "people"],
    [{ action: "UPDATE", target_type: "user_bans" }, "people"],
    [{ action: "declutter_listing_approved", target_type: "declutter_item" }, "declutter"],
    [{ action: "set_feature_switch", target_type: "feature_switch" }, "settings"],
    [{ action: "support_reply", target_type: "report" }, "support"],
    [{ action: "something_new", target_type: null }, "other"],
  ])("%j is %s", (over, want) => {
    expect(auditKind(row(over))).toBe(want);
  });
});

describe("auditMatches", () => {
  const all = { kind: "all", actor: "anyone", search: "" } as const;
  it("who did it", () => {
    expect(auditMatches(row({ admin_id: null }), { ...all, actor: "admin" }, null)).toBe(false);
    expect(auditMatches(row({ admin_id: null }), { ...all, actor: "system" }, null)).toBe(true);
    expect(auditMatches(row({}), { ...all, actor: "system" }, null)).toBe(false);
  });
  it("the kind", () => {
    expect(auditMatches(row({}), { ...all, kind: "people" }, null)).toBe(true);
    expect(auditMatches(row({}), { ...all, kind: "money" }, null)).toBe(false);
  });
  it("the search reads the name, the action in words, the id and the summary", () => {
    const r = { ...row({}), admin_name: "Lexi" };
    expect(auditMatches(r, { ...all, search: " lexi " }, null)).toBe(true);
    expect(auditMatches(r, { ...all, search: "ban user" }, null)).toBe(true);
    expect(auditMatches(r, { ...all, search: REAL.slice(0, 8) }, null)).toBe(true);
    expect(auditMatches(r, { ...all, search: "spam" }, "reason: spam")).toBe(true);
    expect(auditMatches(r, { ...all, search: "zzz" }, null)).toBe(false);
  });
});

describe("the screen", () => {
  const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const show = () => render(<QueryClientProvider client={client()}><AdminAuditLog /></QueryClientProvider>);

  beforeEach(() => {
    h.lts.length = 0;
    h.save.mockClear();
    h.rows.profiles = [
      { user_id: ADMIN, full_name: "Real Admin", is_seed: false },
      { user_id: REAL, full_name: "Real Member", is_seed: false },
      { user_id: TEST_USER, full_name: "Test", is_seed: true },
    ];
    h.rows.jobs = [
      { id: JOB, is_seed: false, customer_id: ADMIN, helper_id: REAL },
      { id: SEED_JOB, is_seed: true, customer_id: REAL, helper_id: null },
    ];
    h.rows.declutter_items = [{ id: SEED_ITEM, is_seed: true }];
    h.rows.admin_audit_log = [
      row({ action: "ban_user", details: { reason: "real ban" } as never, created_at: "2026-10-30T12:00:06Z" }),
      row({ admin_id: null, action: "UPDATE", target_type: "user_bans", target_id: "x", details: { op: "UPDATE", old: { user_id: TEST_USER, is_active: true }, new: { user_id: TEST_USER, is_active: false } } as never, created_at: "2026-10-30T12:00:05Z" }),
      row({ admin_id: null, action: "UPDATE", target_type: "user_bans", target_id: "x", details: { op: "UPDATE", old: { user_id: REAL, reason: "no-op row", updated_at: "1" }, new: { user_id: REAL, reason: "no-op row", updated_at: "2" } } as never, created_at: "2026-10-30T12:00:04Z" }),
      row({ action: "job_admin_refund", target_type: "job", target_id: SEED_JOB, details: { reason: "seed job row" } as never, created_at: "2026-10-30T12:00:03Z" }),
      row({ action: "declutter_listing_approved", target_type: "declutter_item", target_id: SEED_ITEM, details: { reason: "seed item row" } as never, created_at: "2026-10-30T12:00:02Z" }),
      row({ action: "job_status_override", target_type: "job", target_id: JOB, details: { from_status: "open", to_status: "accepted", job_title: "own hire" } as never, created_at: "2026-10-30T12:00:01Z" }),
    ];
  });

  it("leaves out test data and no-ops, keeps real rows", async () => {
    show();
    expect(await screen.findByText("reason: real ban")).toBeInTheDocument();
    expect(screen.queryByText(/TEST_USER|is_active/)).toBeNull();
    expect(screen.queryByText(/no-op row/)).toBeNull();
    expect(screen.queryByText(/seed job row/)).toBeNull();
    expect(screen.queryByText(/seed item row/)).toBeNull();
    expect(screen.getByText(/Last 2 admin actions/)).toBeInTheDocument();
  });

  it("an admin's status change on their own job reads as their own, not an override", async () => {
    show();
    expect(await screen.findByText("Own job")).toBeInTheDocument();
    expect(screen.queryByText(/job status override/i)).toBeNull();
  });

  it("the search narrows the list, and the export takes what is shown", async () => {
    show();
    await screen.findByText("reason: real ban");
    fireEvent.change(screen.getByLabelText("Search the audit log"), { target: { value: "own hire" } });
    await waitFor(() => expect(screen.queryByText("reason: real ban")).toBeNull());
    expect(screen.getByText(/open → accepted/)).toBeInTheDocument();
    expect(screen.getByText(/1 of the 2 loaded/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Export CSV/ }));
    const csv = await (h.save.mock.calls[0][0].blob as Blob).text();
    expect(csv).toContain("own hire");
    expect(csv).not.toContain("real ban");
  });

  it("no match says so", async () => {
    show();
    await screen.findByText("reason: real ban");
    fireEvent.change(screen.getByLabelText("Search the audit log"), { target: { value: "zzzz" } });
    expect(await screen.findByText("Nothing loaded matches these filters.")).toBeInTheDocument();
  });

  it("a full page offers more, even when every row on it was test data, and asks for older rows", async () => {
    const base = Date.parse("2026-10-30T12:00:00Z");
    const churn = Array.from({ length: 200 }, (_, i) => row({
      admin_id: null, action: "UPDATE", target_type: "user_bans", target_id: "x",
      details: { old: { user_id: TEST_USER, a: 1 }, new: { user_id: TEST_USER, a: 2 } } as never,
      created_at: new Date(base - i * 1000).toISOString(),
    }));
    const older = row({ details: { reason: "older real ban" } as never, created_at: "2026-10-01T00:00:00Z" });
    h.rows.admin_audit_log = [...churn, older];
    show();
    const more = await screen.findByRole("button", { name: "Load more" });
    expect(screen.queryByText("reason: older real ban")).toBeNull();
    fireEvent.click(more);
    expect(await screen.findByText("reason: older real ban")).toBeInTheDocument();
    expect(h.lts).toEqual([churn[199].created_at]);
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
});
