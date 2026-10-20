/*
 * GUARD: Declutter test items cannot be left on prod, and the cleanup cannot
 * touch anything but the run's own unsold test item.
 *
 * WHY (reds2 lane, 2026-10-20): prod held "Fixture rocking chair / side table
 * [E2E-PRODAUDIT]" items from four timed-out prod-audit legs (the final attempt
 * never reaches test.afterAll) and a live "Payout proof lamp" from a failed
 * payout-proof run. Both now clean up after themselves: the prod-audit sweeper
 * (an if: always() step) and the payout proof's finally/unlink. The cleanup is
 * service-role, so it is gated by declutterItemMatches (marker, named test
 * seller, is_seed, a status no buyer holds) and never removes an item with an order.
 */
// @mutate scripts/lib/declutterItemCleanup.mjs | "&is_seed=is.true" + |
// @mutate scripts/lib/declutterItemCleanup.mjs | item.is_seed === true && | true &&
// @mutate scripts/lib/declutterItemCleanup.mjs | item.title.includes(marker) && | true &&
// @mutate scripts/lib/declutterItemCleanup.mjs | sellerIds.includes(item.seller_id) && | true &&
// @mutate scripts/lib/declutterItemCleanup.mjs | SWEEPABLE_ITEM_STATUSES.includes(item.status) | true
// @mutate scripts/lib/declutterItemCleanup.mjs | export const SWEEPABLE_ITEM_STATUSES = ["draft", "pending_review", "live"]; | export const SWEEPABLE_ITEM_STATUSES = ["draft", "pending_review", "live", "reserved", "completed"];
// @mutate scripts/lib/declutterItemCleanup.mjs |  && !storagePath.includes("..") |
// @mutate scripts/lib/declutterItemCleanup.mjs | del.rows?.length !== 1 | del.rows?.length < 0
// @mutate scripts/e2e/declutterPayoutProof.mjs | if (state.orderId) return log( | if (false) return log(
// @mutate scripts/e2e/declutterPayoutProof.mjs | if (orders.length) return log( | if (false) return log(
// @mutate scripts/e2e/declutterPayoutProof.mjs | if (!declutterItemMatches(item, | if (false && !declutterItemMatches(item,
// @mutate scripts/e2e/declutterPayoutProof.mjs | await removeUnsoldItem(c, state).catch( | await Promise.resolve(c, state).catch(
// @mutate scripts/e2e/prod-audit-sweeper.mjs | const declutterFailures = await sweepDeclutterItems({ base, headers, get }); | const declutterFailures = [];
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import {
  SWEEPABLE_ITEM_STATUSES,
  candidateDeclutterItemsQuery,
  declutterItemMatches,
  photoPathBelongsTo,
  removeDeclutterItemsRest,
  // @ts-expect-error - plain .mjs tool script, no types
} from "../../scripts/lib/declutterItemCleanup.mjs";
// @ts-expect-error - plain .mjs tool script, no types
import { DECLUTTER_SELLER_IDS, HELPER_ID, JOB_TITLE_MARKER, declutterCandidatesQuery, declutterMatches, sweepDeclutterItems } from "../../scripts/e2e/prod-audit-sweeper.mjs";
// @ts-expect-error - plain .mjs tool script, no types
import { removeUnsoldItem } from "../../scripts/e2e/declutterPayoutProof.mjs";

const ROOT = join(__dirname, "..", "..");
const ITEM = "7c1a7b4c-ab65-46fb-adbd-0afafbe2734a";
const SELLER = "7b923b19-aba5-44cb-8730-8c33ba2b9321";
const item = (o: Record<string, unknown> = {}) => ({ id: ITEM, title: "Fixture rocking chair [E2E-PRODAUDIT]", seller_id: SELLER, is_seed: true, status: "live", ...o });
const gate = (i: unknown) => declutterItemMatches(i, { marker: "E2E-PRODAUDIT", sellerIds: [SELLER] }) as boolean;

afterEach(() => vi.unstubAllGlobals());

describe("declutter cleanup: what may be touched", () => {
  it("accepts the run's own unsold seeded item", () => {
    expect(gate(item())).toBe(true);
    for (const status of SWEEPABLE_ITEM_STATUSES) expect(gate(item({ status }))).toBe(true);
  });

  it("inventory floor: three unsold statuses, none a buyer's", () => {
    expect([...SWEEPABLE_ITEM_STATUSES].sort()).toEqual(["draft", "live", "pending_review"]);
  });

  it("refuses a real seller, a non-seed row, another title, a bad id and any buyer-held status", () => {
    expect(gate(item({ seller_id: "00000000-0000-4000-8000-000000000000" }))).toBe(false);
    expect(gate(item({ is_seed: false }))).toBe(false);
    expect(gate(item({ is_seed: null }))).toBe(false);
    expect(gate(item({ title: "Vintage lamp" }))).toBe(false);
    expect(gate(item({ id: "not-a-uuid" }))).toBe(false);
    for (const status of ["reserved", "completed", "sold", "removed", "cancelled"]) expect(gate(item({ status }))).toBe(false);
    expect(declutterItemMatches(item(), { marker: "", sellerIds: [SELLER] })).toBe(false);
  });

  it("the query pre-filters on the same conditions", () => {
    const q = candidateDeclutterItemsQuery("E2E-PRODAUDIT", [SELLER]) as string;
    expect(q).toContain("is_seed=is.true");
    expect(q).toContain(encodeURIComponent("*E2E-PRODAUDIT*"));
    expect(q).toContain(encodeURIComponent(`(${SELLER})`));
    expect(q).toContain(encodeURIComponent("(draft,pending_review,live)"));
  });

  it("a photo path counts only under the seller's own folder for that item", () => {
    const i = item();
    expect(photoPathBelongsTo(`${SELLER}/declutter/${ITEM}/a.jpg`, i)).toBe(true);
    expect(photoPathBelongsTo(`${SELLER}/declutter/other/a.jpg`, i)).toBe(false);
    expect(photoPathBelongsTo(`someone-else/declutter/${ITEM}/a.jpg`, i)).toBe(false);
    expect(photoPathBelongsTo(`${SELLER}/declutter/${ITEM}/../../x.jpg`, i)).toBe(false);
    expect(photoPathBelongsTo(null, i)).toBe(false);
  });
});

describe("declutter cleanup: removeDeclutterItemsRest", () => {
  const stubFetch = (script: Array<{ ok?: boolean; status?: number; body: unknown }>) => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    vi.stubGlobal("fetch", async (url: string, init: { method: string; body?: string }) => {
      calls.push({ url, method: init.method, body: init.body });
      const step = script.shift();
      if (!step) throw new Error(`unexpected fetch ${init.method} ${url}`);
      return { ok: step.ok ?? true, status: step.status ?? 200, text: async () => JSON.stringify(step.body) };
    });
    return calls;
  };
  const path = `${SELLER}/declutter/${ITEM}/a.jpg`;

  it("reads the photo paths, deletes the row, then the file, in that order", async () => {
    const calls = stubFetch([{ body: [{ storage_path: path }, { storage_path: "evil/../x" }] }, { body: [{ id: ITEM }] }, { body: [{ name: path }] }]);
    const res = await removeDeclutterItemsRest({ base: "https://x.test", headers: {}, items: [item()] });
    expect(res).toEqual({ removedItems: 1, removedObjects: 1, failures: [] });
    expect(calls.map((c) => c.method)).toEqual(["GET", "DELETE", "DELETE"]);
    expect(calls[1].url).toContain(`declutter_items?id=eq.${ITEM}&seller_id=eq.${SELLER}&is_seed=eq.true`);
    expect(JSON.parse(calls[2].body as string)).toEqual({ prefixes: [path] });
  });

  it("a delete that matches zero rows is a failure, and no file is touched", async () => {
    const calls = stubFetch([{ body: [{ storage_path: path }] }, { body: [] }]);
    const res = await removeDeclutterItemsRest({ base: "https://x.test", headers: {}, items: [item()] });
    expect(res.removedItems).toBe(0);
    expect(res.failures).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it("fewer files removed than found is reported", async () => {
    stubFetch([{ body: [{ storage_path: path }] }, { body: [{ id: ITEM }] }, { body: [] }]);
    const res = await removeDeclutterItemsRest({ base: "https://x.test", headers: {}, items: [item()] });
    expect(res.removedItems).toBe(1);
    expect(res.failures[0]).toContain("removed 0 of 1");
  });
});

describe("prod-audit sweeper: Declutter pass", () => {
  it("scopes to the marker, the shared helper seat and is_seed", () => {
    expect(DECLUTTER_SELLER_IDS).toContain(HELPER_ID);
    const q = declutterCandidatesQuery() as string;
    expect(q).toContain(encodeURIComponent(`*${JOB_TITLE_MARKER}*`));
    expect(q).toContain("is_seed=is.true");
    expect(declutterMatches(item({ seller_id: HELPER_ID }))).toBe(true);
    expect(declutterMatches(item({ seller_id: "00000000-0000-4000-8000-000000000000" }))).toBe(false);
  });

  it("an unreadable list is a failure, not a silent skip", async () => {
    const out = (await sweepDeclutterItems({ base: "https://x.test", headers: {}, get: async () => { throw new Error("HTTP 500"); } })) as string[];
    expect(out[0]).toContain("could not list");
  });

  it("removes what matches and ignores what the re-check refuses", async () => {
    const real = item({ id: "11111111-1111-4111-8111-111111111111", seller_id: HELPER_ID });
    const foreign = item({ id: "22222222-2222-4222-8222-222222222222", seller_id: "00000000-0000-4000-8000-000000000000" });
    const deleted: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: { method: string }) => {
      if (init.method === "DELETE") deleted.push(url);
      const body = url.includes("declutter_item_photos") ? [] : [{ id: "x" }];
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    });
    const out = (await sweepDeclutterItems({ base: "https://x.test", headers: {}, get: async () => [real, foreign] })) as string[];
    expect(out).toEqual([]);
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toContain(real.id);
  });

  it("main() runs the Declutter pass before the early return", () => {
    const src = blankComments(readFileSync(join(ROOT, "scripts/e2e/prod-audit-sweeper.mjs"), "utf8"));
    expect(src).toMatch(/const declutterFailures = await sweepDeclutterItems\(/);
    expect(src).toMatch(/return endRun\(declutterFailures\)/);
  });
});

describe("declutter payout proof: removeUnsoldItem", () => {
  const RUN = "202610200003442ed2";
  const S = "33333333-3333-4333-8333-333333333333";
  const lamp = { id: ITEM, title: `Payout proof lamp ${RUN}`, seller_id: S, is_seed: true, status: "live" };
  const st = (o = {}) => ({ runId: RUN, itemId: ITEM, users: { seller: S, buyer: "b" }, ...o });
  const make = (rows: { item?: unknown[]; orders?: unknown[] }) => {
    const reads: string[] = [];
    const c = {
      base: "https://x.test",
      headers: {},
      rest: async (_m: string, q: string) => {
        reads.push(q);
        return q.startsWith("declutter_items") ? (rows.item ?? []) : (rows.orders ?? []);
      },
    };
    return { c, reads };
  };
  const stubDelete = () => {
    const deleted: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: { method: string }) => {
      if (init.method === "DELETE") deleted.push(url);
      return { ok: true, status: 200, text: async () => JSON.stringify(url.includes("declutter_item_photos") ? [] : [{ id: ITEM }]) };
    });
    return deleted;
  };

  it("deletes this run's unsold lamp", async () => {
    const deleted = stubDelete();
    await removeUnsoldItem(make({ item: [lamp] }).c, st());
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toContain(`declutter_items?id=eq.${ITEM}`);
  });

  it("leaves a sold item alone: an order id in the state, or an order row", async () => {
    const deleted = stubDelete();
    await removeUnsoldItem(make({ item: [lamp] }).c, st({ orderId: "o1" }));
    await removeUnsoldItem(make({ item: [lamp], orders: [{ order_id: "o1" }] }).c, st());
    expect(deleted).toEqual([]);
  });

  it("leaves it alone when it is not this run's: wrong title, wrong seller, held by a buyer", async () => {
    const deleted = stubDelete();
    for (const other of [{ title: "Payout proof lamp otherrun" }, { seller_id: "44444444-4444-4444-8444-444444444444" }, { status: "reserved" }, { is_seed: false }]) {
      await removeUnsoldItem(make({ item: [{ ...lamp, ...other }] }).c, st());
    }
    expect(deleted).toEqual([]);
  });

  it("does nothing when the run listed nothing or the item is gone", async () => {
    const deleted = stubDelete();
    const a = make({});
    await removeUnsoldItem(a.c, st({ itemId: undefined }));
    expect(a.reads).toEqual([]);
    await removeUnsoldItem(make({ item: [] }).c, st());
    expect(deleted).toEqual([]);
  });

  it("is called from the run's finally and from the always() unlink step", () => {
    const src = blankComments(readFileSync(join(ROOT, "scripts/e2e/declutterPayoutProof.mjs"), "utf8"));
    expect(src.match(/removeUnsoldItem\(c, state\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
