// Every PGlite proof's stand-in `public.notifications` table uses only columns the real table has.
//
// A PGlite proof runs the migration verbatim on hand-made tables. If a fixture invents a column, the migration can
// name it, the proof passes, and prod errors on every run: 46ae717229's open-notice check read `n.read_at`, a column
// the fixture had and prod never had (the real one is `read boolean NOT NULL DEFAULT false`, 20260311004406). Lead's
// review caught it, 11-01. The real columns come from src/integrations/supabase/types.ts (generated from prod).
//
// @mutate src/test/pglite/declutterCheckSweep.pglite.mjs | read boolean NOT NULL DEFAULT false, link text | read_at timestamptz, link text
import { describe, it, expect } from "vitest";
import { join, relative } from "node:path";
import { walkSource, readSource } from "./helpers/walkSource";
import { schemaTables } from "./helpers/schemaConstraints";
import { blankComments } from "./helpers/blankNonCode";

const REPO = join(__dirname, "..", "..");
const TABLES = ["notifications"] as const;

/** The column names of each `CREATE TABLE public.<table> (...)` in a file's code. */
export function fixtureColumns(src: string, table: string): string[][] {
  const code = blankComments(src);
  const out: string[][] = [];
  const re = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?public\\.${table}\\s*\\(`, "g");
  for (const m of code.matchAll(re)) {
    let depth = 1;
    let j = m.index! + m[0].length;
    const start = j;
    for (; j < code.length && depth > 0; j++) {
      if (code[j] === "(") depth++;
      else if (code[j] === ")") depth--;
    }
    const parts: string[] = [];
    let cur = "";
    let d = 0;
    for (const ch of code.slice(start, j - 1)) {
      if (ch === "(") d++;
      if (ch === ")") d--;
      if (ch === "," && d === 0) {
        parts.push(cur);
        cur = "";
      } else cur += ch;
    }
    parts.push(cur);
    out.push(
      parts
        .map((p) => p.trim().split(/\s+/)[0].replace(/"/g, ""))
        .filter((c) => c && !/^(PRIMARY|UNIQUE|CHECK|CONSTRAINT|FOREIGN|EXCLUDE|LIKE)$/i.test(c)),
    );
  }
  return out;
}

describe("PGlite fixtures never invent columns on the real notifications table", () => {
  const real = schemaTables();
  const files = walkSource([join(REPO, "src/test/pglite")], [".mjs", ".ts"]);

  it("reads the real columns and finds the fixtures (cannot pass vacuously)", () => {
    expect(real.get("notifications")).toContain("read");
    expect(real.get("notifications")).not.toContain("read_at");
    const n = files.filter((f) => fixtureColumns(readSource(f) ?? "", "notifications").length > 0).length;
    expect(n).toBeGreaterThan(100);
  });

  it("the parser sees an invented column", () => {
    expect(fixtureColumns("CREATE TABLE public.notifications (id uuid PRIMARY KEY, read_at timestamptz, CHECK (x > 0))", "notifications"))
      .toEqual([["id", "read_at"]]);
  });

  it("every fixture's columns exist on the real table", () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = readSource(f) ?? "";
      for (const t of TABLES) {
        const cols = real.get(t)!;
        for (const set of fixtureColumns(src, t)) {
          for (const c of set) if (!cols.has(c)) bad.push(`${relative(REPO, f)}: public.${t}.${c} is not a real column`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
