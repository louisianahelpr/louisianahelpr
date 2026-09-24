/**
 * NB-011: one OS event (the user denied a permission) was described three
 * ways, and only one said what to do. iOS asks once per install, so the only
 * recovery is Settings. Every user-facing string that tells the user a
 * location / photo / camera / microphone permission is denied or off must name
 * Settings.
 *
 * @mutate src/hooks/useUserLocation.ts | "Location access is off. Turn it on in Settings to use your location." | "Location permission denied"
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const SRC = resolve(__dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "test" ? [] : files(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
}

// A string literal (", ' or `) that reports a denied / switched-off permission.
const LITERAL = /(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g;
const DENIAL = /\b(location|photo|camera|microphone|speech recognition)( access| permission)?( is)? (denied|off|turned off)\b/i;

describe("permission-denied copy names Settings (NB-011)", () => {
  it("every denial string tells the user where to turn it back on", () => {
    const hits: string[] = [];
    const bad: string[] = [];
    for (const f of files(SRC)) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*)/.test(line)) return;
        for (const m of line.matchAll(LITERAL)) {
          const s = m[2];
          if (!DENIAL.test(s)) continue;
          hits.push(s);
          if (!/Settings/.test(s)) bad.push(`${f.slice(SRC.length + 1)}:${i + 1} ${s}`);
        }
      });
    }
    // Inventory floor: denial strings present measured 2026-09-24.
    expect(hits.length).toBeGreaterThanOrEqual(5);
    expect(bad).toEqual([]);
  });
});
