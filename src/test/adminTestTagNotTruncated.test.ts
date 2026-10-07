import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

/**
 * Q442 (2026-10-07): the admin "Test" tag (TestTag, Q368) must never sit INSIDE
 * a `truncate` element. On /admin?view=notiflogs it did: the recipient cell was
 * `<td className="... truncate">{email} <TestTag /></td>`, so at 375 and 1440
 * the email's ellipsis clipped the tag off every seed row, and the queue the
 * tag exists to label showed no tag at all.
 *
 * The class, from source: for every `<TestTag` under src/components/admin and
 * src/pages/admin, the JSX element that directly contains it carries no
 * `truncate` class. (A sibling of a truncating span is the right shape.)
 */
const ROOT = resolve(__dirname, "..", "..");
const DIRS = ["src/components/admin", "src/pages/admin"];

function walk(rel: string, out: string[] = []): string[] {
  let names: string[];
  try { names = readdirSync(join(ROOT, rel)); } catch { return out; /* no such dir (src/pages/admin may not exist) */ }
  for (const n of names) {
    const p = `${rel}/${n}`;
    if (/\.tsx$/.test(n) && !/\.test\.tsx$/.test(n)) out.push(p);
    else if (!/\./.test(n)) walk(p, out);
  }
  return out;
}

/** The opening tag of the element that directly encloses `at`, or null. */
function parentOpener(src: string, at: number): string | null {
  let depth = 0;
  const re = /<\/?([A-Za-z][\w.]*)\b[^<>]*?(\/?)>/g;
  const tags: { i: number; text: string; close: boolean; self: boolean }[] = [];
  for (const m of src.slice(0, at).matchAll(re)) {
    tags.push({ i: m.index!, text: m[0], close: m[0].startsWith("</"), self: m[2] === "/" });
  }
  for (let k = tags.length - 1; k >= 0; k--) {
    const t = tags[k];
    if (t.self) continue;
    if (t.close) { depth++; continue; }
    if (depth === 0) return t.text;
    depth--;
  }
  return null;
}

describe("the admin Test tag is never clipped by a truncating parent (Q442)", () => {
  const sites: { file: string; parent: string | null }[] = [];
  for (const dir of DIRS) {
    for (const file of walk(dir)) {
      const src = blankComments(readFileSync(join(ROOT, file), "utf8"));
      for (const m of src.matchAll(/<TestTag\b/g)) sites.push({ file, parent: parentOpener(src, m.index!) });
    }
  }

  it("finds the tag sites (inventory floor)", () => {
    expect(sites.length).toBeGreaterThan(15);
    expect(sites.every((s) => s.parent !== null), JSON.stringify(sites.filter((s) => !s.parent))).toBe(true);
  });

  it("no site's direct parent truncates", () => {
    const bad = sites.filter((s) => /className=(?:"|\{`)[^"`]*\btruncate\b/.test(s.parent ?? ""));
    expect(bad.map((b) => `${b.file}: ${b.parent}`)).toEqual([]);
  });
});
// @mutate src/components/admin/AdminNotificationLogs.tsx | <span className="flex min-w-0 items-center gap-1.5"> | <span className="flex min-w-0 items-center gap-1.5 truncate">
