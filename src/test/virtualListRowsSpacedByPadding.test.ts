/*
 * A virtualised list spaces its rows with PADDING inside each row, never with
 * margins between them.
 *
 * Owner, 2026-10-01, phone, admin Users list: the rows were spaced unevenly.
 * Rows of `VirtualList` / `VirtualizedJobList` are absolutely positioned and
 * sized by the virtualizer's measureElement, which reads the row's border box
 * and does not count margins. So `space-y-*` on the list (a margin on every row
 * but the first) moved only the SECOND row down and stacked every later row
 * flush: measured gaps 8, 0, 0, 0 on prod. `gap-*` does nothing at all on
 * absolute children. The working pattern is a bottom padding on the row
 * (`itemClassName="pb-…"`, or `pb-list` inside BrowseTasksFeed's row).
 *
 * The inventory is every JSX use of a virtualised list in src/, so a new call
 * site is covered the moment it is written.
 *
 * @mutate src/components/admin/AdminUsers.tsx | itemClassName="pb-1" | className="space-y-2"
 */
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";

const ROOT = resolve(__dirname, "..", "..");
const SRC = join(ROOT, "src");
const LIST_TAG = /<(VirtualList|VirtualizedJobList)\b/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

/** The opening tag's attribute text: from `<Tag` up to the first `renderItem`
 *  or the tag's own `>` / `/>` at brace depth 0, whichever comes first. */
function openingTag(src: string, start: number): string {
  let depth = 0;
  for (let i = start + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (depth === 0 && ch === ">") return src.slice(start, i + 1);
    if (depth === 0 && src.startsWith("renderItem", i)) return src.slice(start, i);
  }
  return src.slice(start);
}

const sites = walk(SRC).flatMap((file) => {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(LIST_TAG)].map((m) => ({
    where: `${relative(ROOT, file)}:${src.slice(0, m.index).split("\n").length}`,
    tag: openingTag(src, m.index!),
  }));
});

describe("virtualised list rows are spaced by padding, not margins", () => {
  it("the inventory is not empty", () => {
    expect(sites.length, "no <VirtualList>/<VirtualizedJobList> use found: this guard has rotted").toBeGreaterThan(0);
  });

  it.each(sites.map((s) => [s.where, s.tag] as const))("%s puts no space-y-*/gap-* on the list", (where, tag) => {
    const cls = [...tag.matchAll(/\bclassName=(?:"([^"]*)"|\{[^}]*\})/g)].map((m) => m[0]).join(" ");
    expect(
      cls,
      `${where}: a virtualised list spaces its rows with \`space-y-*\`/\`gap-*\`, which the virtualizer does not measure (gaps 8, 0, 0…). Use itemClassName="pb-…" instead.`,
    ).not.toMatch(/\b(space-y|gap(-y)?)-/);
  });
});
