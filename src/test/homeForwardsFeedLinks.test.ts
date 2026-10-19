/**
 * A /home LINK THAT OPENS SOMETHING IN THE JOB FEED STILL OPENS IT (Q2205).
 *
 * Found 2026-10-19 while retiring the old Home feed: /home became the Home
 * dashboard, but JobDetail's signed-in hand-off, the post-signup job intent,
 * native pushes and every stored notification row still link
 * `/home?quickApply=<id>`, and Stripe's boost return says `/home?boosted=`.
 * The dashboard reads none of them, so each would open Home and drop the job.
 *
 * Class: every feed param a /home link can carry. Inventory from source: each
 * `/home?<param>` written in src (comments blanked) must be either forwarded
 * (FEED_LINK_PARAMS) or one Home itself reads (HOME_OWN_PARAMS), exactly.
 *
 * @mutate src/pages/home/homeDashboard/feedLinkForward.ts | export const FEED_LINK_PARAMS = ["quickApply", "boosted", "boost_cancelled", "job", "cat", "wantsQuotes"] as const; | export const FEED_LINK_PARAMS = ["boosted", "boost_cancelled", "job", "cat"] as const;
 * @mutate src/pages/home/homeDashboard/feedLinkForward.ts |   p.set("tab", "browse"); |
 * @mutate src/pages/home/HomeDashboard.tsx |   if (forward) return <Navigate replace to={forward} />; |
 */
import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { FEED_LINK_PARAMS, feedLinkTarget } from "@/pages/home/homeDashboard/feedLinkForward";
import { resolveJobsTab } from "@/pages/jobs/JobsSection";
import { blankComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

/** Params Home (the dashboard) reads itself. */
const HOME_OWN_PARAMS = ["customize"];

const ROOT = process.cwd();
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("/home forwards feed links to Jobs > Browse", () => {
  it("each feed param forwards, keeps every param, and pins Browse", () => {
    for (const k of FEED_LINK_PARAMS) {
      const to = feedLinkTarget(`?${k}=abc&ref=notif`);
      expect(to, k).not.toBeNull();
      const u = new URL(to!, "https://x");
      expect(u.pathname).toBe("/jobs");
      expect(u.searchParams.get(k)).toBe("abc");
      expect(u.searchParams.get("ref")).toBe("notif");
      // JobsSection must open Browse for it (a bare ?job= would mean an old My Jobs link).
      expect(resolveJobsTab(u.searchParams, u.searchParams.get("tab") === "browse" ? "browse" : "x")).toBe("browse");
    }
  });

  it("a plain /home, or Home's own params, stays on Home", () => {
    expect(feedLinkTarget("")).toBeNull();
    expect(feedLinkTarget("?customize=1")).toBeNull();
  });

  it("HomeDashboard applies it before drawing anything", () => {
    const src = blankComments(readFileSync(join(ROOT, "src/pages/home/HomeDashboard.tsx"), "utf8"));
    expect(src).toMatch(/const forward = feedLinkTarget\(search, hash\);\s*[\s\S]{0,120}if \(forward\) return <Navigate replace to=\{forward\} \/>;/);
  });

  it("every /home?<param> written in src is forwarded or read by Home (inventory minus handled = empty)", () => {
    const seen = new Set<string>();
    for (const f of walk(join(ROOT, "src"))) {
      const code = blankComments(readFileSync(f, "utf8"));
      for (const m of code.matchAll(/\/home\?([A-Za-z_]+)=/g)) seen.add(`${m[1]}  (${relative(ROOT, f)})`);
    }
    expect(seen.size, "the scan found no /home links — it reads nothing").toBeGreaterThan(2);
    const handled = new Set<string>([...FEED_LINK_PARAMS, ...HOME_OWN_PARAMS]);
    const unhandled = [...seen].filter((s) => !handled.has(s.split(" ")[0]));
    expect(unhandled, "a /home link whose param neither Home nor the forward handles").toEqual([]);
  });
});
