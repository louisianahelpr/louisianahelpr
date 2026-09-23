// @mutate src/lib/storagePath.ts | export function safeDocumentUrl( | export const anyRatchetProbe = 1 as any; export function safeDocumentUrl(
// @mutate src/lib/posthog.ts | export function identifyUser(userId: string, props: Record<string, any> = {}) | export function identifyUser(userId: string, props: Record<string, unknown> = {})
/*
 * The `any` count in non-test src/ may only go DOWN, file by file (OPEN.md Q184).
 *
 * WHY PER FILE. A single total lets a commit remove three `any` in one file and
 * add three in a money path, and stay green. So the baseline is an exact map
 * file -> count, and every entry must match: a file whose count ROSE fails
 * (type it properly), a file whose count FELL fails too until
 * scripts/any-baseline.json is lowered in the same commit, so the gain cannot
 * silently drift back. A file not in the baseline must have zero.
 *
 * WHY THE TYPESCRIPT PARSER AND NOT A GREP. The Q184 grep
 * (`:\s*any\b|<any>|as any`) counts lines, so it reads the word "any" in a
 * comment as a use and misses `Record<string, any>` and `useState<any[]>`
 * entirely. This counts `AnyKeyword` nodes in the syntax tree: every type-level
 * `any`, and nothing in comments or strings.
 *
 * Regenerate after lowering: `node scripts/any-baseline.mjs --write`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { countAnyByFile, isTestFile } from "../../scripts/any-baseline.mjs";

const root = join(__dirname, "..", "..");
const BASELINE_PATH = "scripts/any-baseline.json";
const baseline: { files: Record<string, number> } = JSON.parse(readFileSync(join(root, BASELINE_PATH), "utf8"));

describe("`any` in non-test src/ only shrinks, per file", () => {
  const { scanned, counts } = countAnyByFile(root);

  it("scans the real source tree", () => {
    // A walker that read nothing would report zero and "pass" by lowering the bar.
    expect(scanned).toBeGreaterThan(500);
    expect(Object.keys(baseline.files).length).toBeGreaterThan(0);
    expect(isTestFile("src/test/anyRatchet.test.ts") && isTestFile("src/lib/x.spec.tsx")).toBe(true);
    expect(Object.keys(counts).filter(isTestFile), "test files must not be counted").toEqual([]);
  });

  it("every file's `any` count equals the baseline", () => {
    const problems: string[] = [];
    const keys = new Set([...Object.keys(baseline.files), ...Object.keys(counts)]);
    for (const file of [...keys].sort()) {
      const was = baseline.files[file] ?? 0;
      const is = counts[file] ?? 0;
      if (is > was)
        problems.push(
          `${file}: \`any\` ROSE from ${was} to ${is}. Use a real type (generated Supabase types, a domain ` +
            `type, or \`unknown\` + narrowing). Do not raise ${BASELINE_PATH}.`,
        );
      else if (is < was)
        problems.push(
          `${file}: \`any\` FELL from ${was} to ${is} — good. Run \`node scripts/any-baseline.mjs --write\` ` +
            `(or set it to ${is}${is === 0 ? " by deleting the entry" : ""}) in this commit so the ratchet holds the gain.`,
        );
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("baseline entries are real files with positive counts", () => {
    for (const [file, n] of Object.entries(baseline.files)) {
      expect(Number.isInteger(n) && n > 0, `${file}: ${n}`).toBe(true);
      expect(relative(root, join(root, file)), file).toBe(file);
    }
  });
});
