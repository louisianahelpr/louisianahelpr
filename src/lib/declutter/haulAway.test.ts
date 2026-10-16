/**
 * Declutter haul-away client (src/lib/declutter/haulAway.ts;
 * docs/specs/declutter-haul-away.md). The pure prefill: which rows can be
 * posted, the job's title/description/pay within the jobs table's limits, the
 * photos copied, one trip per pickup address. The RPC wrappers: a refusal
 * surfaces with its plain words on `userMessage`, never swallowed. The
 * Supabase client is a recording fake; the backend proof is
 * src/test/pglite/declutterHaulAway.pglite.mjs.
 *
 * @mutate src/lib/declutter/haulAwayParam.ts |   return row.state === "eligible" \|\| row.state === "unpaid"; |   return row.state !== "booked";
 * @mutate src/lib/declutter/haulAway.ts | const HAUL_AWAY_MIN_PAY_DOLLARS = 40; | const HAUL_AWAY_MIN_PAY_DOLLARS = 0;
 * @mutate src/lib/declutter/haulAway.ts |     photoPaths: [...firsts, ...rest].slice(0, JOB_PHOTO_MAX), |     photoPaths: [...rest, ...firsts],
 * @mutate src/lib/declutter/haulAwayParam.ts |   return [...new Set(ids)].slice(0, HAUL_AWAY_MAX_ITEMS); |   return ids;
 * @mutate src/lib/declutter/haulAway.ts |     if (msg && Object.isExtensible(e)) e.userMessage = msg; |     if (false) e.userMessage = msg;
 * @mutate src/lib/declutter/haulAwayParam.ts |   for (const g of groups.values()) if (g.length > best.length) best = g; |   for (const g of groups.values()) best = g;
 * @mutate src/lib/declutter/haulAway.ts |     if (!isNetworkFailure(err)) throw err; |     throw err;
 * @mutate src/lib/declutter/haulAway.ts |       await cancelHaulAway(id, jobId); |       await cancelHaulAway(id);
 * @mutate src/lib/declutter/haulAway.ts |   return (data ?? []).length > 0; |   return true;
 * @mutate src/lib/declutter/haulAwayParam.ts |   return row.job_id && row.job_hold === "job_open" ? row.job_id : null; |   return row.job_id ?? null;
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const queue: { data?: unknown; error?: unknown }[] = [];
  const rpcs: unknown[][] = [];
  const deletes: unknown[][] = [];
  const supabase = {
    rpc: (name: string, ...args: unknown[]) => {
      rpcs.push([name, ...args]);
      return Promise.resolve(queue.shift() ?? { data: null, error: null });
    },
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      const ops: unknown[] = [table];
      deletes.push(ops);
      for (const m of ["delete", "eq", "select"]) b[m] = (...a: unknown[]) => { ops.push([m, ...a]); return b; };
      b.then = (res: (v: unknown) => unknown) => Promise.resolve(queue.shift() ?? { data: [], error: null }).then(res);
      return b;
    },
  };
  return { queue, rpcs, deletes, supabase, removed: [] as string[] };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: h.supabase }));
vi.mock("@/lib/storageCleanup", () => ({ removeJobPhotos: async (id: string) => { h.removed.push(id); return 0; } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import {
  buildHaulAwayPrefill,
  cancelHaulAway,
  deleteNeverPaidHaulJob,
  haulJobToDelete,
  linkHaulAwayForJob,
  undoHaulAwayForJob,
  daysUntil,
  fetchHaulAwayState,
  haulAwayPayDollars,
  haulAwayPostJobPath,
  linkHaulAway,
  oneTripGroup,
  parseHaulAwayParam,
  type HaulAwayRow,
} from "./haulAway";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

const row = (over: Partial<HaulAwayRow>): HaulAwayRow => ({
  item_id: A,
  title: "Oak rocking chair",
  description: "",
  delivery_size: "large",
  item_status: "live",
  state: "eligible",
  eligible_at: null,
  job_id: null,
  pickup_group: "g1",
  photo_paths: [],
  job_hold: null,
  ...over,
});

beforeEach(() => {
  h.queue.length = 0;
  h.rpcs.length = 0;
  h.deletes.length = 0;
  h.removed.length = 0;
});

describe("parseHaulAwayParam / haulAwayPostJobPath", () => {
  it("keeps valid ids only, lower-cased, no repeats, at most 10", () => {
    expect(parseHaulAwayParam(null)).toEqual([]);
    expect(parseHaulAwayParam("nope, 1;drop")).toEqual([]);
    expect(parseHaulAwayParam(`${A},${A.toUpperCase()}, ${B}`)).toEqual([A, B]);
    const many = Array.from({ length: 12 }, (_, i) => `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`);
    expect(parseHaulAwayParam(many.join(","))).toHaveLength(10);
  });
  it("builds the Post a Job link", () => {
    expect(haulAwayPostJobPath([A, B])).toBe(`/post-job?haulAway=${A},${B}`);
  });
});

describe("haulAwayPayDollars (H4 default)", () => {
  it("adds the per-size pay, never under the trip minimum", () => {
    expect(haulAwayPayDollars(["small"])).toBe(40);
    expect(haulAwayPayDollars(["large", "xl"])).toBe(95);
    expect(haulAwayPayDollars(Array(30).fill("xl"))).toBe(1000);
  });
});

describe("buildHaulAwayPrefill", () => {
  it("is null when nothing can be posted", () => {
    expect(buildHaulAwayPrefill([])).toBeNull();
    expect(buildHaulAwayPrefill([row({ state: "booked" }), row({ state: "too_soon" }), row({ state: "in_sale" })])).toBeNull();
  });
  it("one item: its title, its size, the drop-off photo ask, the pay", () => {
    const p = buildHaulAwayPrefill([row({ title: "A very long oak rocking chair from grandma", photo_paths: ["a/1.jpg", "a/2.jpg"] })])!;
    expect(p.itemIds).toEqual([A]);
    expect(Array.from(p.title).length).toBeLessThanOrEqual(32);
    expect(p.title).toBe("Haul away: A very long oak");
    expect(p.description).toContain("donation center");
    expect(p.description).toContain("(large)");
    expect(p.description).toContain("photo when you drop off");
    expect(p.budget).toBe("40");
    expect(p.photoPaths).toEqual(["a/1.jpg", "a/2.jpg"]);
  });
  it("several: an unpaid earlier post counts, a booked one does not; first photos first, at most 5", () => {
    const p = buildHaulAwayPrefill([
      row({ item_id: A, delivery_size: "small", photo_paths: ["a/1", "a/2", "a/3"] }),
      row({ item_id: B, state: "unpaid", delivery_size: "xl", photo_paths: ["b/1", "b/2", "b/3"] }),
      row({ item_id: C, state: "booked", photo_paths: ["c/1"] }),
    ])!;
    expect(p.itemIds).toEqual([A, B]);
    expect(p.title).toBe("Haul away 2 items");
    expect(p.photoPaths).toEqual(["a/1", "b/1", "a/2", "a/3", "b/2"]);
    expect(p.budget).toBe("75");
    expect(p.description).toContain("extra large, needs two people");
  });
  it("never passes the jobs table's 1000-character description", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row({ item_id: `${i}`, title: "x".repeat(80) + " " + "y".repeat(80) }));
    expect(Array.from(buildHaulAwayPrefill(rows)!.description).length).toBeLessThanOrEqual(1000);
  });
});

describe("oneTripGroup", () => {
  it("offers the postable items at the address with the most of them", () => {
    const g = oneTripGroup([
      row({ item_id: A, pickup_group: "g1" }),
      row({ item_id: B, pickup_group: "g2" }),
      row({ item_id: C, pickup_group: "g2", state: "unpaid" }),
      row({ item_id: "d", pickup_group: "g2", state: "booked" }),
    ]);
    expect(g.map((r) => r.item_id)).toEqual([B, C]);
    expect(oneTripGroup([row({ state: "too_soon" })])).toEqual([]);
  });
});

describe("daysUntil", () => {
  it("rounds up, at least 1", () => {
    const now = Date.parse("2026-10-16T12:00:00Z");
    expect(daysUntil("2026-10-18T11:00:00Z", now)).toBe(2);
    expect(daysUntil("2026-10-16T11:00:00Z", now)).toBe(1);
    expect(daysUntil(null, now)).toBe(1);
  });
});

describe("RPC wrappers", () => {
  it("state: all items when no ids, the ids when given", async () => {
    h.queue.push({ data: [row({})] }, { data: [] });
    expect(await fetchHaulAwayState()).toHaveLength(1);
    await fetchHaulAwayState([A]);
    expect(h.rpcs).toEqual([["declutter_haul_away_state", {}], ["declutter_haul_away_state", { p_item_ids: [A] }]]);
  });
  it("link and undo send the right arguments and return the answer", async () => {
    h.queue.push({ data: 2 }, { data: "live" });
    expect(await linkHaulAway([A, B], "job1")).toBe(2);
    expect(await cancelHaulAway(A)).toBe("live");
    expect(h.rpcs).toEqual([
      ["declutter_link_haul_away", { p_item_ids: [A, B], p_job_id: "job1" }],
      ["declutter_cancel_haul_away", { p_item_id: A }],
    ]);
  });
  it("a refusal throws with the plain words", async () => {
    h.queue.push({ data: null, error: { message: "haul_away_in_sale", code: "22023" } });
    await expect(linkHaulAway([A], "job1")).rejects.toMatchObject({
      userMessage: "A buyer is getting this item, so it can't be hauled away.",
    });
    h.queue.push({ data: null, error: { message: "haul_away_not_found", code: "P0002" } });
    await expect(cancelHaulAway(A)).rejects.toMatchObject({ userMessage: "There's no haul-away to cancel on this item." });
    h.queue.push({ data: null, error: { message: "feature_disabled", code: "42501" } });
    await expect(fetchHaulAwayState()).rejects.toMatchObject({ userMessage: "Declutter isn't open for your account yet." });
  });
});

describe("booking helpers (reviews 2026-10-16)", () => {
  it("linkHaulAwayForJob asks once more when the answer was lost on the wire, never on a refusal", async () => {
    h.queue.push({ data: null, error: { message: "TypeError: Failed to fetch" } }, { data: 1 });
    expect(await linkHaulAwayForJob([A], "job1")).toBe(1);
    expect(h.rpcs).toHaveLength(2);
    h.rpcs.length = 0;
    h.queue.push({ data: null, error: { message: "haul_away_in_sale", code: "22023" } });
    await expect(linkHaulAwayForJob([A], "job1")).rejects.toMatchObject({ userMessage: expect.stringContaining("buyer") });
    expect(h.rpcs).toHaveLength(1);
  });
  it("undoHaulAwayForJob undoes each item for THAT job, skips 'nothing linked', counts real failures", async () => {
    h.queue.push({ data: "live" }, { data: null, error: { message: "haul_away_not_found" } }, { data: null, error: { message: "boom" } });
    expect(await undoHaulAwayForJob([A, B, C], "job1")).toBe(1);
    expect(h.rpcs).toEqual([
      ["declutter_cancel_haul_away", { p_item_id: A, p_job_id: "job1" }],
      ["declutter_cancel_haul_away", { p_item_id: B, p_job_id: "job1" }],
      ["declutter_cancel_haul_away", { p_item_id: C, p_job_id: "job1" }],
    ]);
  });
  it("deleteNeverPaidHaulJob removes the photos first and answers whether the job is gone", async () => {
    h.queue.push({ data: [{ id: "job1" }], error: null }, { data: [], error: null });
    expect(await deleteNeverPaidHaulJob("job1")).toBe(true);
    expect(h.removed).toEqual(["job1"]);
    expect(h.deletes[0]).toEqual(["jobs", ["delete"], ["eq", "id", "job1"], ["eq", "status", "open"], ["select", "id"]]);
    expect(await deleteNeverPaidHaulJob("job2")).toBe(false);
    h.queue.push({ data: null, error: { message: "denied" } });
    await expect(deleteNeverPaidHaulJob("job3")).rejects.toMatchObject({ message: "denied" });
  });
});

describe("haulJobToDelete (lh-money-escrow re-review #2)", () => {
  it("deletes only a never-paid job with no live checkout, never a cancelled or paying one", () => {
    expect(haulJobToDelete({ job_id: "j", job_hold: "job_open" })).toBe("j");
    for (const hold of ["none", "paying", "booked", "hauled", null] as const) {
      expect(haulJobToDelete({ job_id: "j", job_hold: hold })).toBeNull();
    }
    expect(haulJobToDelete({ job_id: null, job_hold: null })).toBeNull();
  });
});
