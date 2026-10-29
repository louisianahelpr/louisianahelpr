/**
 * Audit 2026-10-29 A3-C15: Notifications showed "Quote reminders" to members while the quotes switch
 * was off for them, and called "the Helpr is on the way" alerts "Transit updates".
 *
 * @mutate src/components/NotificationPreferences.tsx |       {quotesOn && ( |       {true && (
 * @mutate src/components/notificationPreferences/constants.tsx | label: "Helpr on the way" | label: "Transit updates"
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

describe("Notifications name only what the member has, in plain words (A3-C15)", () => {
  it("Quote reminders renders only while the quotes switch is on", () => {
    const src = read("src/components/NotificationPreferences.tsx");
    expect(src).toContain('const quotesOn = useFeature("quotes");');
    expect(src).toMatch(/\{quotesOn && \(\s*<QuoteRemindersRow/);
  });
  it("the on-the-way row says so plainly", () => {
    const src = read("src/components/notificationPreferences/constants.tsx");
    expect(src).toContain('label: "Helpr on the way"');
    expect(src).not.toContain("Transit updates");
  });
});
