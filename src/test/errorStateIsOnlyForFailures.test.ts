/**
 * CLASS GUARD: ErrorState is only ever drawn for a failure (Q1644).
 *
 * ErrorState is EmptyState plus an alert icon, the eyebrow "Hiccup on our
 * end", and a report() of "Error screen shown: <title>" on every mount, which
 * the user-error-screen alert and Sentry count. Measured 2026-10-10 10:59Z:
 * the saved-only browse feed with nothing saved drew ErrorState titled
 * "Nothing saved yet", so a person who had simply saved nothing read "Hiccup
 * on our end" and the ops ledger opened two alerts (Q1644 Sentry, Q1645
 * user-error-screen) for a correct empty state.
 *
 * Every other ErrorState title in src/ is a failure sentence ("We couldn't
 * load ..."). This holds every one to that: each string literal in a title
 * must read as a failure, and an ErrorState with no title gets the default
 * "We couldn't load this." Inventory: every <ErrorState in tracked src/*.tsx.
 */
// @mutate src/components/dashboard/SavedOnlyState.tsx | <EmptyState icon={Bookmark} | <ErrorState
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const FAILURE = /couldn['’]?t|could not|can['’]?t|cannot|failed|went wrong|error|unavailable|isn['’]t working|not load/i;

/** The value of the `title=` prop inside one JSX opening tag, or null when absent. */
export function titleProp(tag: string): string | null {
  const at = /\btitle=/.exec(tag);
  if (!at) return null;
  let i = at.index + at[0].length;
  if (tag[i] === '"' || tag[i] === "'") {
    const q = tag[i];
    const end = tag.indexOf(q, i + 1);
    return tag.slice(i, end + 1);
  }
  if (tag[i] !== "{") return null;
  let depth = 0;
  const start = i;
  for (; i < tag.length; i++) {
    if (tag[i] === "{") depth++;
    if (tag[i] === "}" && --depth === 0) return tag.slice(start, i + 1);
  }
  return tag.slice(start);
}

/** The opening tag starting at `from` (up to the first `>` outside braces and quotes). */
export function openingTag(src: string, from: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return src.slice(from, i + 1);
  }
  return src.slice(from);
}

/** Every string literal in a title expression (template-literal holes dropped). */
export function literals(expr: string): string[] {
  return [...expr.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)].map((m) => (m[1] ?? m[2] ?? m[3]).replace(/\$\{[^}]*\}/g, ""));
}

const uses = trackedFiles("src")
  .filter((f) => f.endsWith(".tsx") && !/\.test\.tsx$/.test(f) && f !== "src/components/ui/ErrorState.tsx")
  .flatMap((file) => {
    const src = blankComments(readFileSync(resolve(ROOT, file), "utf8"));
    return [...src.matchAll(/<ErrorState\b/g)].map((m) => ({ file, tag: openingTag(src, m.index!) }));
  });

describe("ErrorState is only drawn for a failure (Q1644)", () => {
  it("finds every ErrorState in src (inventory floor)", () => {
    expect(uses.length).toBeGreaterThan(40);
  });

  it("every ErrorState title reads as a failure (use EmptyState for an empty list)", () => {
    const bad = uses.flatMap(({ file, tag }) => {
      const title = titleProp(tag);
      if (title === null) return []; // the default, "We couldn't load this."
      const lits = literals(title);
      if (!lits.length) return [`${file}: title ${title} has no literal to judge; name the failure in the title`];
      return lits.filter((l) => !FAILURE.test(l)).map((l) => `${file}: "${l}"`);
    });
    expect(bad).toEqual([]);
  });

  it("the judge itself: the 2026-10-10 empty-state title fails, a failure title passes", () => {
    expect(FAILURE.test("Nothing saved yet")).toBe(false);
    expect(FAILURE.test("We couldn't load your pets.")).toBe(true);
    expect(literals('{isError ? "We couldn\'t load payout batches." : "We couldn\'t load payout holds."}')).toHaveLength(2);
  });
});
