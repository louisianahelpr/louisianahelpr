/**
 * F288a (audit 11-10 W2: job pages 2.4-2.5 s to their largest paint on a phone). A job link (email, push, share) now
 * starts JobDetail, and for a member JobPage, from the ENTRY on the first network round (pathPageRoute.ts), instead of
 * after App.tsx ran (JobDetail) and JobDetail ran (JobPage). The job's own read starts as soon as JobPage runs.
 *
 * @mutate src/boot/routePreload.ts | \|jobs\/[0-9a-f-]{36})$/i; | )$/i;
 * @mutate src/boot/pathPageRoute.ts |     import("@/pages/jobs/jobPage/JobPage").catch(() => { |     Promise.resolve().catch(() => {
 * @mutate src/boot/pathPageRoute.ts |   if (member) { |   if (true) {
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loaded: string[] = [];
beforeEach(() => {
  for (const [path, name] of [
    ["@/pages/jobs/JobDetail", "JobDetail"],
    ["@/pages/jobs/jobPage/JobPage", "JobPage"],
  ] as const) {
    vi.doMock(path, () => {
      loaded.push(name);
      return { default: () => null };
    });
  }
});

afterEach(() => {
  localStorage.clear();
  loaded.length = 0;
  vi.resetModules();
  window.history.replaceState(null, "", "/");
});

const JOB = "/jobs/47b97729-d646-5a55-8765-8fb88a3e86ac";
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
async function open(path: string) {
  window.history.replaceState(null, "", path);
  const { preloadEntryRoute } = await import("./routePreload");
  preloadEntryRoute(path);
}

describe("a job page's chunks start on the first network round (F288a)", () => {
  it("a signed-in member starts JobDetail and JobPage", async () => {
    localStorage.setItem("sb-test-auth-token", "{}");
    await open(JOB);
    await vi.waitFor(() => expect(loaded).toEqual(expect.arrayContaining(["JobDetail", "JobPage"])));
  });

  it("a guest starts JobDetail only (its guest page lives there)", async () => {
    await open(`${JOB}/`);
    await vi.waitFor(() => expect(loaded).toContain("JobDetail"));
    await settle();
    expect(loaded).not.toContain("JobPage");
  });

  it("/jobs/settings and other /jobs paths start neither", async () => {
    localStorage.setItem("sb-test-auth-token", "{}");
    await open("/jobs/settings");
    await settle();
    await settle();
    expect(loaded).toEqual([]);
  });
});
