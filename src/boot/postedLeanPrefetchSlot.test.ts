/**
 * Q2812 (Builder 2, 2026-11-15): the /home entry read of the LEAN posted core goes in its own window slot
 * (POSTED_LEAN_PREFETCH_KEY), and fetchLeanPostedCores takes it once, only for the member it was read for, only while
 * fresh, and only when the answer says it is the lean set. A lean answer must never stand in for the whole posted list
 * (fetchActivityCores), and the whole slot never carries it.
 */
// @mutate src/lib/activityCoresTake.ts |   w[LEAN_KEY] = undefined; |
// @mutate src/lib/activityCoresTake.ts |   if (!s \|\| s.userId !== userId \|\| now - s.at > ACTIVITY_CORES_PREFETCH_MAX_AGE_MS) return null;\n  w[LEAN_KEY] | if (!s) return null;\n  w[LEAN_KEY]
// @mutate src/lib/activityCores.ts |   const boot = takeLeanPostedPrefetch(userId); |   const boot = null as ReturnType<typeof takeLeanPostedPrefetch>;
// @mutate src/lib/activityCores.ts |       if (isLeanPosted(early)) return early; |       if (early) return early as ActivityCoresPayload;
// @mutate src/boot/activityCoresPrefetch.ts |     answers = { posted: Promise.resolve(null), applied: read(["applied"]) }; |     answers = { posted: read(["posted_lean"]), applied: read(["applied"]) };
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ACTIVITY_CORES_PREFETCH_KEY, POSTED_LEAN_PREFETCH_KEY, startActivityCoresPrefetch } from "./activityCoresPrefetch";
import { ACTIVITY_CORES_PREFETCH_MAX_AGE_MS, takeActivityCoresPrefetch, takeLeanPostedPrefetch } from "@/lib/activityCoresTake";
import { blankComments } from "@/test/helpers/blankNonCode";

const db = vi.hoisted(() => ({ calls: [] as { fn: string; args: unknown }[] }));
const PAYLOAD = (tag: string, lean = false) => ({
  posted_jobs: [{ id: tag }], poster_applications: [], offer_targets: [], ...(lean ? { posted_lean: true } : {}),
});
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (fn: string, args: unknown) => { db.calls.push({ fn, args }); return Promise.resolve({ data: PAYLOAD("server", true), error: null }); } },
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
const cores = await import("@/lib/activityCores");

const ROOT = resolve(__dirname, "../..");
const UID = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-2222-4333-8444-555555555555";
const BASE = "https://proj.supabase.co";
const w = window as unknown as Record<string, unknown>;
const slot = (userId: string, at: number, answer: unknown) => {
  w[POSTED_LEAN_PREFETCH_KEY] = { at, userId, postedLean: Promise.resolve(answer) };
};

afterEach(() => {
  w[POSTED_LEAN_PREFETCH_KEY] = undefined;
  w[ACTIVITY_CORES_PREFETCH_KEY] = undefined;
  cores.forgetActivityCoresRead();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
  db.calls.length = 0;
});

describe("Home's lean posted read has its own entry slot (Q2812)", () => {
  it("the take module reads the boot module's key", () => {
    expect(POSTED_LEAN_PREFETCH_KEY).not.toBe(ACTIVITY_CORES_PREFETCH_KEY);
    expect(blankComments(readFileSync(resolve(ROOT, "src/lib/activityCoresTake.ts"), "utf8"))).toContain(`const LEAN_KEY = "${POSTED_LEAN_PREFETCH_KEY}";`);
  });

  it("is taken once, only for its member, only while fresh", async () => {
    const now = Date.now();
    slot(UID, now, "a");
    expect(takeLeanPostedPrefetch(OTHER, now)).toBeNull();
    const p = takeLeanPostedPrefetch(UID, now);
    expect(await p).toBe("a");
    expect(takeLeanPostedPrefetch(UID, now)).toBeNull();
    slot(UID, now - ACTIVITY_CORES_PREFETCH_MAX_AGE_MS - 1, "stale");
    expect(takeLeanPostedPrefetch(UID, now)).toBeNull();
    slot(UID, now - ACTIVITY_CORES_PREFETCH_MAX_AGE_MS + 1_000, "fresh");
    expect(await takeLeanPostedPrefetch(UID, now)).toBe("fresh");
  });

  it("fetchLeanPostedCores uses a lean boot answer and sends nothing", async () => {
    slot(UID, Date.now(), PAYLOAD("boot", true));
    const got = await cores.fetchLeanPostedCores(UID);
    expect(got?.posted_jobs).toEqual([{ id: "boot" }]);
    expect(db.calls).toHaveLength(0);
  });

  it("a boot answer that is not the lean set (an older database's whole list, a failure) is never used", async () => {
    for (const answer of [PAYLOAD("whole"), null, { posted_lean: true }]) {
      slot(UID, Date.now(), answer);
      db.calls.length = 0;
      const got = await cores.fetchLeanPostedCores(UID);
      expect(got?.posted_jobs).toEqual([{ id: "server" }]);
      expect(db.calls).toHaveLength(1);
      expect((db.calls[0].args as { p_parts: string[] }).p_parts).toEqual(["posted_lean"]);
    }
  });

  it("another member's slot is left alone and the read asks the server", async () => {
    slot(OTHER, Date.now(), PAYLOAD("boot", true));
    const got = await cores.fetchLeanPostedCores(UID);
    expect(got?.posted_jobs).toEqual([{ id: "server" }]);
    expect(w[POSTED_LEAN_PREFETCH_KEY]).toBeTruthy();
  });

  it("/home fills the lean slot, and the whole slot's posted answer is null (a lean answer never becomes the whole list)", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", BASE);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "pk");
    localStorage.setItem("sb-proj-auth-token", JSON.stringify({ access_token: "tok", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: UID } }));
    const f = vi.fn(async () => ({ ok: true, json: async () => PAYLOAD("boot", true) }) as unknown as Response);
    vi.stubGlobal("fetch", f);
    Object.defineProperty(navigator, "connection", { value: { downlink: 8.1, rtt: 175 }, configurable: true });
    try {
      startActivityCoresPrefetch("/home", "");
    } finally {
      Object.defineProperty(navigator, "connection", { value: undefined, configurable: true });
    }
    expect(f).toHaveBeenCalledTimes(2);
    const whole = takeActivityCoresPrefetch(UID);
    expect(whole).not.toBeNull();
    expect(await whole!.posted).toBeNull();
    const lean = takeLeanPostedPrefetch(UID);
    expect(lean).not.toBeNull();
    expect(await lean).toEqual(PAYLOAD("boot", true));
  });
});
