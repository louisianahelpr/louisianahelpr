/**
 * B100 (11-04, Q2708): a cold Posted / Working link sends get_my_activity_cores from the entry, and fetchActivityCores
 * takes that answer once. The prefetch is a plain fetch (the entry must not import Supabase or the column lists), so
 * its body is a hand-built copy; this holds it equal to the one fetchActivityCores sends through supabase-js.
 */
// @mutate src/boot/signedInPrefetch.ts |   startActivityCoresPrefetch(pathname); |
// @mutate src/lib/activityCoresTake.ts |   w[KEY] = undefined; |
// @mutate src/lib/activityCoresTake.ts | if (!s \|\| s.userId !== userId \|\| | if (!s \|\|
// @mutate src/lib/activityCores.ts |   const boot = takeActivityCoresPrefetch(userId); |   const boot = null as Promise<unknown> \| null;
// @mutate src/lib/activityCores.ts |       if (isPayload(early)) return early; |       if (early) return early as ActivityCoresPayload;
// @mutate src/entry.ts | \|jobs\|posts)? | \|jobs)?
// @mutate src/boot/activityCoresPrefetch.ts |   if (path === "/home") return true; |
// @mutate src/boot/activityCoresPrefetch.ts |   if (path === "/posts") return true; |
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ACTIVITY_CORES_PREFETCH_KEY, CORES_APPLICATION_COLUMNS, CORES_JOB_COLUMNS, opensOnActivityList, startActivityCoresPrefetch } from "./activityCoresPrefetch";
import { jobListsOpenFirst } from "./jobsListRoute";
import { ACTIVITY_CORES_PREFETCH_MAX_AGE_MS, takeActivityCoresPrefetch } from "@/lib/activityCoresTake";
import { JOB_READABLE_COLUMN_LIST } from "@/lib/jobColumns";
import { APPLICATION_READABLE_COLUMN_LIST } from "@/lib/applicationColumns";
import { blankComments } from "@/test/helpers/blankNonCode";
import { walkSource } from "@/test/helpers/walkSource";

const db = vi.hoisted(() => ({ calls: [] as { fn: string; args: unknown }[] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (fn: string, args: unknown) => { db.calls.push({ fn, args }); return Promise.resolve({ data: SERVER, error: null }); } },
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
const PAYLOAD = (tag: string) => ({
  posted_jobs: [{ id: tag }], poster_applications: [], offer_targets: [], my_applications: [], application_jobs: [], direct_offers: [], violations: [], reviews: [],
});
const SERVER = PAYLOAD("server");
const cores = await import("@/lib/activityCores");

const ROOT = resolve(__dirname, "../..");
const code = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));
const UID = "11111111-2222-4333-8444-555555555555";
const BASE = "https://proj.supabase.co";
const answering = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response);

afterEach(() => {
  (window as unknown as Record<string, unknown>)[ACTIVITY_CORES_PREFETCH_KEY] = undefined;
  cores.forgetActivityCoresRead();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
  db.calls.length = 0;
});

function signIn(expiresInS = 3600) {
  vi.stubEnv("VITE_SUPABASE_URL", BASE);
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "pk");
  localStorage.setItem("sb-proj-auth-token", JSON.stringify({ access_token: "tok", expires_at: Math.floor(Date.now() / 1000) + expiresInS, user: { id: UID } }));
}

describe("the Posted / Working lists' read starts from the entry (B100)", () => {
  it("sends the body fetchActivityCores sends", async () => {
    expect(CORES_JOB_COLUMNS).toEqual([...JOB_READABLE_COLUMN_LIST, "materials_note", "onboarding_fee_amount", "poster_marked_done_at"]);
    expect(CORES_APPLICATION_COLUMNS).toEqual([...APPLICATION_READABLE_COLUMN_LIST]);
    expect(code("src/lib/activityCores.ts")).toContain(
      'const POSTED_JOB_COLUMNS: readonly string[] = [...JOB_READABLE_COLUMN_LIST, "materials_note", "onboarding_fee_amount", "poster_marked_done_at"];',
    );
    await cores.fetchActivityCores(UID);
    expect(db.calls[0]).toEqual({ fn: "get_my_activity_cores", args: { p_job_columns: CORES_JOB_COLUMNS, p_application_columns: CORES_APPLICATION_COLUMNS } });
    signIn();
    const f = answering(PAYLOAD("boot"));
    vi.stubGlobal("fetch", f);
    startActivityCoresPrefetch("/posts", "");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/rest/v1/rpc/get_my_activity_cores`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(db.calls[0].args);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("fires on /posts, /home and on a /jobs link that opens on a list (jobListsOpenFirst's rule), nowhere else", () => {
    const links: [string, string][] = [
      ["/jobs", ""], ["/jobs", "?tab=posted"], ["/jobs", "?tab=working"], ["/jobs", "?tab=browse"], ["/jobs", "?job=1"], ["/jobs", "?quotes=1"],
      ["/jobs/", "?tab=posted"], ["/declutter", "?tab=posted"], ["/jobs", "?tab=browse&x=1"],
    ];
    expect(links.length).toBeGreaterThan(8);
    for (const [p, q] of links) expect(opensOnActivityList(p, q), p + q).toBe(jobListsOpenFirst(p, q));
    expect(opensOnActivityList("/posts", "")).toBe(true);
    expect(opensOnActivityList("/posts/", "")).toBe(true);
    // Home's first content reads the same cores (Builder 3 11-04, Q2706).
    expect(opensOnActivityList("/home", "")).toBe(true);
    expect(opensOnActivityList("/home/", "")).toBe(true);
    const gate = /hasToken\(\) && (\/.*\/)\.test\(window\.location\.pathname\)/.exec(code("src/entry.ts"))?.[1];
    const re = new Function(`return ${gate}`)() as RegExp;
    expect(re.test("/posts")).toBe(true);
    expect(re.test("/jobs")).toBe(true);
    expect(re.test("/home")).toBe(true);
    expect(code("src/boot/signedInPrefetch.ts")).toContain("startActivityCoresPrefetch(pathname);");
    const importers = walkSource([resolve(ROOT, "src")])
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => /(from ["']|import\(["'])[^"']*activityCoresPrefetch["']/.test(code(f.replace(ROOT + "/", ""))))
      .map((f) => f.replace(ROOT + "/", ""));
    expect(importers).toEqual(["src/boot/signedInPrefetch.ts"]);
    expect(code("src/lib/activityCoresTake.ts")).toContain(`const KEY = "${ACTIVITY_CORES_PREFETCH_KEY}";`);
  });

  it("never for a guest or an expiring session", () => {
    const f = answering(PAYLOAD("boot"));
    vi.stubGlobal("fetch", f);
    vi.stubEnv("VITE_SUPABASE_URL", BASE);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "pk");
    startActivityCoresPrefetch("/posts", "");
    signIn(30);
    startActivityCoresPrefetch("/posts", "");
    expect(f).not.toHaveBeenCalled();
  });

  it("fetchActivityCores takes it once, for that member, and both cores share it; the next read asks the server", async () => {
    signIn();
    vi.stubGlobal("fetch", answering(PAYLOAD("boot")));
    startActivityCoresPrefetch("/jobs", "?tab=posted");
    const [a, b] = await Promise.all([cores.fetchActivityCores(UID, "posted"), cores.fetchActivityCores(UID, "applied")]);
    expect(a?.posted_jobs).toEqual([{ id: "boot" }]);
    expect(b).toBe(a);
    expect(db.calls, "no second read").toEqual([]);
    const again = await cores.fetchActivityCores(UID, "posted");
    expect(again?.posted_jobs).toEqual([{ id: "server" }]);
    expect(db.calls).toHaveLength(1);
  });

  it("another member, an old answer, or a failed or odd one: the server is asked", async () => {
    signIn();
    const cases: [string, ReturnType<typeof vi.fn>][] = [
      ["refused", answering(PAYLOAD("boot"), false)],
      ["not the payload's shape", answering({ message: "x" })],
      ["offline", vi.fn(async () => { throw new TypeError("Failed to fetch"); })],
    ];
    expect(cases.length).toBeGreaterThan(2);
    for (const [why, f] of cases) {
      vi.stubGlobal("fetch", f);
      startActivityCoresPrefetch("/posts", "");
      const got = await cores.fetchActivityCores(UID);
      expect(got?.posted_jobs, why).toEqual([{ id: "server" }]);
      cores.forgetActivityCoresRead();
    }
    vi.stubGlobal("fetch", answering(PAYLOAD("boot")));
    startActivityCoresPrefetch("/posts", "");
    expect(takeActivityCoresPrefetch("someone-else"), "another member").toBeNull();
    expect(takeActivityCoresPrefetch(UID, Date.now() + ACTIVITY_CORES_PREFETCH_MAX_AGE_MS + 1), "old").toBeNull();
    expect(takeActivityCoresPrefetch(UID)).not.toBeNull();
    expect(takeActivityCoresPrefetch(UID), "once").toBeNull();
  });
});
