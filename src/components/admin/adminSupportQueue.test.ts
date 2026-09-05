import { describe, it, expect } from "vitest";
import {
  PRIORITY_SUPPORT_TIERS,
  PRIORITY_HEAD_START_MINUTES,
  resolveSupportTier,
  hasPrioritySupport,
  supportPriorityAt,
  sortSupportQueue,
  waitingLabel,
} from "./AdminSupport";
import { TIER_PERKS } from "@/lib/subscriptionTiers";

/**
 * The Elite "Priority Support" perk is queue ORDERING in the admin inbox. This
 * pins the ordering rule and, more importantly, its two failure modes: an
 * expired paid tier keeping the perk, and free tickets starving behind Elite.
 */

const NOW = Date.parse("2026-09-01T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

type T = Parameters<typeof sortSupportQueue>[0][number];
const ticket = (id: string, ageHours: number, tier: T["support_tier"], status = "pending"): T => ({
  id,
  reporter_id: `u-${id}`,
  reason: `[Admin Message] ${id}`,
  description: null,
  status,
  created_at: hoursAgo(ageHours),
  support_tier: tier,
});

describe("priority entitlement is derived, not hardcoded", () => {
  it("matches exactly the tiers whose TIER_PERKS.dedicatedSupport is true", () => {
    const fromPerks = (Object.keys(TIER_PERKS) as Array<keyof typeof TIER_PERKS>)
      .filter(t => TIER_PERKS[t].dedicatedSupport);
    expect(PRIORITY_SUPPORT_TIERS).toEqual(fromPerks);
    // Today that is Elite alone — and the assertion above is what keeps this
    // true if the perk ever moves.
    expect(PRIORITY_SUPPORT_TIERS).toEqual(["elite"]);
  });

  it("only entitled tiers report the perk", () => {
    expect(hasPrioritySupport("elite")).toBe(true);
    // Plus is a real tier again (2026-09-05) and deliberately does NOT get
    // priority support: TIER_PERKS.plus.dedicatedSupport is false, because
    // moving one of Elite's identity perks down is a pricing decision the
    // owner has not made. Asserted here so restoring the tier cannot quietly
    // hand out Elite's support queue with it.
    expect(hasPrioritySupport("plus")).toBe(false);
    expect(hasPrioritySupport("pro")).toBe(false);
    expect(hasPrioritySupport("basic")).toBe(false);
    expect(hasPrioritySupport("free")).toBe(false);
  });
});

describe("resolveSupportTier — the tier NOW, not the raw column", () => {
  it("keeps an unexpired paid tier", () => {
    expect(resolveSupportTier("elite", new Date(NOW + 86_400_000).toISOString(), NOW)).toBe("elite");
  });

  it("treats a null expiry as active (the cron nulls the TIER on lapse)", () => {
    expect(resolveSupportTier("elite", null, NOW)).toBe("elite");
  });

  it("drops an EXPIRED elite to free, so it loses priority", () => {
    const expired = resolveSupportTier("elite", new Date(NOW - 1000).toISOString(), NOW);
    expect(expired).toBe("free");
    expect(hasPrioritySupport(expired)).toBe(false);
  });

  it("normalises case", () => {
    expect(resolveSupportTier("ELITE", null, NOW)).toBe("elite");
  });

  it("resolves a retired 'business' — and any unknown value — to free", () => {
    expect(resolveSupportTier("business", null, NOW)).toBe("free");
    // "plus" was in this list until 2026-09-05, when it stopped being an
    // unknown value. It now resolves to itself; the assertion that matters for
    // this queue — that it earns no priority — lives above.
    expect(resolveSupportTier("plus", null, NOW)).toBe("plus");
    expect(resolveSupportTier(null, null, NOW)).toBe("free");
    expect(resolveSupportTier(undefined, undefined, NOW)).toBe("free");
  });
});

describe("supportPriorityAt — effective arrival time", () => {
  it("shifts an entitled ticket earlier by exactly the head start", () => {
    const created = hoursAgo(1);
    expect(supportPriorityAt(created, "elite")).toBe(
      Date.parse(created) - PRIORITY_HEAD_START_MINUTES * 60_000,
    );
  });

  it("leaves a non-entitled ticket at its real arrival time", () => {
    const created = hoursAgo(1);
    expect(supportPriorityAt(created, "pro")).toBe(Date.parse(created));
    expect(supportPriorityAt(created, "free")).toBe(Date.parse(created));
  });

  it("sorts an unparseable timestamp LAST, never first", () => {
    expect(supportPriorityAt("not a date", "elite")).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("sortSupportQueue", () => {
  it("floats a fresh Elite ticket above younger free/pro tickets", () => {
    const order = sortSupportQueue([
      ticket("free-2h", 2, "free"),
      ticket("pro-6h", 6, "pro"),
      ticket("elite-1h", 1, "elite"),
    ]).map(t => t.id);
    expect(order).toEqual(["elite-1h", "pro-6h", "free-2h"]);
  });

  it("is FIFO inside a tier — the longest wait wins, not the newest arrival", () => {
    const order = sortSupportQueue([
      ticket("elite-new", 1, "elite"),
      ticket("elite-old", 30, "elite"),
    ]).map(t => t.id);
    expect(order).toEqual(["elite-old", "elite-new"]);
  });

  it("ANTI-STARVATION: a free ticket older than the head start outranks a fresh Elite one", () => {
    // An Elite ticket of age A has an effective age of A + 48h, so a 1h-old
    // Elite is beaten by anything past 49h. Nothing can be overtaken forever.
    const order = sortSupportQueue([
      ticket("elite-1h", 1, "elite"),
      ticket("free-60h", 60, "free"),
    ]).map(t => t.id);
    expect(order).toEqual(["free-60h", "elite-1h"]);
  });

  it("bounds the overtaking at exactly the head start — 47h free still loses, 49h wins", () => {
    expect(
      sortSupportQueue([ticket("free-47h", 47, "free"), ticket("elite-0h", 0, "elite")]).map(t => t.id),
    ).toEqual(["elite-0h", "free-47h"]);
    expect(
      sortSupportQueue([ticket("free-49h", 49, "free"), ticket("elite-0h", 0, "elite")]).map(t => t.id),
    ).toEqual(["free-49h", "elite-0h"]);
  });

  it("an EXPIRED elite sorts exactly where a free ticket of the same age would", () => {
    // resolveSupportTier has already collapsed it to "free" by this point;
    // this pins that the queue then treats it identically.
    const order = sortSupportQueue([
      ticket("expired-elite-3h", 3, "free"),
      ticket("elite-10h", 10, "elite"),
      ticket("free-3h", 3, "free"),
    ]).map(t => t.id);
    expect(order[0]).toBe("elite-10h");
    // Two 3h non-priority tickets, tied on effective arrival → deterministic id tiebreak.
    expect(order.slice(1).sort()).toEqual(["expired-elite-3h", "free-3h"]);
  });

  it("puts open work above closed history, and closed history newest-first", () => {
    const order = sortSupportQueue([
      ticket("closed-old", 100, "elite", "resolved"),
      ticket("closed-new", 2, "free", "dismissed"),
      ticket("open-free", 1, "free"),
    ]).map(t => t.id);
    expect(order).toEqual(["open-free", "closed-new", "closed-old"]);
  });

  it("is stable and deterministic on identical timestamps", () => {
    const a = ticket("aaa", 5, "free");
    const b = ticket("bbb", 5, "free");
    expect(sortSupportQueue([b, a]).map(t => t.id)).toEqual(["aaa", "bbb"]);
    expect(sortSupportQueue([a, b]).map(t => t.id)).toEqual(["aaa", "bbb"]);
  });

  it("does not mutate its input", () => {
    const input = [ticket("z", 1, "free"), ticket("a", 99, "elite")];
    const before = input.map(t => t.id);
    sortSupportQueue(input);
    expect(input.map(t => t.id)).toEqual(before);
  });
});

describe("waitingLabel", () => {
  it("measures elapsed time and promises nothing", () => {
    expect(waitingLabel(hoursAgo(0.5), NOW)).toBe("waiting 30m");
    expect(waitingLabel(hoursAgo(6), NOW)).toBe("waiting 6h");
    expect(waitingLabel(hoursAgo(47), NOW)).toBe("waiting 47h");
    expect(waitingLabel(hoursAgo(49), NOW)).toBe("waiting 2d");
    // No "due", "within", "by" — the owner chose ordering, explicitly NOT an SLA.
    expect(waitingLabel(hoursAgo(6), NOW)).not.toMatch(/due|within|by |respond/i);
  });

  it("returns empty for junk rather than rendering NaN", () => {
    expect(waitingLabel("not a date", NOW)).toBe("");
  });
});
