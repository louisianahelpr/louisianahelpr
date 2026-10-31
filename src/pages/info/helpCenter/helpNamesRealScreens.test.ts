/**
 * AUD31-58: Help named screens the app does not have ("Profile → Account Security", "Senior Mode ... Profile →
 * Accessibility", "Profile → Membership → Manage", "scroll to the very bottom" of Profile for Delete) and printed
 * the HVAC trade as "hvac". The app's path is You › Settings, and its rows are SettingsTab's labels.
 *
 * Inventory: every FAQ answer (FAQ_SECTIONS) and topic blurb (TOPICS).
 *
 * @mutate src/pages/info/helpCenter/helpCenterContent.ts |         a: "Go to You › Settings › Account and security.", |         a: "Go to Profile → Account Security.",
 * @mutate src/pages/info/helpCenter/helpCenterContent.ts | (/^[A-Z0-9]+$/.test(JOB_CATEGORY_LABELS[value]) ? JOB_CATEGORY_LABELS[value] : JOB_CATEGORY_LABELS[value].toLowerCase()) | JOB_CATEGORY_LABELS[value].toLowerCase()
 * @mutate src/pages/info/helpCenter/helpCenterContent.ts | Turn on Bigger text and buttons in You › Settings. | Enable Senior Mode in You › Settings.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FAQ_SECTIONS, TOPICS } from "./helpCenterContent";
import { TAB_TITLES } from "@/pages/profile/types";

const ROOT = resolve(__dirname, "../../../..");
const settings = readFileSync(resolve(ROOT, "src/components/profile/SettingsTab.tsx"), "utf8");
/** The Settings rows: literal labels plus the TAB_TITLES the rows read. */
const ROWS = new Set<string>([
  ...[...settings.matchAll(/label="([^"]+)"/g)].map((m) => m[1]),
  ...[...settings.matchAll(/label=\{TAB_TITLES\.(\w+)\}/g)].map((m) => TAB_TITLES[m[1] as keyof typeof TAB_TITLES]),
]);
const texts = [...FAQ_SECTIONS.flatMap((s) => s.items.map((i) => `${i.q} ${i.a}`)), ...TOPICS.map((t) => t.desc)];

describe("Help names the screens the app has", () => {
  it("reads a real inventory", () => {
    expect(texts.length).toBeGreaterThan(30);
    expect(ROWS.size).toBeGreaterThan(8);
  });

  it("no old screen names", () => {
    const bad = texts.filter((t) => /Profile\s*(?:→|›)|Senior Mode|Account Security|scroll to the very bottom|\bhvac\b/.test(t));
    expect(bad).toEqual([]);
  });

  it("every You › Settings › <row> names a real Settings row", () => {
    const named = texts.flatMap((t) => [...t.matchAll(/You › Settings › ([A-Z][a-z]+(?: [a-z]+)*)/g)].map((m) => m[1]));
    expect(named.length).toBeGreaterThan(0);
    for (const n of named) expect(ROWS.has(n), n).toBe(true);
  });

  it("the switch Help names is the Settings row's own words", () => {
    expect(ROWS.has("Bigger text and buttons")).toBe(true);
    expect(texts.some((t) => t.includes("Bigger text and buttons"))).toBe(true);
  });
});
