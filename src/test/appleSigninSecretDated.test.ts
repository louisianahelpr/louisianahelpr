/**
 * Q1322: the Sign in with Apple web secret (a JWT Apple caps at 180 days) has
 * a recorded expiry, so the daily expiry monitor (scripts/expiry-check.mjs,
 * warnDays 30) warns a month before Apple sign-in stops working. The
 * Management API masks the secret (a 64-hex hash, measured 2026-09-24), so the
 * date can only come from the inventory: without it the item is UNREADABLE
 * every day and nothing warns.
 *
 * Recorded 2026-10-07 as ASSUMED (rotated 2026-10-05 at the tool's 180-day
 * default -> 2027-04-03); the owner confirms or corrects it.
 *
 * @mutate scripts/audit/expiry-inventory.json | "method": "supabase-auth-apple", "date": "2027-04-03", | "method": "supabase-auth-apple", "date": null,
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Item = { id: string; read?: { method?: string; date?: string | null; recorded?: string | null } };

describe("the Sign in with Apple secret carries its expiry (Q1322)", () => {
  const inv = JSON.parse(readFileSync(join(__dirname, "..", "..", "scripts", "audit", "expiry-inventory.json"), "utf8")) as { items: Item[] };
  const apple = inv.items.filter((i) => i.read?.method === "supabase-auth-apple");

  it("finds the item", () => {
    expect(inv.items.length).toBeGreaterThan(10);
    expect(apple.length).toBe(1);
  });

  it("has a real date within Apple's 180-day cap of a recorded rotation, and says who recorded it", () => {
    const { date, recorded } = apple[0].read!;
    expect(date, "record the secret's expiry as read.date").toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(date!))).toBe(false);
    expect(recorded, "say when (and how) the date was recorded").toBeTruthy();
    const rotated = /^(\d{4}-\d{2}-\d{2})/.exec(recorded!)?.[1];
    expect(rotated).toBeTruthy();
    const days = (Date.parse(date!) - Date.parse(rotated!)) / 86_400_000;
    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThanOrEqual(181);
  });
});
