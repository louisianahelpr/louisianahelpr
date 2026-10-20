/**
 * A CATEGORY CHIP IS NEVER RUST. Rust is money only (spec v2 §1.1, §12 "Use
 * rust for anything that is not money"). A category ("Lawn care", "Moving")
 * is a label, so its chip is neutral.
 *
 * Found 2026-10-20 (lead, builder1e quick wins): the admin Jobs list and the
 * admin job detail dialog wore the category as `<Badge variant="sienna">`,
 * a rust chip on every row of the admin Jobs queue.
 *
 * CLASS, not instance: every tracked .tsx under src/ is scanned for an element
 * whose text is a category label (`categoryLabels[...]`, `formatCategory(...)`,
 * `getCategoryLabel(...)`, `categoryLabel(...)`), and the element that directly
 * wraps it must not carry a rust token: the Badge `sienna` variant,
 * --burnt-sienna, --sienna-ink, --accent-ink or --money.
 *
 * @mutate src/components/admin/adminJobs/JobListItem.tsx | <Badge variant="secondary" className="text-ds-11">{categoryLabels[job.category] | <Badge variant="sienna" className="text-ds-11">{categoryLabels[job.category]
 * @mutate src/components/admin/adminJobs/JobDetailDialog.tsx | <Badge variant="secondary">{categoryLabels[detailJob.category] | <Badge variant="sienna">{categoryLabels[detailJob.category]
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = path.resolve(__dirname, "../..");
const LABEL = /categoryLabels\[|formatCategory\(|getCategoryLabel\(|\bcategoryLabel\(/g;
const RUST = /variant=["']sienna["']|--burnt-sienna|--sienna-ink|--accent-ink|--money\b/;

/** The opening tag of the element whose children hold `at`: the last `<Tag` before
 *  `at` that is not a closing tag, read up to its `>`. */
function wrappingTag(src: string, at: number): string | null {
  for (let i = at; i >= 0; i--) {
    if (src[i] === "<" && /[A-Za-z]/.test(src[i + 1] ?? "")) {
      const end = src.indexOf(">", i);
      if (end === -1 || end > at) return null; // inside an attribute, not children
      return src.slice(i, end + 1);
    }
    if (src[i] === "<" && src[i + 1] === "/") return null; // a sibling closed first
  }
  return null;
}

function scan(): { sites: number; bad: string[] } {
  let sites = 0;
  const bad: string[] = [];
  for (const rel of trackedFiles("src")) {
    if (!rel.endsWith(".tsx") || rel.startsWith("src/test/") || /\.test\.tsx$/.test(rel)) continue;
    const src = blankComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
    for (const m of src.matchAll(LABEL)) {
      // Only labels rendered as JSX children: `{` opens the expression.
      const before = src.slice(Math.max(0, m.index! - 200), m.index!);
      if (!/\{[^{}]*$/.test(before)) continue;
      const tag = wrappingTag(src, m.index!);
      if (!tag) continue;
      sites++;
      if (RUST.test(tag)) {
        const line = src.slice(0, m.index!).split("\n").length;
        bad.push(`${rel}:${line} ${tag}`);
      }
    }
  }
  return { sites, bad };
}

describe("category chips are never rust (rust = money, spec v2 §1.1)", () => {
  const { sites, bad } = scan();
  it("finds the category-label render sites (inventory floor)", () => {
    expect(sites).toBeGreaterThan(10);
  });
  it("no category label is wrapped in a rust chip", () => {
    expect(bad).toEqual([]);
  });
});
