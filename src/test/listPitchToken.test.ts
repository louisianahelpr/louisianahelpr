import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

/**
 * EVERY JOB-CARD LIST USES ONE PITCH (Q213a).
 *
 * Owner decision (2026-09-25): every job-card list stands its cards 12px
 * apart, the same as `--shell-gap` on a phone. Before this, each list typed
 * its own gap and they disagreed (measured in WebKit against prod,
 * ~/.lh-shots/q213a/before.json): the signed-in Home feed 8.3px at 375 and
 * 12.3px at 1440 (`pb-2 lg:pb-2.5 xl:pb-3` on the virtualised row), the guest
 * /browse feed 10px (`gap-2.5`), My Posts 12px (`space-y-3`).
 *
 * The fix is ONE token, `--list-gap` (src/index.css), read through Tailwind's
 * `list` spacing key (`gap-list`, `space-y-list`, `pb-list`). This file:
 *  1. proves the token and the key exist and `.ds-activity-grid` reads it;
 *  2. finds, FROM SOURCE, every `.map(` in src/ that renders a job card or
 *     job-card skeleton, takes the container around it, and fails if that
 *     container does not use the `list` key or still types a numeric pitch;
 *  3. pins the two containers the scan cannot see through (the virtualised
 *     Home row, which pads instead of gapping, and PagedActivityList, whose
 *     map renders a plain wrapper around a caller's card).
 * The rendered pitch is proven by e2e/prod-audit/shell-spacing.spec.ts.
 *
 * Out of scope on purpose: the compact feed density (CompactFeedCard), whose
 * 48px rows are a divided list with no gap between them, and the gap BETWEEN
 * collapsible sections in ActivitySectionedView (a section gap, not a pitch).
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// Shown able to fail on the original defect and on the token itself:
// @mutate src/components/GuestBrowseSkeleton.tsx | "grid grid-cols-1 gap-list md:grid-cols-2 md:gap-4" | "grid grid-cols-1 gap-2.5 md:grid-cols-2 md:gap-4"
// @mutate src/components/dashboard/BrowseTasksFeed.tsx | className="pb-list" | className="pb-2 lg:pb-2.5 xl:pb-3"
// @mutate src/components/dashboard/BrowseTasksFeed.tsx | className="px-3 pt-3 pb-1 space-y-list" | className="px-3 pt-3 pb-1 space-y-2.5 lg:space-y-3"
// @mutate src/components/job-card/PagedActivityList.tsx | className="space-y-list ds-activity-grid" | className="space-y-3 ds-activity-grid"
// @mutate src/components/ActivityPageSkeleton.tsx | pb-0 space-y-list" | pb-0 space-y-2.5"
// @mutate src/index.css | --list-gap: 0.75rem; | --list-gap: 0.5rem;
// @mutate tailwind.config.ts | list: "var(--list-gap)", | list: "0.5rem",

/** The components that ARE a job card (or stand in for one while loading). */
const CARD = /<(JobCard|JobFeedCard|JobCardSkeleton|RecommendedJobCardSkeleton|ActivityCardSkeleton|ApplicationCardSkeleton)\b/;

function tsxUnder(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) tsxUnder(rel, out);
    else if (name.endsWith(".tsx") && !/\.test\.tsx$/.test(name)) out.push(rel);
  }
  return out;
}

const FILES = tsxUnder("src").map((rel) => ({ rel, code: blankComments(read(rel)) }));

/** Every `const NAME = "..."` / `const NAME = OTHER;` in src, to resolve `${NAME}`. */
const CONSTS = new Map<string, string>();
for (const { code } of FILES) {
  for (const m of code.matchAll(/const ([A-Z][A-Z0-9_]*) = "([^"]*)";/g)) CONSTS.set(m[1], m[2]);
}
for (const { code } of FILES) {
  for (const m of code.matchAll(/const ([A-Z][A-Z0-9_]*) = ([A-Z][A-Z0-9_]*);/g)) {
    const v = CONSTS.get(m[2]);
    if (v !== undefined) CONSTS.set(m[1], v);
  }
}

/**
 * The element that ENCLOSES `at` (the `.map(`): parse the JSX tags in the
 * 3000 chars before it, keeping a stack of open elements, and return the
 * innermost one still open. Braces are balanced inside an opening tag so an
 * arrow function's `>` does not end it.
 */
function enclosingOpenTag(code: string, at: number): string | null {
  const stack: string[] = [];
  let i = Math.max(0, at - 3000);
  while (i < at) {
    if (code[i] !== "<") {
      i++;
      continue;
    }
    if (code[i + 1] === "/") {
      const end = code.indexOf(">", i);
      if (end < 0 || end > at) break;
      stack.pop();
      i = end + 1;
      continue;
    }
    if (code[i + 1] === ">") {
      stack.push("<>");
      i += 2;
      continue;
    }
    if (!/[A-Za-z]/.test(code[i + 1] ?? "")) {
      i++;
      continue;
    }
    let depth = 0;
    let j = i + 1;
    for (; j < at; j++) {
      const ch = code[j];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
    }
    const tag = code.slice(i, j + 1);
    if (!tag.endsWith("/>")) stack.push(tag);
    i = j + 1;
  }
  return stack.length ? stack[stack.length - 1] : null;
}

/** The className of an opening tag, with `${CONST}` resolved. */
function classOf(tag: string | null): string | null {
  if (!tag) return null;
  const idx = tag.indexOf("className=");
  if (idx < 0) return null;
  let i = idx + "className=".length;
  let raw: string;
  if (tag[i] === '"') {
    raw = tag.slice(i + 1, tag.indexOf('"', i + 1));
  } else if (tag[i] === "{") {
    let depth = 0;
    const start = i;
    for (; i < tag.length; i++) {
      if (tag[i] === "{") depth++;
      else if (tag[i] === "}" && --depth === 0) break;
    }
    raw = tag.slice(start + 1, i);
  } else return null;
  return raw
    .replace(/\$\{([A-Z][A-Z0-9_]*)\}/g, (_, n: string) => CONSTS.get(n) ?? `UNRESOLVED(${n})`)
    .replace(/^`|`$/g, "");
}

/** A numeric pitch typed where the token belongs. `md:gap-4` is the two-column gutter, not a pitch. */
function numericPitch(cls: string): string[] {
  return cls
    .split(/\s+/)
    .filter((t) => /^(?:[a-z0-9]+:)*(?:space-y|gap|gap-y|pb)-(?:\d|\[)/.test(t))
    .filter((t) => t !== "md:gap-4")
    // Page-bottom padding on a list container (`pb-1`) is not a pitch; only
    // a per-row `pb-*` is, and that is pinned by its own test below.
    .filter((t) => !/^pb-/.test(t));
}

describe("every job-card list uses the one --list-gap pitch (Q213a)", () => {
  it("defines --list-gap as 12px, reads it through the `list` spacing key and in .ds-activity-grid", () => {
    const css = blankComments(read("src/index.css"));
    expect(css).toMatch(/:root\s*\{\s*--list-gap:\s*0\.75rem;\s*\}/);
    expect(css).toMatch(/\.ds-activity-grid\s*\{[^}]*gap:\s*var\(--list-gap\)/);
    expect(blankComments(read("tailwind.config.ts"))).toContain('list: "var(--list-gap)",');
  });

  const hits: { where: string; cls: string }[] = [];
  for (const { rel, code } of FILES) {
    for (const m of code.matchAll(/\.map\(/g)) {
      const at = m.index!;
      if (!CARD.test(code.slice(at, at + 160))) continue;
      const line = code.slice(0, at).split("\n").length;
      hits.push({ where: `${rel}:${line}`, cls: classOf(enclosingOpenTag(code, at)) ?? "NO CONTAINER CLASS" });
    }
  }

  it("finds the job-card lists from source (inventory floor)", () => {
    // 10 on 2026-09-26: GuestBrowseSkeleton x2, JobListPage x2,
    // ActivityPageSkeleton x2, BrowseTasksFeed x2, DashboardGuest x2.
    expect(hits.length).toBeGreaterThan(9);
  });

  it.each(hits.map((h) => [h.where, h] as const))("%s stands its cards --list-gap apart", (_w, h) => {
    expect(h.cls, `${h.where}: container "${h.cls}" does not use the list pitch`).toMatch(/(?:^|\s)(?:space-y|gap)-list(?:\s|$)/);
    expect(numericPitch(h.cls), `${h.where}: numeric pitch typed beside the token`).toEqual([]);
  });

  it("the virtualised Home feed pads each row by the token, and its size estimate includes it", () => {
    const code = blankComments(read("src/components/dashboard/BrowseTasksFeed.tsx"));
    const render = code.slice(code.indexOf("renderItem={(job, i) =>"), code.indexOf("<JobFeedCard"));
    expect(render).toContain('className="pb-list"');
    expect(render).not.toMatch(/\bpb-\d/);
    // ~83px card + 12px pitch.
    expect(code).toMatch(/estimateSize=\{95\}/);
  });

  it("PagedActivityList (My Posts / My Jobs) is on the token", () => {
    const code = blankComments(read("src/components/job-card/PagedActivityList.tsx"));
    expect(classOf(enclosingOpenTag(code, code.indexOf(".slice(0, shown).map(")))).toBe("space-y-list ds-activity-grid");
  });
});
