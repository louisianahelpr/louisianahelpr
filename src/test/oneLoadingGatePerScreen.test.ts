// Class guard (Q1754, nightly-red prod-audit, 2026-09-30): a screen whose
// lists come from two separate queries must not gate each list on its own
// `isLoading`. Gated apart, the faster list paints first and the slower one
// lands later: the page arrives in waves, which the prod page-settle audit
// (e2e/prod-audit/page-settle.spec.ts) fails. The Gift Card tab did exactly
// this: "sent" (one request) painted at 700ms, the nine "sent to you" cards
// (two requests) at 900ms, measured on prod in run 36766443019.
//
// The page-settle audit only sees it when the two responses land >= 200ms
// apart, so it is timing-dependent; this static check is not. Built from the
// world: every non-test .tsx under src/. In each, the identifiers bound from a
// `useQuery` result's `isLoading` are collected; when a file has two or more,
// none of them may be used on its own as a JSX branch (`{x ? (`). Combine them
// (`const listsLoading = a || b`) and branch on that instead.
//
// @mutate src/pages/profile/GiftCard.tsx | {listsLoading ? (\n                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3"> | {loadingReceived ? (\n                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx") && !/\.test\.tsx$/.test(p) && !p.includes(`${join("src", "test")}`)) out.push(p);
  }
  return out;
}

/**
 * Expressions that read one `useQuery`'s `isLoading`: a destructured binding
 * (`const { isLoading: loadingX } = useQuery`, or plain `isLoading`) or a
 * member read on a named result (`const q = useQuery` → `q.isLoading`).
 */
export function queryLoadingIdents(src: string): string[] {
  const ids = new Set<string>();
  const re = /const\s*\{([^}]*)\}\s*=\s*useQuery\b/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const b = /\bisLoading\s*(?::\s*([A-Za-z_$][\w$]*))?\s*(?:,|$)/.exec(m[1]);
    if (b) ids.add(b[1] ?? "isLoading");
  }
  const named = /const\s+([A-Za-z_$][\w$]*)\s*=\s*useQuery\b/g;
  for (let m = named.exec(src); m; m = named.exec(src)) ids.add(`${m[1]}.isLoading`);
  return [...ids];
}

export function separatelyGated(src: string): string[] {
  const ids = queryLoadingIdents(src);
  if (ids.length < 2) return [];
  return ids.filter((id) => new RegExp(`\\{\\s*${id.replace(/[$.]/g, "\\$&")}\\s*\\?\\s*\\(`).test(src));
}

describe("one loading gate per screen", () => {
  it("detects two lists gated on their own queries", () => {
    const bad = `const { data: a = [], isLoading: loadingA } = useQuery({});
const { data: b = [], isLoading: loadingB } = useQuery({});
return <>{loadingA ? (<S/>) : <A/>}{loadingB ? (<S/>) : <B/>}</>;`;
    expect(separatelyGated(bad)).toEqual(["loadingA", "loadingB"]);
    const good = bad.replace(/\{loading[AB] \?/g, "{both ?");
    expect(separatelyGated(good)).toEqual([]);
    // One list still on its own gate is already two waves.
    expect(separatelyGated(bad.replace("{loadingB ?", "{both ?"))).toEqual(["loadingA"]);
    // A single query branching on its own isLoading is fine.
    expect(separatelyGated("const { isLoading: l } = useQuery({}); return {l ? (<S/>) : <A/>};")).toEqual([]);
  });

  it("no screen branches on more than one query's isLoading", () => {
    const files = walk("src");
    const withQueries = files.filter((f) => queryLoadingIdents(readFileSync(f, "utf8")).length > 0);
    // Floor: far fewer means the destructure regex broke, not that the app shrank.
    expect(withQueries.length).toBeGreaterThanOrEqual(16); // measured 16 on 2026-09-30
    const offenders = files
      .map((f) => [f, separatelyGated(readFileSync(f, "utf8"))] as const)
      .filter(([, ids]) => ids.length > 0)
      .map(([f, ids]) => `${f}: ${ids.join(", ")}`);
    expect(offenders, "combine them into one gate so the lists arrive in one paint").toEqual([]);
  });
});
