/**
 * B52 (11-03, Q1158/Q654): the Posted / Working lists are their own chunk, off Browse's boot download.
 *
 * JobsSection opens on Browse, yet it imported JobListPage statically, so every cold /jobs downloaded the lists and
 * the offer, activity and payment handlers only they run. JobListPage is lazy now. A cold link that opens on a list
 * starts its chunk from the entry through a tiny boot chunk (src/boot/jobsListRoute.ts: B46 measured the direct
 * import over the entry's band), bootReach names JobListPage as a first screen (unnamed, the lists' chunk pulled
 * signed-in-deep, declutter-first-screen and error-copy: list-link closure 452 -> 554 KB gz), and Browse warms the
 * chunk once the page has settled. Measured in ~/.lh-shots/b52-perf.
 */
// @mutate src/pages/jobs/JobsSection.tsx | import { navKey } from "@/lib/i18n/navLabels"; | import { navKey } from "@/lib/i18n/navLabels"; import "@/components/job-card/JobListPage";
// @mutate src/boot/routePreload.ts | signedIn: [() => import("@/pages/jobs/JobsSection"), protectedRoute, jobsListRoute], | signedIn: [() => import("@/pages/jobs/JobsSection"), protectedRoute],
// @mutate src/boot/jobsListRoute.ts |   if (path !== "/jobs") return false; |
// @mutate src/boot/jobsListRoute.ts | return tab ? tab === "posted" \|\| tab === "working" : | return tab ? tab === "posted" :
// @mutate src/boot/jobsListRoute.ts | if (jobListsOpenFirst(location.pathname, location.search)) { | if (false) {
// @mutate src/boot/jobsListRoute.ts |   if (!before.has(link)) link.setAttribute("data-lh-page-preload", ""); |
// @mutate scripts/perf/bootReach.mjs | toPosix(path.join(root, PROFILE_ROOT)), toPosix(path.join(root, JOB_LISTS_ROOT))]; | toPosix(path.join(root, PROFILE_ROOT))];
// @mutate src/pages/jobs/JobsSection.tsx | (onBrowse ? prefetchRoutesWhenIdle([JOB_LISTS_PREFETCH_KEY]) : undefined) | undefined
// @mutate src/pages/posts/PostsPage.tsx | import("@/components/job-card/JobListPage").catch(() => { | Promise.resolve().catch(() => {
// @mutate src/lib/routePrefetch.ts |   [JOB_LISTS_PREFETCH_KEY]: () => import("@/components/job-card/JobListPage"), |
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JOB_LISTS_ROOT, firstScreenRoots, staticReach } from "../../scripts/perf/bootReach.mjs";
import { blankComments } from "@/test/helpers/blankNonCode";
import { jobsOpensOnList } from "./jobsPrefetch";

const ROOT = join(__dirname, "..", "..");
const LISTS = "src/components/job-card/JobListPage.tsx";
const posix = (f: string) => f.replace(/\\/g, "/");
const code = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

describe("the job lists load alone (B52)", () => {
  it("Browse's first screen (JobsSection) does not statically reach JobListPage", () => {
    const reach = [...staticReach(ROOT, [join(ROOT, "src/pages/jobs/JobsSection.tsx")])].map(posix);
    // Inventory floor: the walk read the section's graph (Browse's feed among it).
    expect(reach.length).toBeGreaterThan(200);
    expect(reach.some((f) => f.endsWith("/src/pages/home/Dashboard.tsx"))).toBe(true);
    expect(reach.filter((f) => f.endsWith(`/${LISTS}`))).toEqual([]);
  });

  it("the entry starts the lists' boot chunk on signed-in /jobs only (not /posts: it held /posts' first frame back)", () => {
    const src = code("src/boot/routePreload.ts");
    expect(src).toMatch(/const jobsListRoute = \(\) => import\("@\/boot\/jobsListRoute"\);/);
    const row = (page: string) => src.split("\n").find((l) => l.includes(`signedIn: [() => import("${page}")`)) ?? "";
    expect(row("@/pages/jobs/JobsSection")).toContain("jobsListRoute");
    expect(row("@/pages/posts/PostsPage")).toMatch(/signedIn/);
    expect(row("@/pages/posts/PostsPage")).not.toContain("jobsListRoute");
  });

  it("the boot chunk, JobsSection and the warm-up name the same module", () => {
    const spec = 'import("@/components/job-card/JobListPage")';
    // PostsPage: /posts' own chunk starts the list beside JobsSection after its redirect (B52, measured).
    for (const rel of ["src/boot/jobsListRoute.ts", "src/pages/jobs/JobsSection.tsx", "src/lib/routePrefetch.ts", "src/pages/posts/PostsPage.tsx"]) expect(code(rel), rel).toContain(spec);
    // Same rules as routePreload.ts: no static imports, or the entry's chunk would drag app code in.
    expect(code("src/boot/jobsListRoute.ts")).not.toMatch(/^\s*import\s[^(]/m);
  });

  it("bootReach names JobListPage as a first screen", () => {
    expect(JOB_LISTS_ROOT).toBe(LISTS);
    const roots = firstScreenRoots(ROOT).map(posix);
    expect(roots.length).toBeGreaterThan(10);
    expect(roots.some((f) => f.endsWith(`/${LISTS}`))).toBe(true);
  });

  it("Browse warms the lists' chunk once the page has settled", () => {
    expect(code("src/pages/jobs/JobsSection.tsx")).toMatch(/onBrowse \? prefetchRoutesWhenIdle\(\[JOB_LISTS_PREFETCH_KEY\]\)/);
    expect(code("src/lib/routePrefetch.ts")).toMatch(/\[JOB_LISTS_PREFETCH_KEY\]: \(\) => import\("@\/components\/job-card\/JobListPage"\)/);
  });
});

describe("jobListsOpenFirst: which cold loads start the lists", () => {
  it("is JobsSection's own rule on /jobs for every link shape, and jobsPrefetch's", async () => {
    const { jobListsOpenFirst } = await import("./jobsListRoute");
    const { resolveJobsTab } = await import("@/pages/jobs/JobsSection");
    const links = ["", "?tab=posted", "?tab=working", "?tab=browse", "?tab=nonsense", "?job=a", "?filter=hired", "?highlight=a1",
      "?q=lawn", "?quotes=1", "?tab=browse&job=a", "?tab=posted&job=a", "?tab=working&job=a", "?status=open", "?ref=email"];
    let lists = 0;
    for (const s of links) {
      const params = new URLSearchParams(s);
      const raw = params.get("tab");
      const page = resolveJobsTab(params, raw === "posted" || raw === "working" ? raw : "browse");
      if (page !== "browse") lists++;
      expect(jobListsOpenFirst("/jobs", s), `/jobs${s} draws ${page}`).toBe(page !== "browse");
      expect(jobListsOpenFirst("/jobs/", s), `/jobs/${s}`).toBe(page !== "browse");
      expect(jobsOpensOnList(s), `jobsPrefetch: ${s}`).toBe(page !== "browse");
    }
    expect(lists).toBeGreaterThan(5);
    // Only /jobs: nothing else starts the lists.
    for (const p of ["/posts", "/home", "/", "/jobs/abc", "/declutter"]) expect(jobListsOpenFirst(p, "?tab=posted"), p).toBe(false);
  }, 60_000);
});

describe("the boot chunk starts the lists on a list link only", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    vi.doUnmock("@/components/job-card/JobListPage");
    vi.resetModules();
  });

  const load = async (url: string) => {
    window.history.replaceState(null, "", url);
    const started = vi.fn();
    vi.resetModules();
    vi.doMock("@/components/job-card/JobListPage", () => {
      started();
      return { default: () => null };
    });
    await import("./jobsListRoute");
    await new Promise((r) => setTimeout(r, 20));
    return started;
  };

  it("a Posted link starts the lists' chunk", async () => {
    expect(await load("/jobs?tab=posted")).toHaveBeenCalled();
  });

  it("Browse does not", async () => {
    expect(await load("/jobs")).not.toHaveBeenCalled();
  });

  it("marks the links it adds as the page's own (the boot watchdog skips them)", async () => {
    window.history.replaceState(null, "", "/jobs?tab=working");
    vi.resetModules();
    const link = document.createElement("link");
    link.rel = "modulepreload";
    vi.doMock("@/components/job-card/JobListPage", () => ({ default: () => null }));
    // The module's own import adds no link under vitest, so plant one the way Vite's helper would, mid-import.
    const append = document.head.appendChild.bind(document.head);
    const spy = vi.spyOn(document, "querySelectorAll");
    let calls = 0;
    spy.mockImplementation(((sel: string) => {
      calls++;
      if (calls === 2) append(link);
      return Document.prototype.querySelectorAll.call(document, sel);
    }) as typeof document.querySelectorAll);
    await import("./jobsListRoute");
    spy.mockRestore();
    expect(link.hasAttribute("data-lh-page-preload")).toBe(true);
    link.remove();
  });
});
