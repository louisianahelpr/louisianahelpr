/**
 * Q1645 — an EMPTY state drawn with `<ErrorState>` pages ops.
 *
 * ErrorState reports every render as "Error screen shown: <title>" with
 * kind "user-error-screen" (src/components/ui/ErrorState.tsx), which is what
 * turns a person's error card into an ops alert ledger item. BrowseTasksFeed
 * drew the saved-only empty feed ("Nothing saved yet") with it, so a real
 * member opening "Only saved jobs" with nothing saved became an alert
 * (error_logs 2026-10-10T10:59:04Z, /home, non-seed account).
 *
 * The class: an error card exists to offer recovery, so every `<ErrorState>`
 * passes `onRetry`. A card with nothing to retry is an empty state and is
 * drawn with `<EmptyState>`. Inventory: every `<ErrorState` in src/ (comments
 * blanked), with a floor so a drifted scan cannot pass on nothing.
 *
 * @mutate src/components/dashboard/BrowseTasksFeed.tsx |           <EmptyState icon={Bookmark}\n            title="Nothing saved yet" |           <ErrorState\n            title="Nothing saved yet"
 */
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx") && !/\.test\.tsx$/.test(p)) out.push(p);
  }
  return out;
}

/** Each `<ErrorState …>` opening tag, up to its own `>` / `/>` at brace depth 0. */
function errorStateTags(): { where: string; tag: string }[] {
  const found: { where: string; tag: string }[] = [];
  for (const f of walk(join(ROOT, "src"))) {
    const src = blankComments(readFileSync(f, "utf8"));
    for (const m of src.matchAll(/<ErrorState\b/g)) {
      let depth = 0;
      let i = m.index! + m[0].length;
      for (; i < src.length; i++) {
        const c = src[i];
        if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === ">" && depth === 0) break;
      }
      const line = src.slice(0, m.index).split("\n").length;
      found.push({ where: `${relative(ROOT, f)}:${line}`, tag: src.slice(m.index, i + 1) });
    }
  }
  return found;
}

describe("an ErrorState always offers a retry; an empty state is an EmptyState (Q1645)", () => {
  const tags = errorStateTags();

  it("finds the app's error cards (a scan that finds none checks nothing)", () => {
    expect(tags.length).toBeGreaterThan(30);
  });

  it("every <ErrorState> passes onRetry", () => {
    const noRetry = tags.filter((t) => !/\bonRetry=\{(?!\s*undefined\s*\})/.test(t.tag)).map((t) => t.where);
    expect(
      noRetry,
      "every ErrorState reports a person's error screen to ops. A real error: give it a recovery action (onRetry). " +
        "Only a list that is genuinely, successfully empty belongs in EmptyState; never move a real error there to pass this.",
    ).toEqual([]);
  });
});
