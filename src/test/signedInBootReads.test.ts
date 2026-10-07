/**
 * Q1171: a returning signed-in visitor's first-screen reads start from the
 * ENTRY, beside the app download, and the app takes them instead of asking
 * again. Measured before (local build, prod data, poster, 375 Slow 4G + CPU,
 * scripts/perf/cwv-lab.mjs): /jobs LCP 4880 ms, its reads starting at ~4.0 s.
 *
 * The behaviour cases drive the REAL supabase-js client through the app's
 * fetch wrapper: load 1 on /jobs learns the reads, load 2 replays them from the
 * entry module and the client's identical requests never reach the network.
 *
 * @mutate src/lib/bootReads.ts | const replayed = takeBootRead(read, headers.get("authorization")); | const replayed = null;
 * @mutate src/lib/bootReads.ts | authorization !== `Bearer ${replay.token}` | false
 * @mutate src/lib/bootReads.ts | now - replay.at > BOOT_READ_MAX_AGE_MS | false
 * @mutate src/lib/bootReads.ts | if (m === "POST" && RPC_READ.test(u) && | if (m === "POST" &&
 * @mutate src/boot/signedInBootReads.ts | entry.uid !== session.uid | false
 * @mutate src/boot/signedInBootReads.ts | if (r.m === "POST" && !/^\/rest\/v1\/rpc\/get_[a-z0-9_]+$/.test(r.u)) continue; | void 0;
 * @mutate src/boot/signedInBootReads.ts | if (s.expires_at * 1000 - Date.now() < 60_000) return null; | void 0;
 * @mutate src/integrations/supabase/client.ts | global: { fetch: bootReadsFetch(SUPABASE_URL) }, | global: {},
 * @mutate src/entry.ts | startSignedInBootReads(window.location.pathname); | void 0;
 * @mutate src/lib/authSignOut.ts | clearBootReads(); | void 0;
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  BOOT_READ_PATHS,
  BOOT_READS_STORE_KEY,
  BOOT_READS_WINDOW_KEY,
  MAX_REPLAYED,
  bootReadKey as entryKey,
  startSignedInBootReads,
} from "@/boot/signedInBootReads";
import { BOOT_READ_MAX_AGE_MS, bootReadKey as appKey, bootReadsFetch, clearBootReads } from "@/lib/bootReads";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");
const code = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));

const BASE = "https://proj.supabase.co";
const UID = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

function storeSession(token: string, uid = UID, expiresInS = 3600) {
  localStorage.setItem(
    "sb-proj-auth-token",
    JSON.stringify({ access_token: token, refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + expiresInS, user: { id: uid } }),
  );
}

/** A network that answers every REST call with rows naming the URL, and counts. */
function network() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return new Response(JSON.stringify([{ url }]), { status: 200, headers: { "Content-Type": "application/json" } });
  });
}

/** One app boot: the client the app builds, through the app's fetch wrapper. */
function bootApp(net: ReturnType<typeof network>, token: string) {
  const f = bootReadsFetch(BASE, () => net as unknown as typeof fetch);
  return createClient(BASE, "pk", { accessToken: async () => token, global: { fetch: f } });
}

/** The first screen's reads (and one write, which is never learned). */
async function firstScreen(c: ReturnType<typeof bootApp>) {
  const a = await c.from("jobs").select("id, title").eq("customer_id", UID).order("created_at", { ascending: false });
  const b = await c.from("profiles").select("*").eq("user_id", UID).maybeSingle();
  const r = await c.rpc("get_my_counts", { p_user: UID });
  await c.rpc("mark_seen", { p_user: UID });
  await c.from("analytics_events").insert({ name: "x" });
  return [a.data, b.data, r.data];
}

function restCalls(net: ReturnType<typeof network>) {
  return net.mock.calls.filter(([i]) => String(typeof i === "string" ? i : (i as Request).url ?? i).includes("/rest/v1/")).length;
}

beforeEach(() => {
  vi.stubEnv("VITE_SUPABASE_URL", BASE);
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "pk");
  window.history.replaceState(null, "", "/jobs");
  vi.spyOn(performance, "now").mockReturnValue(1000);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as unknown as Record<string, unknown>)[BOOT_READS_WINDOW_KEY];
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

/** Load 1: learn /jobs's reads. */
async function learn(token = "tok") {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  storeSession(token);
  const net = network();
  await firstScreen(bootApp(net, token));
  vi.advanceTimersByTime(9000);
  vi.useRealTimers();
  return net;
}

describe("signed-in first-screen replay (Q1171)", () => {
  it("learns the read-only requests only (GETs and rpc get_*), never a token", async () => {
    await learn();
    const raw = localStorage.getItem(BOOT_READS_STORE_KEY)!;
    const store = JSON.parse(raw);
    expect(store["/jobs"].uid).toBe(UID);
    const reads = store["/jobs"].reads as Array<{ m: string; u: string }>;
    expect(reads.map((r) => `${r.m} ${r.u.split("?")[0]}`)).toEqual([
      "GET /rest/v1/jobs",
      "GET /rest/v1/profiles",
      "POST /rest/v1/rpc/get_my_counts",
    ]);
    expect(raw).not.toContain("tok");
    expect(raw).not.toContain("pk");
  });

  it("the next cold load replays them from the entry and the app's identical requests never reach the network", async () => {
    // Can fail: without the replay, every read goes to the network again.
    const first = await learn();
    expect(restCalls(first)).toBe(5);

    const net = network();
    vi.stubGlobal("fetch", net);
    startSignedInBootReads("/jobs");
    expect(restCalls(net)).toBe(3); // the entry's replays, at boot
    const data = await firstScreen(bootApp(net, "tok"));
    // Only the two writes went out; the three reads were taken from the replay.
    expect(restCalls(net)).toBe(5);
    expect(data[0]).toEqual([{ url: expect.stringContaining("/rest/v1/jobs?") }]);
    expect(data[2]).toEqual([{ url: `${BASE}/rest/v1/rpc/get_my_counts` }]);
  });

  it("a replay made with another token is not taken (the app's own token wins)", async () => {
    await learn();
    const net = network();
    vi.stubGlobal("fetch", net);
    startSignedInBootReads("/jobs");
    await firstScreen(bootApp(net, "refreshed-token"));
    expect(restCalls(net)).toBe(3 + 5);
  });

  it("a stale replay is not taken", async () => {
    await learn();
    const net = network();
    vi.stubGlobal("fetch", net);
    startSignedInBootReads("/jobs");
    (window as unknown as Record<string, { at: number }>)[BOOT_READS_WINDOW_KEY].at -= BOOT_READ_MAX_AGE_MS + 1;
    await firstScreen(bootApp(net, "tok"));
    expect(restCalls(net)).toBe(3 + 5);
  });

  it("replays nothing for another user, an expiring session, or an unlearned path", async () => {
    await learn();
    const net = network();
    vi.stubGlobal("fetch", net);
    storeSession("tok", OTHER);
    startSignedInBootReads("/jobs");
    storeSession("tok", UID, 30);
    startSignedInBootReads("/jobs");
    storeSession("tok");
    startSignedInBootReads("/home");
    startSignedInBootReads("/browse");
    expect(net).not.toHaveBeenCalled();
  });

  it("a stored list that names a write or another host is never replayed", () => {
    storeSession("tok");
    localStorage.setItem(
      BOOT_READS_STORE_KEY,
      JSON.stringify({
        "/jobs": {
          uid: UID,
          at: 1,
          reads: [
            { m: "POST", u: "/rest/v1/rpc/mark_seen", b: "{}" },
            { m: "POST", u: "/rest/v1/jobs", b: "{}" },
            { m: "DELETE", u: "/rest/v1/jobs?id=eq.1" },
            { m: "GET", u: "https://evil.example/x" },
            { m: "GET", u: "/auth/v1/user" },
          ],
        },
      }),
    );
    const net = network();
    vi.stubGlobal("fetch", net);
    startSignedInBootReads("/jobs");
    expect(net).not.toHaveBeenCalled();
  });

  it("sign-out clears what was learned", async () => {
    await learn();
    expect(localStorage.getItem(BOOT_READS_STORE_KEY)).not.toBeNull();
    clearBootReads();
    expect(localStorage.getItem(BOOT_READS_STORE_KEY)).toBeNull();
    expect(code("src/lib/authSignOut.ts")).toMatch(/clearBootReads\(\);/);
  });

  it("the app's client and the entry are wired, and the two modules agree", () => {
    expect(code("src/integrations/supabase/client.ts")).toMatch(/global:\s*\{\s*fetch:\s*bootReadsFetch\(SUPABASE_URL\)\s*\}/);
    expect(code("src/entry.ts")).toMatch(/startSignedInBootReads\(window\.location\.pathname\);/);
    const app = code("src/lib/bootReads.ts");
    expect(app).toContain(`const STORE_KEY = "${BOOT_READS_STORE_KEY}";`);
    expect(app).toContain(`const WINDOW_KEY = "${BOOT_READS_WINDOW_KEY}";`);
    expect(app).toContain(`const PATHS = ${JSON.stringify(BOOT_READ_PATHS).replace(/,/g, ", ")};`);
    expect(app).toContain(`const MAX_RECORDED = ${MAX_REPLAYED};`);
    const r = { m: "POST" as const, u: "/rest/v1/rpc/get_x", b: '{"a":1}', a: "application/json", p: "count=exact" };
    expect(appKey(r)).toBe(entryKey(r));
    // Only the entry imports the boot module (a page importing it would make it
    // a shared chunk every page waits on; see guestJobsPrefetch).
    const importers = walkSource([resolve(ROOT, "src")])
      .filter((f) => !/\.test\.tsx?$/.test(f))
      .filter((f) => /from ["'](@\/boot|\.\/boot|\.\.?\/)[^"']*signedInBootReads["']/.test(code(f.replace(ROOT + "/", ""))))
      .map((f) => f.replace(ROOT + "/", ""));
    expect(importers).toEqual(["src/entry.ts"]);
  });
});
