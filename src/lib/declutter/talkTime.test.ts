/**
 * AUD31-12 (audit 2026-10-31): order chat lines showed the weekday alone ("Thu 1:06 AM") for a message 9 days old.
 * Both Declutter chats (order, handover) stamp their lines with talkTime: the weekday within 6 days, the date past it.
 * F446 (audit 11-10): a line sent today read "Tue 1:45 PM"; today's and yesterday's lines are named as such.
 * @mutate src/lib/declutter/talkTime.ts |   if (sameDay(d, now)) return "Today"; |   if (false) return "Today";
 * @mutate src/lib/declutter/talkTime.ts |   return sameDay(d, yesterday) ? "Yesterday" : null; |   return null;
 * @mutate src/lib/declutter/talkTime.ts |   if (Math.abs(now.getTime() - d.getTime()) <= SIX_DAYS_MS) { |   if (true) {
 * @mutate src/components/declutter/DeclutterOrderTalk.tsx | const when = (iso: string) => talkTime(iso); | const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
 * @mutate src/components/declutter/DeclutterHandoverTalk.tsx | const when = (iso: string) => talkTime(iso); | const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";
import { talkTime } from "./talkTime";

const NOW = new Date(2026, 9, 31, 12, 0);
const at = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const weekday = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short" });

describe("talkTime (AUD31-12)", () => {
  it("within 6 days: the weekday and time", () => {
    for (const days of [2, 6]) {
      const s = talkTime(at(days), NOW);
      expect(s, `${days}d`).toContain(weekday(at(days)));
      expect(s).not.toMatch(/Oct|Nov/);
    }
  });
  it("F446: today and yesterday are named, by the calendar, with the time", () => {
    const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    expect(talkTime(at(0), NOW)).toBe(`Today ${time(at(0))}`);
    const earlyToday = new Date(2026, 9, 31, 0, 30).toISOString();
    expect(talkTime(earlyToday, NOW)).toBe(`Today ${time(earlyToday)}`);
    const lateYesterday = new Date(2026, 9, 30, 23, 50).toISOString();
    expect(talkTime(lateYesterday, NOW)).toBe(`Yesterday ${time(lateYesterday)}`);
    expect(talkTime(at(1), NOW)).toBe(`Yesterday ${time(at(1))}`);
    expect(talkTime(at(2), NOW)).not.toMatch(/Today|Yesterday/);
    // A stamp a little ahead of the clock (server time) is still today.
    const soon = new Date(NOW.getTime() + 5 * 60_000).toISOString();
    expect(talkTime(soon, NOW)).toBe(`Today ${time(soon)}`);
  });
  it("past 6 days: the date and time, never the weekday alone", () => {
    const s = talkTime(at(9), NOW);
    expect(s).toContain("Oct 22");
    expect(s).not.toContain(weekday(at(9)));
    expect(s).not.toContain("2026");
  });
  it("another year: with the year", () => {
    expect(talkTime(new Date(2025, 11, 30, 9, 5).toISOString(), NOW)).toContain("2025");
  });
  it("a bad stamp says nothing", () => {
    expect(talkTime("nope", NOW)).toBe("");
  });
  it("both Declutter chats stamp their lines with it, and no other weekday-only formatter is left there", () => {
    const files = ["src/components/declutter/DeclutterOrderTalk.tsx", "src/components/declutter/DeclutterHandoverTalk.tsx"];
    expect(files.length).toBeGreaterThan(1);
    for (const f of files) {
      const src = blankComments(readFileSync(f, "utf8"));
      expect(src, f).toContain("const when = (iso: string) => talkTime(iso);");
      expect(src, f).not.toContain('weekday: "short"');
    }
  });
});
