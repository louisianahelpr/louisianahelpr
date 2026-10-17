/**
 * Declutter "Add a Helpr" client (src/lib/declutter/setupHelpr.ts): the job a
 * choice pre-fills fits the jobs CHECKs and the right category, the pickup day
 * is used only when it is still ahead, "booked" means a funded live job, and
 * both RPCs are called with exactly the SQL's parameters, a refusal surfacing
 * with its plain words.
 *
 * The Supabase client is a recording fake (as in handover.test.ts).
 *
 * @mutate src/lib/declutter/setupHelpr.ts |   return j.status !== "cancelled" && FUNDED.has(j.payment_status ?? ""); |   return FUNDED.has(j.payment_status ?? "");
 * @mutate src/lib/declutter/setupHelpr.ts |   const dateNeeded = pickupDay && pickupDay >= todayYmd ? pickupDay : ""; |   const dateNeeded = pickupDay;
 * @mutate src/lib/declutter/setupHelpr.ts |   mount: { button: "Hang it on the wall", category: "handyman", |   mount: { button: "Hang it on the wall", category: "assembly",
 * @mutate src/lib/declutter/setupHelpr.ts |     title: fitWords(`${k.titleVerb} ${items[0]}`, 32), |     title: `${k.titleVerb} ${items[0]}`,
 * @mutate src/lib/declutter/setupHelpr.ts |       if (msg && Object.isExtensible(e)) e.userMessage = msg; |       if (false) e.userMessage = msg;
 * @mutate src/lib/declutter/setupHelpr.ts |   return data === true; |   return data !== false;
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const queue: { data?: unknown; error?: unknown }[] = [];
  const rpcs: unknown[][] = [];
  return {
    queue,
    rpcs,
    supabase: {
      rpc: (...args: unknown[]) => {
        rpcs.push(args);
        return Promise.resolve(queue.shift() ?? { data: null, error: null });
      },
    },
  };
});
vi.mock("@/integrations/supabase/client", () => ({ supabase: h.supabase }));

import {
  buildSetupJobPrefill,
  fetchSetupHelpr,
  isBookedSetupJob,
  linkSetupJob,
  louisianaYmd,
  parseSetupKind,
  SETUP_KIND_INFO,
} from "./setupHelpr";

beforeEach(() => {
  h.queue.length = 0;
  h.rpcs.length = 0;
});

describe("buildSetupJobPrefill", () => {
  it("each choice maps to an existing job category", () => {
    expect(SETUP_KIND_INFO.assemble.category).toBe("assembly");
    expect(SETUP_KIND_INFO.mount.category).toBe("handyman");
    expect(SETUP_KIND_INFO.setup.category).toBe("handyman");
  });

  it("titles fit 32 characters and never end on half a word", () => {
    const p = buildSetupJobPrefill({ items: ["Solid oak bookshelf with glass doors"], pickup_at: null }, "assemble", "2026-10-16");
    expect(Array.from(p.title).length).toBeLessThanOrEqual(32);
    expect(p.title).toBe("Put together Solid oak bookshelf");
    expect(buildSetupJobPrefill({ items: ["55 inch TV"], pickup_at: null }, "mount", "2026-10-16").title).toBe("Wall-mount 55 inch TV");
  });

  it("the description names every item, the place and the pickup day, within 1000 characters", () => {
    const p = buildSetupJobPrefill({ items: ["Desk", "Chair", "Lamp"], pickup_at: "2026-10-20T15:00:00Z" }, "setup", "2026-10-16");
    expect(p.description).toContain("I bought Desk, Chair and Lamp on Declutter and need it set up at my place.");
    expect(p.description).toContain("I pick it up on 2026-10-20");
    expect(p.dateNeeded).toBe("2026-10-20");
    const long = buildSetupJobPrefill({ items: Array.from({ length: 40 }, () => "x".repeat(40)), pickup_at: null }, "assemble", "2026-10-16");
    expect(Array.from(long.description).length).toBeLessThanOrEqual(1000);
  });

  it("a pickup day already past (or none) leaves the date for the buyer to pick", () => {
    expect(buildSetupJobPrefill({ items: ["Desk"], pickup_at: "2026-10-10T15:00:00Z" }, "assemble", "2026-10-16").dateNeeded).toBe("");
    expect(buildSetupJobPrefill({ items: ["Desk"], pickup_at: null }, "assemble", "2026-10-16").dateNeeded).toBe("");
    expect(buildSetupJobPrefill({ items: [], pickup_at: null }, "assemble", "2026-10-16").title).toBe("Put together an item");
  });

  it("the pickup day is the Louisiana day, not UTC's", () => {
    // 03:00 UTC on the 21st is 10 p.m. on the 20th in Louisiana (CDT).
    expect(louisianaYmd("2026-10-21T03:00:00Z")).toBe("2026-10-20");
  });

  it("an unknown kind reads as put it together", () => {
    expect(parseSetupKind("mount")).toBe("mount");
    expect(parseSetupKind("<script>")).toBe("assemble");
    expect(parseSetupKind(null)).toBe("assemble");
  });
});

describe("isBookedSetupJob", () => {
  it("is a funded job that is not cancelled", () => {
    expect(isBookedSetupJob({ status: "open", payment_status: "escrow" })).toBe(true);
    expect(isBookedSetupJob({ status: "completed", payment_status: "released" })).toBe(true);
    expect(isBookedSetupJob({ status: "open", payment_status: "unpaid" })).toBe(false);
    expect(isBookedSetupJob({ status: "cancelled", payment_status: "escrow" })).toBe(false);
    expect(isBookedSetupJob({ status: "open", payment_status: null })).toBe(false);
  });
});

describe("RPC calls", () => {
  it("fetchSetupHelpr calls declutter_setup_helpr with the order id and normalises the answer", async () => {
    h.queue.push({ data: { order_id: "o1", status: "paid", handover: "porch", items: ["Desk"], pickup_at: null, jobs: [] }, error: null });
    const info = await fetchSetupHelpr("o1");
    expect(h.rpcs).toEqual([["declutter_setup_helpr", { p_order_id: "o1" }]]);
    expect(info).toEqual({ order_id: "o1", status: "paid", handover: "porch", items: ["Desk"], pickup_at: null, jobs: [] });
  });

  it("a refusal surfaces with its plain words", async () => {
    h.queue.push({ data: null, error: { message: "item_not_found", code: "P0002" } });
    const err = (await fetchSetupHelpr("o1").catch((e) => e)) as Error & { userMessage?: string };
    expect(err).toBeInstanceOf(Error);
    expect(err.userMessage).toBe("This item isn't available.");
  });

  it("linkSetupJob passes both ids, says true only for true, and throws a refusal", async () => {
    h.queue.push({ data: true, error: null }, { data: false, error: null }, { data: null, error: null }, { data: null, error: { message: "feature_disabled" } });
    expect(await linkSetupJob("o1", "j1")).toBe(true);
    expect(h.rpcs[0]).toEqual(["declutter_link_setup_job", { p_order_id: "o1", p_job_id: "j1" }]);
    expect(await linkSetupJob("o1", "j1")).toBe(false);
    expect(await linkSetupJob("o1", "j1"), "no answer is not a link").toBe(false);
    await expect(linkSetupJob("o1", "j1")).rejects.toMatchObject({ message: "feature_disabled" });
  });
});
