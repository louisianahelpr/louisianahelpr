/*
 * Q-number reservations (q-reserve): lanes on one Mac claim numbers in a shared
 * ledger so two stale bases never file the same Q (Q2154-Q2161, 2026-10-18).
 * INVENTORY: planReservation (pure) and reserveNumbers (ledger + mkdir lock).
 */
// @mutate scripts/lib/queueAllocator.mjs | Math.max(floor, ...live.map((e) => e.number)) + 1 | floor + 1
// @mutate scripts/lib/queueAllocator.mjs | !mainNumbers.has(e.number) | true
// @mutate scripts/lib/queueAllocator.mjs | now - Date.parse(e.time) < ttl | true
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error — plain .mjs script, no declaration file
import { planReservation, reserveNumbers } from "../../scripts/lib/queueAllocator.mjs";

const DAY = 86400000;
const t0 = Date.parse("2026-10-18T00:00:00Z");

describe("planReservation", () => {
  it("two reservations never overlap, even from the same stale floor", () => {
    const a = planReservation([], { lane: "a", count: 3, floor: 2153, now: t0 });
    const b = planReservation(a.entries, { lane: "b", count: 3, floor: 2153, now: t0 });
    expect(a.numbers).toEqual([2154, 2155, 2156]);
    expect(b.numbers).toEqual([2157, 2158, 2159]);
    expect(new Set([...a.numbers, ...b.numbers]).size).toBe(6);
  });
  it("a number that appears on main frees its reservation", () => {
    const a = planReservation([], { lane: "a", count: 2, floor: 10, now: t0 });
    const b = planReservation(a.entries, { lane: "b", count: 1, floor: 10, mainNumbers: new Set([11, 12]), now: t0 });
    expect(b.entries.map((e: { lane: string }) => e.lane)).toEqual(["b"]);
    expect(b.numbers).toEqual([11]);
  });
  it("a reservation expires after the ttl", () => {
    const a = planReservation([], { lane: "a", count: 1, floor: 10, now: t0 });
    expect(planReservation(a.entries, { lane: "b", count: 1, floor: 10, now: t0 + 2 * DAY, ttlDays: 3 }).numbers).toEqual([12]);
    expect(planReservation(a.entries, { lane: "b", count: 1, floor: 10, now: t0 + 4 * DAY, ttlDays: 3 }).numbers).toEqual([11]);
  });
  it("refuses a bad lane or count", () => {
    expect(() => planReservation([], { lane: "", count: 1, floor: 1 })).toThrow();
    expect(() => planReservation([], { lane: "a b", count: 1, floor: 1 })).toThrow();
    expect(() => planReservation([], { lane: "a", count: 0, floor: 1 })).toThrow();
  });
});

describe("reserveNumbers (ledger on disk)", () => {
  it("successive calls from one tree get disjoint numbers above this tree's max", () => {
    const ledger = join(mkdtempSync(join(tmpdir(), "qres-")), "q.json");
    const root = join(__dirname, "..", "..");
    const a = reserveNumbers(root, "lane-a", 2, { ledger, ref: "no-such-ref" });
    const b = reserveNumbers(root, "lane-b", 2, { ledger, ref: "no-such-ref" });
    const nums = [...a, ...b].map((q: string) => Number(q.slice(1)));
    expect(new Set(nums).size).toBe(4);
    expect(Math.min(...nums)).toBeGreaterThan(1000);
    expect(JSON.parse(readFileSync(ledger, "utf8"))).toHaveLength(4);
  });
});
