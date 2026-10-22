/**
 * Q1803 (OWNER RULING 2026-10-21, COPPA): a birthday under 13 blocks and
 * deletes the account. This file pins the two shared halves:
 *   - isUnder13 (_shared/under13Age.ts): the America/Chicago calendar date,
 *     the 13th birthday itself is NOT under 13, Feb 29 clamps like Postgres;
 *   - deleteUnder13Account (_shared/under13.ts): the normal accountPurge path
 *     then auth.admin.deleteUser; with money in flight the account is locked,
 *     its personal fields blanked and ONE admin alert sent (stamped
 *     under_13_waiting_since), and a later run does nothing and alerts nothing
 *     (lead, 2026-10-21: never an alert every 5 minutes).
 *
 * @mutate supabase/functions/_shared/under13Age.ts |   return thirteenth > chicagoToday(now); |   return thirteenth >= chicagoToday(now);
 * @mutate supabase/functions/_shared/under13Age.ts | String(Math.min(d, lastDay)) | String(d)
 * @mutate supabase/functions/_shared/under13Age.ts |   if (isFutureBirthday(dob, now)) return false; |
 * @mutate supabase/functions/_shared/under13.ts |     if (row?.under_13_waiting_since) return { status: "waiting_on_money", reason, firstTime: false }; |
 * @mutate supabase/functions/_shared/under13.ts |     await alert(userId, reason);\n    return { status: "waiting_on_money", reason, firstTime: true }; |     return { status: "waiting_on_money", reason, firstTime: true };
 * @mutate supabase/functions/_shared/under13.ts |   if (active.active) { |   if (false) {
 * @mutate supabase/functions/_shared/under13.ts |     return purge.reason === "rpc_not_deployed" |     return false
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const purgeState = {
  pages: { ok: true } as { ok: boolean; detail?: string },
  active: { ok: true, active: false } as { ok: boolean; active: boolean; reason?: string },
  purge: { ok: true, steps: [] } as { ok: boolean; steps: unknown[]; reason?: string },
  calls: [] as string[],
};
vi.mock("../../../supabase/functions/_shared/accountPurge.ts", () => ({
  closeUnpaidShopPages: async () => { purgeState.calls.push("closeUnpaidShopPages"); return purgeState.pages; },
  findActiveWork: async () => { purgeState.calls.push("findActiveWork"); return purgeState.active; },
  purgeAccount: async () => { purgeState.calls.push("purgeAccount"); return purgeState.purge; },
}));
vi.mock("../../../supabase/functions/_shared/slack-alerts.ts", () => ({ postSlackOpsAlert: vi.fn(async () => true) }));

// Imported by computed path: the app's tsc must not follow these Deno modules into accountPurge.
const AGE = "../../../supabase/functions/_shared/under13Age";
const DEL = "../../../supabase/functions/_shared/under13";
const { isUnder13 } = (await import(/* @vite-ignore */ AGE)) as { isUnder13: (dob: unknown, now?: Date) => boolean };
const { deleteUnder13Account } = (await import(/* @vite-ignore */ DEL)) as {
  // deno-lint-ignore no-explicit-any
  deleteUnder13Account: (admin: any, userId: string, alert: (u: string, r: string) => Promise<void>) => Promise<Record<string, unknown>>;
};
/** The personal fields blanked while an account waits on money (none a payout or refund reads). */
const BLANKED = {
  date_of_birth: null, phone: null, bio: null, location: null, zip_code: null, latitude: null, longitude: null,
  avatar_url: null, portfolio_urls: null, business_name: null, emergency_contact_name: null, emergency_contact_phone: null,
  extra_comments: null, tools_equipment: null, transportation: null, hear_about_us: null, skills: null,
};

/** Noon Chicago on a given day: safely inside that calendar date. */
const on = (ymd: string) => new Date(`${ymd}T17:00:00Z`);

describe("isUnder13: the America/Chicago calendar date", () => {
  it("the day before the 13th birthday is under 13; the birthday itself is not", () => {
    expect(isUnder13("2013-10-22", on("2026-10-21"))).toBe(true);
    expect(isUnder13("2013-10-21", on("2026-10-21"))).toBe(false);
    expect(isUnder13("1990-01-01", on("2026-10-21"))).toBe(false);
  });

  it("reads the date in Chicago: 11:30 PM Chicago on the eve is still the eve", () => {
    // 2026-10-21 04:30Z = 2026-10-20 23:30 CDT: the 13th birthday (Oct 21) has not come yet.
    expect(isUnder13("2013-10-21", new Date("2026-10-21T04:30:00Z"))).toBe(true);
    expect(isUnder13("2013-10-21", new Date("2026-10-21T05:30:00Z"))).toBe(false);
  });

  it("a Feb 29 birthday turns 13 on Feb 28 in a non-leap year, as Postgres's interval does", () => {
    expect(isUnder13("2012-02-29", on("2025-02-28"))).toBe(false);
    expect(isUnder13("2012-02-29", on("2025-02-27"))).toBe(true);
  });

  it("a birthday after today is a typo, never a child: not under 13", () => {
    expect(isUnder13("2026-10-22", on("2026-10-21"))).toBe(false);
    expect(isUnder13("2030-01-01", on("2026-10-21"))).toBe(false);
    expect(isUnder13("2026-10-21", on("2026-10-21"))).toBe(true);
  });

  it("anything that is not a date answers false (complete-signup refuses it as invalid on its own)", () => {
    for (const v of [null, undefined, 20130101, "", "soon", "2013-13-01", "2013-00-10"]) expect(isUnder13(v, on("2026-10-21"))).toBe(false);
  });
});

/** A service-role client double recording profile updates. */
function fakeAdmin(waitingSince: string | null = null) {
  const updates: Record<string, unknown>[] = [];
  const deleted: string[] = [];
  const admin = {
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      let pending: Record<string, unknown> | null = null;
      b.select = () => b;
      b.update = (p: Record<string, unknown>) => { pending = p; return b; };
      b.eq = () => {
        if (pending) { updates.push({ table, ...pending }); pending = null; return Promise.resolve({ error: null }); }
        return b;
      };
      b.maybeSingle = () => Promise.resolve({ data: { under_13_waiting_since: waitingSince }, error: null });
      return b;
    },
    auth: { admin: { deleteUser: async (id: string) => { deleted.push(id); return { error: null }; } } },
  };
  return { admin, updates, deleted };
}

describe("deleteUnder13Account", () => {
  beforeEach(() => {
    purgeState.pages = { ok: true };
    purgeState.active = { ok: true, active: false };
    purgeState.purge = { ok: true, steps: [] };
    purgeState.calls = [];
  });

  it("no money in flight: accountPurge, then the auth user is deleted", async () => {
    const { admin, deleted, updates } = fakeAdmin();
    const alert = vi.fn(async () => {});
    const out = await deleteUnder13Account(admin, "u-1", alert);
    expect(out).toEqual({ status: "deleted" });
    expect(purgeState.calls).toEqual(["closeUnpaidShopPages", "findActiveWork", "purgeAccount"]);
    expect(deleted).toEqual(["u-1"]);
    expect(updates).toEqual([]);
    expect(alert).not.toHaveBeenCalled();
  });

  it("money in flight, first time: locked, personal fields blanked, ONE alert; nothing deleted", async () => {
    purgeState.active = { ok: true, active: true, reason: "job" };
    const { admin, deleted, updates } = fakeAdmin(null);
    const alert = vi.fn(async () => {});
    const out = await deleteUnder13Account(admin, "u-2", alert);
    expect(out).toEqual({ status: "waiting_on_money", reason: "job", firstTime: true });
    expect(deleted).toEqual([]);
    expect(purgeState.calls).not.toContain("purgeAccount");
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ ...BLANKED, table: "profiles" });
    expect(updates[0].under_13_blocked_at).toBeTruthy();
    expect(updates[0].under_13_waiting_since).toBeTruthy();
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith("u-2", "job");
  });

  it("money still in flight on a later run: nothing written, no alert", async () => {
    purgeState.active = { ok: true, active: true, reason: "money_owed" };
    const { admin, deleted, updates } = fakeAdmin("2026-10-21T00:00:00Z");
    const alert = vi.fn(async () => {});
    const out = await deleteUnder13Account(admin, "u-3", alert);
    expect(out).toEqual({ status: "waiting_on_money", reason: "money_owed", firstTime: false });
    expect(updates).toEqual([]);
    expect(deleted).toEqual([]);
    expect(alert).not.toHaveBeenCalled();
  });

  it("purge_user_data not deployed yet is a deferral, not a fault; a real purge failure is a failure", async () => {
    const alert = vi.fn(async () => {});
    purgeState.purge = { ok: false, steps: [], reason: "rpc_not_deployed" };
    let f = fakeAdmin();
    expect((await deleteUnder13Account(f.admin, "u-4", alert)).status).toBe("deferred");
    expect(f.deleted).toEqual([]);
    purgeState.purge = { ok: false, steps: [], reason: "storage_failed" };
    f = fakeAdmin();
    expect(await deleteUnder13Account(f.admin, "u-4", alert)).toEqual({ status: "failed", detail: "purge: storage_failed" });
    expect(f.deleted).toEqual([]);
  });

  it("an unreadable account state fails closed (no delete)", async () => {
    purgeState.active = { ok: false, active: false };
    const f = fakeAdmin();
    expect((await deleteUnder13Account(f.admin, "u-5", vi.fn(async () => {}))).status).toBe("failed");
    expect(f.deleted).toEqual([]);
  });
});
