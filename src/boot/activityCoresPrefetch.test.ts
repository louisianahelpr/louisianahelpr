/**
 * B100 (11-04, Q2708): a cold Posted / Working link sends get_my_activity_cores from the entry, and fetchActivityCores
 * takes that answer once. The prefetch is a plain fetch (the entry must not import Supabase or the column lists), so
 * its body is a hand-built copy; this holds it equal to the one fetchActivityCores sends through supabase-js.
 */
// @mutate src/boot/signedInPrefetch.ts |   startActivityCoresPrefetch(pathname); |
// @mutate src/lib/activityCoresTake.ts |   w[KEY] = undefined; |
// @mutate src/lib/activityCoresTake.ts | if (!s \|\| s.userId !== userId \|\| | if (!s \|\|
// @mutate src/lib/activityCores.ts |   const boot = takeActivityCoresPrefetch(userId); |   const boot = null as ReturnType<typeof takeActivityCoresPrefetch>;
// @mutate src/lib/activityCores.ts |     return hasKeys(early, PART_KEYS[which]) ? early : readWhole(); |     return early ? (early as ActivityCoresPayload) : readWhole();
// @mutate src/lib/activityCores.ts |     return hasKeys(early, PART_KEYS[which]) ? early : readWhole(); |     return isPayload(early) ? early : readWhole();
// @mutate src/lib/activityCores.ts |  const merged = { ...applied, ...posted, ...(days ? { open_continue_days: days } : {}) } as ActivityCoresPayload; |  const merged = { ...applied, ...posted } as ActivityCoresPayload;
// @mutate src/lib/activityCores.ts |       return part ? inFlight.parts[part] : inFlight.whole; |       return inFlight.whole;
// @mutate src/boot/activityCoresPrefetch.ts |     answers = { posted: read(["posted"]), applied: read(["applied"]) }; |     answers = { posted: read(), applied: read() };
// @mutate src/boot/activityCoresPrefetch.ts |   return path === "/posts" \|\| (path === "/jobs" && new URLSearchParams(search).get("tab") === "posted"); |   return path === "/posts";
// @mutate src/entry.ts | \|jobs\|posts)? | \|jobs)?
// @mutate src/boot/activityCoresPrefetch.ts |   if (path === "/home") return true; |
// @mutate src/boot/activityCoresPrefetch.ts |   if (path === "/posts") return true; |
// @mutate src/boot/activityCoresPrefetch.ts |   if (isHomePath(pathname) && !onFastLink()) return; |
// @mutate src/boot/activityCoresPrefetch.ts |   if (!c \|\| c.saveData === true) return false; |   if (!c) return false;
// @mutate src/boot/activityCoresPrefetch.ts | c.downlink >= 3 && | c.downlink >= 0 &&
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ACTIVITY_CORES_PREFETCH_KEY, CORES_APPLICATION_COLUMNS, CORES_APPLICATION_JOB_COLUMNS, CORES_JOB_COLUMNS, opensOnActivityList, opensOnPostedFirst, startActivityCoresPrefetch } from "./activityCoresPrefetch";
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
    expect(CORES_JOB_COLUMNS).toEqual(
      [...JOB_READABLE_COLUMN_LIST, "materials_note", "onboarding_fee_amount", "poster_marked_done_at"].filter((c) => !cores.POSTED_CORES_UNREAD_COLUMNS.includes(c)),
    );
    expect(CORES_JOB_COLUMNS).toEqual([...cores.POSTED_JOB_COLUMNS]);
    expect(CORES_APPLICATION_COLUMNS).toEqual([...APPLICATION_READABLE_COLUMN_LIST]);
    expect(CORES_APPLICATION_JOB_COLUMNS).toEqual([...cores.APPLICATION_JOB_COLUMNS]);
    await cores.fetchActivityCores(UID);
    expect(db.calls[0]).toEqual({ fn: "get_my_activity_cores", args: { p_job_columns: CORES_JOB_COLUMNS, p_application_columns: CORES_APPLICATION_COLUMNS, p_application_job_columns: CORES_APPLICATION_JOB_COLUMNS } });
    signIn();
    const f = answering(PAYLOAD("boot"));
    vi.stubGlobal("fetch", f);
    startActivityCoresPrefetch("/jobs", "?tab=working");
    expect(f).toHaveBeenCalledTimes(1);
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

  it("/home sends it only on a link that reports itself fast; /posts on any link", () => {
    const f = answering(PAYLOAD("boot"));
    vi.stubGlobal("fetch", f);
    signIn();
    const link = (c: unknown) => Object.defineProperty(navigator, "connection", { value: c, configurable: true });
    try {
      const slow = [undefined, { downlink: 1.4, rtt: 575 }, { downlink: 10, rtt: 50, saveData: true }, { downlink: 2, rtt: 100 }, { downlink: 10 }];
      for (const c of slow) {
        link(c);
        startActivityCoresPrefetch("/home", "");
        startActivityCoresPrefetch("/home/", "");
      }
      expect(f).not.toHaveBeenCalled();
      link({ downlink: 1.4, rtt: 575 });
      startActivityCoresPrefetch("/posts", "");
      // A Posted-first link: the two part calls (Q2706).
      expect(f).toHaveBeenCalledTimes(2);
      link({ downlink: 8.1, rtt: 175 });
      startActivityCoresPrefetch("/home", "");
      expect(f).toHaveBeenCalledTimes(3);
    } finally {
      link(undefined);
    }
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
    startActivityCoresPrefetch("/jobs", "?tab=working");
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

/**
 * Q2706 (Builder 3 11-05): on a Posted-first cold link the entry asks for the two parts apart (p_parts, 20261105111750),
 * so Posted paints on its own answer instead of waiting on the whole payload (mostly application_jobs). Lab proxy:
 * helper, Fast 4G, cold /jobs?tab=posted, LCP median 1856 -> 1336 ms.
 */
describe("a Posted-first link asks for the posted and applied parts apart (Q2706)", () => {
  const POSTED_PART = { posted_jobs: [{ id: "p" }], poster_applications: [], offer_targets: [], open_continue_days: [{ job_id: "p", status: "set", new_date: "2026-11-12", new_start_time: "10:00" }] };
  const APPLIED_PART = { my_applications: [{ id: "a" }], application_jobs: [{ id: "aj" }], direct_offers: [], violations: [], reviews: [], open_continue_days: [{ job_id: "aj", status: "set", new_date: "2026-11-10", new_start_time: "09:00" }] };
  const bodyOf = (f: ReturnType<typeof vi.fn>, i: number) => JSON.parse(String((f.mock.calls[i] as unknown as [string, RequestInit])[1].body));
  function deferred() {
    let resolve!: (v: unknown) => void;
    const p = new Promise<unknown>((r) => { resolve = r; });
    return { p, resolve };
  }

  it("/posts and /jobs?tab=posted send two calls, posted first, each the whole body plus its part; other list links send one", async () => {
    await cores.fetchActivityCores(UID);
    const whole = db.calls[0].args as Record<string, unknown>;
    signIn();
    for (const [path, q] of [["/posts", ""], ["/posts/", ""], ["/jobs", "?tab=posted"], ["/jobs/", "?tab=posted&x=1"]]) {
      const f = answering(PAYLOAD("boot"));
      vi.stubGlobal("fetch", f);
      startActivityCoresPrefetch(path, q);
      expect(f, path + q).toHaveBeenCalledTimes(2);
      expect(bodyOf(f, 0)).toEqual({ ...whole, p_parts: ["posted"] });
      expect(bodyOf(f, 1)).toEqual({ ...whole, p_parts: ["applied"] });
      (window as unknown as Record<string, unknown>)[ACTIVITY_CORES_PREFETCH_KEY] = undefined;
    }
    for (const [path, q] of [["/jobs", "?tab=working"], ["/jobs", "?job=1"]]) {
      const f = answering(PAYLOAD("boot"));
      vi.stubGlobal("fetch", f);
      startActivityCoresPrefetch(path, q);
      expect(f, path + q).toHaveBeenCalledTimes(1);
      expect(bodyOf(f, 0), path + q).toEqual(whole);
      (window as unknown as Record<string, unknown>)[ACTIVITY_CORES_PREFETCH_KEY] = undefined;
    }
    for (const [path, q] of [["/posts", ""], ["/jobs", "?tab=posted"], ["/jobs/", "?tab=posted"]]) expect(opensOnPostedFirst(path, q), path + q).toBe(true);
    for (const [path, q] of [["/jobs", "?tab=working"], ["/jobs", ""], ["/home", ""], ["/jobs", "?job=1"], ["/declutter", "?tab=posted"]]) expect(opensOnPostedFirst(path, q), path + q).toBe(false);
  });

  it("the posted core is handed its own answer while the applied one is still in flight; the server is never asked", async () => {
    signIn();
    const posted = deferred();
    const applied = deferred();
    const f = vi.fn()
      .mockImplementationOnce(async () => ({ ok: true, json: () => posted.p }) as unknown as Response)
      .mockImplementationOnce(async () => ({ ok: true, json: () => applied.p }) as unknown as Response);
    vi.stubGlobal("fetch", f);
    startActivityCoresPrefetch("/jobs", "?tab=posted");
    const p = cores.fetchActivityCores(UID, "posted");
    const a = cores.fetchActivityCores(UID, "applied");
    let appliedDone = false;
    void a.then(() => { appliedDone = true; });
    posted.resolve(POSTED_PART);
    const gotPosted = await p;
    expect(gotPosted?.posted_jobs).toEqual([{ id: "p" }]);
    expect(appliedDone, "Posted did not wait on the applied part").toBe(false);
    applied.resolve(APPLIED_PART);
    const gotApplied = await a;
    expect(gotApplied?.application_jobs).toEqual([{ id: "aj" }]);
    expect(db.calls, "no server read").toEqual([]);
  });

  it("a caller naming no part gets the two answers merged, with both parts' open continue days", async () => {
    signIn();
    const f = vi.fn()
      .mockImplementationOnce(async () => ({ ok: true, json: async () => POSTED_PART }) as unknown as Response)
      .mockImplementationOnce(async () => ({ ok: true, json: async () => APPLIED_PART }) as unknown as Response);
    vi.stubGlobal("fetch", f);
    startActivityCoresPrefetch("/posts", "");
    const got = await cores.fetchActivityCores(UID);
    expect(got?.posted_jobs).toEqual([{ id: "p" }]);
    expect(got?.application_jobs).toEqual([{ id: "aj" }]);
    expect(got?.open_continue_days?.map((d) => d.job_id)).toEqual(["p", "aj"]);
    expect(db.calls).toEqual([]);
  });

  it("a part whose answer failed or lacks its keys reads the whole cores once; the other keeps its answer", async () => {
    signIn();
    const cases: [string, () => Promise<Response>][] = [
      ["refused", async () => ({ ok: false, json: async () => null }) as unknown as Response],
      ["the posted part's keys, not the applied", async () => ({ ok: true, json: async () => POSTED_PART }) as unknown as Response],
      ["offline", async () => { throw new TypeError("Failed to fetch"); }],
    ];
    for (const [why, appliedAnswer] of cases) {
      const f = vi.fn()
        .mockImplementationOnce(async () => ({ ok: true, json: async () => POSTED_PART }) as unknown as Response)
        .mockImplementationOnce(appliedAnswer);
      vi.stubGlobal("fetch", f);
      startActivityCoresPrefetch("/posts", "");
      const [p, a] = await Promise.all([cores.fetchActivityCores(UID, "posted"), cores.fetchActivityCores(UID, "applied")]);
      expect(p?.posted_jobs, why).toEqual([{ id: "p" }]);
      expect(a?.posted_jobs, why).toEqual([{ id: "server" }]);
      expect(db.calls, why).toHaveLength(1);
      cores.forgetActivityCoresRead();
      db.calls.length = 0;
    }
    // An older database refuses both (PGRST202): one whole read serves both cores.
    vi.stubGlobal("fetch", answering(null, false));
    startActivityCoresPrefetch("/posts", "");
    const [p, a] = await Promise.all([cores.fetchActivityCores(UID, "posted"), cores.fetchActivityCores(UID, "applied")]);
    expect(p).toBe(a);
    expect(p?.posted_jobs).toEqual([{ id: "server" }]);
    expect(db.calls).toHaveLength(1);
  });
});

