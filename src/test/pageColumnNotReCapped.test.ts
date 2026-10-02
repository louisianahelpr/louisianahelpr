/**
 * A page's content column fills the column AppPage gives it (owner,
 * 2026-10-01, Applicants: "this content still needs to be wider to fill the
 * space"). The applicant list sat in a local `max-w-2xl mx-auto` wrapper, so
 * at desktop width it was a 672px strip inside a ~1000px column.
 *
 * Class: any file under src/pages that centres a wrapper with a fixed
 * Tailwind max-width (xl and up) re-caps the page column narrower than the
 * screen. Small caps (max-w-xs/sm/md/lg on a button or lever row) are not
 * page columns and are left alone.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const PAGES = path.resolve(__dirname, "../pages");
const RECAP = /className="[^"]*\bmax-w-(?:xl|[2-7]xl)\b[^"]*\bmx-auto\b[^"]*"|className="[^"]*\bmx-auto\b[^"]*\bmax-w-(?:xl|[2-7]xl)\b[^"]*"/;

// Not page columns: a fixed, floating bar sized to its own content.
// @two-way src/test/pageColumnNotReCapped.test.ts:filter((e) => !hits.includes(e))
const EXEMPT = new Set(["posts/BulkDismissBar.tsx:34"]);

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name) ? [p] : [];
  });
}

function reCappedColumns(files: { file: string; src: string }[]): string[] {
  const out: string[] = [];
  for (const { file, src } of files) {
    src.split("\n").forEach((line, i) => {
      if (RECAP.test(line)) out.push(`${file}:${i + 1}`);
    });
  }
  return out;
}

describe("page columns are not re-capped", () => {
  it("scans the real pages tree", () => {
    expect(walk(PAGES).length).toBeGreaterThan(50);
  });

  it("flags the original Applicants wrapper", () => {
    const src = `<div className="max-w-2xl mx-auto w-full">`;
    expect(reCappedColumns([{ file: "ApplicantsPanel.tsx", src }])).toEqual(["ApplicantsPanel.tsx:1"]);
    expect(reCappedColumns([{ file: "x.tsx", src: `<div className="w-full max-w-xs">` }])).toEqual([]);
  });

  it("no page centres its content in a fixed max-width column", () => {
    const files = walk(PAGES).map((file) => ({
      file: path.relative(PAGES, file),
      src: fs.readFileSync(file, "utf8"),
    }));
    const hits = reCappedColumns(files);
    expect(hits.filter((h) => !EXEMPT.has(h))).toEqual([]);
    // Exact in both directions: a stale exemption fails too.
    expect([...EXEMPT].filter((e) => !hits.includes(e))).toEqual([]);
  });
});
