// @mutate src/lib/userRealtimeBus.ts | filter: `user_id=eq.${userId}` | filter: `customer_id=eq.${userId}`
/**
 * EVERY realtime `filter:` NAMES A COLUMN THE TABLE HAS (Q55b).
 *
 * The 2026-09-22 postgres logs carried "invalid column for filter customer_id"
 * x12: a postgres_changes binding whose filter column does not exist on its
 * table. Realtime rejects that binding server-side and the channel silently
 * never delivers: no exception reaches the client, the screen just stops
 * hearing other people's writes. It was gone from the logs by 2026-09-23, but
 * nothing stopped the next one.
 *
 * This reads every binding in src/ (comments blanked, any quote style), takes
 * its `table` and the column its `filter` compares, and checks the column is
 * in that table's generated Row type (src/integrations/supabase/types.ts,
 * which db-drift-detect.yml keeps fresh against prod).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");

type Binding = { at: string; table: string | null; column: string | null };

export function bindingsIn(file: string, raw: string): Binding[] {
  const code = blankComments(raw);
  const out: Binding[] = [];
  for (const m of code.matchAll(/["'`]postgres_changes["'`]\s*,\s*\{/g)) {
    // The options object: up to its closing brace at depth 0 (template
    // literals like `user_id=eq.${id}` carry braces of their own).
    let depth = 0;
    let end = m.index! + m[0].length - 1;
    for (let i = end; i < code.length; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}" && --depth === 0) { end = i; break; }
    }
    const opts = code.slice(m.index!, end + 1);
    out.push({
      at: `${file}:${code.slice(0, m.index).split("\n").length}`,
      table: /\btable\s*:\s*["'`]([a-z_]+)["'`]/.exec(opts)?.[1] ?? null,
      column: /\bfilter\s*:\s*["'`]([a-z_]+)\s*=/.exec(opts)?.[1] ?? null,
    });
  }
  return out;
}

export function rowColumns(types: string): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  for (const m of types.matchAll(/^ {6}([a-z_]+): \{\n {8}Row: \{\n([\s\S]*?)^ {8}\}/gm)) {
    const cols = new Set([...m[2].matchAll(/^ {10}([a-z_0-9]+)\??:/gm)].map((c) => c[1]));
    if (!tables.has(m[1])) tables.set(m[1], cols);
  }
  return tables;
}

const sourceFiles = (): string[] =>
  execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\./.test(f));

describe("realtime filters name a column their table has", () => {
  const tables = rowColumns(readFileSync(resolve(ROOT, "src/integrations/supabase/types.ts"), "utf8"));
  const all = sourceFiles().flatMap((f) => bindingsIn(f, readFileSync(resolve(ROOT, f), "utf8")));
  const filtered = all.filter((b) => b.column);

  it("finds the bindings and the tables (never passes vacuously)", () => {
    expect(tables.size).toBeGreaterThan(50);
    expect(tables.get("jobs")?.has("customer_id")).toBe(true);
    expect(all.length).toBeGreaterThan(10);
    expect(filtered.length).toBeGreaterThan(10);
    expect(all.filter((b) => !b.table), "a binding whose table could not be read").toEqual([]);
  });

  it("every filter column exists on its table", () => {
    const bad = filtered
      .filter((b) => !tables.get(b.table!)?.has(b.column!))
      .map((b) => `${b.at}: ${b.table}.${b.column} ${tables.has(b.table!) ? "is not a column" : "— table not in types.ts"}`);
    expect(bad, "Realtime rejects these bindings server-side and the channel silently never delivers").toEqual([]);
  });

  it("is RED on a planted binding filtering a column the table lacks", () => {
    const planted = bindingsIn("planted.ts", `ch.on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: \`customer_id=eq.\${id}\` }, cb)`);
    expect(planted).toHaveLength(1);
    expect(tables.get(planted[0].table!)?.has(planted[0].column!)).toBe(false);
  });
});
