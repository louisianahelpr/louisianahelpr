/**
 * Q2705 B, slice 2 (lead 11-05; owner rule: every page under 2 s). A signed-in phone opening /jobs showed only the
 * index.html boot logo until the whole app had arrived (Q1158 lab, 11-05: /jobs LCP 1752 ms on Slow 4G was that logo;
 * the section itself came with the app). Like /home (homeShellMatchesSkeleton.test.tsx), index.html now draws the
 * route's OWN skeleton, JobsSectionSkeleton's Browse frame (a bare /jobs opens on Browse), never a hand-rolled one.
 *
 * The #lh-jobs-shell block is byte-for-byte what JobsSectionSkeleton renders at a phone width on /jobs; a change to
 * the skeleton turns this red until the block is rewritten from the source:
 *   LH_WRITE_JOBS_SHELL=1 npx vitest run src/test/jobsShellMatchesSkeleton.test.tsx
 * It also pins: the shared show script shows it only on a bare /jobs with a stored session on the phone web; the show
 * rule; main.tsx drops it when not shown; JobsSection takes it away once mounted; the app drops it off /jobs and on
 * every error card (dropHomeShell); the build inlines its CSS.
 *
 * @mutate src/pages/jobs/JobsSection.tsx |   useEffect(() => removeShellOncePainted(JOBS_SHELL_ID), []); |
 * @mutate src/components/landing/HomeShellLeaves.tsx | !== "/jobs") dropJobsShell(); | === "/x") dropJobsShell();
 * @mutate src/components/landing/homeShell.ts |   dropJobsShell(doc);\n |\n
 * @mutate index.html | var page = { "/home": "home", "/jobs": "jobs", | var page = { "/home": "home",
 * @mutate src/index.css | [data-lh-app-shell="jobs"] #lh-jobs-shell {\n  display: block; | [data-lh-app-shell="jobs"] #lh-jobs-shell {\n  display: none;
 * @mutate src/main.tsx | if (document.documentElement.getAttribute("data-lh-app-shell") !== "jobs") document.getElementById("lh-jobs-shell")?.remove(); |
 * @mutate scripts/inline-shell-css.mjs |   { id: "lh-jobs-shell", | //{ id: "lh-jobs-shell",
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { LucideProvider } from "lucide-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ICON_STROKE_PX } from "@/lib/iconWeight";
import JobsSectionSkeleton from "@/components/JobsSectionSkeleton";
import { blankComments } from "./helpers/blankNonCode";
import { SHELL_END, SHELLS } from "../../scripts/inline-shell-css.mjs";

const ROOT = join(__dirname, "..", "..");
const INDEX = join(ROOT, "index.html");
const START = '<div id="lh-jobs-shell" aria-hidden="true" inert data-lh-shell="start">';

function rendered(): string {
  // A phone on a bare /jobs (Browse): the skeleton reads the desktop query and the URL on its first render.
  const mm = window.matchMedia;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia;
  window.history.replaceState(null, "", "/jobs");
  try {
    return renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <LucideProvider strokeWidth={ICON_STROKE_PX} nonScalingStroke>
          <MemoryRouter initialEntries={["/jobs"]}>
            <JobsSectionSkeleton />
          </MemoryRouter>
        </LucideProvider>
      </QueryClientProvider>,
    );
  } finally {
    window.matchMedia = mm;
    window.history.replaceState(null, "", "/");
  }
}

function block(html: string): string {
  const a = html.indexOf(START);
  expect(a, "index.html has the jobs shell").toBeGreaterThan(-1);
  const b = html.indexOf(SHELL_END, a);
  expect(b).toBeGreaterThan(a);
  return html.slice(a + START.length, b);
}

const showScript = (html: string) =>
  [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script[^>]*>/gi)].map((m) => m[1]).find((b) => b.includes("data-lh-app-shell")) ?? "";

describe("a signed-in phone's /jobs paints the Jobs section's own skeleton from the HTML (Q2705 B)", () => {
  it("index.html's jobs block is byte-for-byte what JobsSectionSkeleton renders on a phone's bare /jobs", () => {
    const want = rendered();
    let html = readFileSync(INDEX, "utf8");
    if (process.env.LH_WRITE_JOBS_SHELL === "1") {
      const a = html.indexOf(START) + START.length;
      html = html.slice(0, a) + want + html.slice(html.indexOf(SHELL_END, a));
      writeFileSync(INDEX, html);
    }
    expect(block(html)).toBe(want);
    expect(want.length).toBeGreaterThan(2000);
    expect(want).toContain('data-testid="jobs-route-skeleton"');
  });

  it("is shown only on a bare /jobs, with a stored session, on the phone web, and removed after 10 s at most", () => {
    const src = showScript(readFileSync(INDEX, "utf8"));
    expect(src).not.toBe("");
    type Opts = { search?: string; width?: number; capacitor?: boolean };
    const run = (pathname: string, keys: string[] = ["sb-proj-auth-token"], o: Opts = {}) => {
      const attrs: [string, string][] = [];
      const timers: number[] = [];
      new Function("document", "location", "localStorage", "window", "setTimeout", src)(
        { documentElement: { setAttribute: (n: string, v: string) => attrs.push([n, v]) }, getElementById: () => null },
        { pathname, search: o.search ?? "", hash: "", protocol: "https:" },
        { length: keys.length, key: (i: number) => keys[i] ?? null },
        { innerWidth: o.width ?? 375, ...(o.capacitor ? { Capacitor: {} } : {}) },
        (_: unknown, ms: number) => timers.push(ms),
      );
      return { shown: attrs.find(([n]) => n === "data-lh-app-shell")?.[1] ?? null, timers };
    };
    expect(run("/jobs")).toEqual({ shown: "jobs", timers: [10000] });
    expect(run("/jobs/").shown).toBe("jobs");
    expect(run("/home").shown, "the /home slice is unchanged").toBe("home");
    expect(run("/jobs", []).shown, "a guest").toBeNull();
    expect(run("/jobs", undefined, { search: "?tab=posted" }).shown, "another tab draws another frame").toBeNull();
    expect(run("/jobs", undefined, { width: 900 }).shown, "the desktop website").toBeNull();
    expect(run("/jobs", undefined, { capacitor: true }).shown, "native app").toBeNull();
    for (const p of ["/posts", "/jobs/settings", "/jobsx", "/constructor", "/__proto__"]) expect(run(p).shown, p).toBeNull();

    const index = readFileSync(INDEX, "utf8");
    expect(index).toMatch(/#lh-jobs-shell \{\s*display: none;\s*\}/);
    const sheet = readFileSync(join(ROOT, "src/index.css"), "utf8");
    expect(sheet).toMatch(/\[data-lh-app-shell="jobs"\] #lh-jobs-shell \{\s*display: block;\s*position: fixed;/);
  });

  it("main.tsx drops it when not shown; JobsSection takes it away once mounted, and the app off /jobs and on error cards", () => {
    const main = blankComments(readFileSync(join(ROOT, "src/main.tsx"), "utf8"));
    expect(main).toContain('if (document.documentElement.getAttribute("data-lh-app-shell") !== "jobs") document.getElementById("lh-jobs-shell")?.remove();');
    const section = blankComments(readFileSync(join(ROOT, "src/pages/jobs/JobsSection.tsx"), "utf8"));
    expect(section).toContain("useEffect(() => removeShellOncePainted(JOBS_SHELL_ID), []);");
    const leaves = blankComments(readFileSync(join(ROOT, "src/components/landing/HomeShellLeaves.tsx"), "utf8"));
    expect(leaves).toContain('if ((pathname.replace(/\\/+$/, "") || "/") !== "/jobs") dropJobsShell();');
    const helper = blankComments(readFileSync(join(ROOT, "src/components/landing/homeShell.ts"), "utf8"));
    expect(helper).toContain('export const JOBS_SHELL_ID = "lh-jobs-shell";');
    expect(helper).toMatch(/export function dropHomeShell\([^)]*\): void \{[^}]*dropJobsShell\(doc\);/);
  });

  it("the build inlines its CSS with the other shells'", () => {
    expect(SHELLS.map((s: { id: string }) => s.id)).toContain("lh-jobs-shell");
  });
});
