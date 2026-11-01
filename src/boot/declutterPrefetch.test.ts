import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments, blankSqlComments } from "@/test/helpers/blankNonCode";
import { FEATURE_SWITCH_KEYS } from "@/config/featureSwitches";

import { DECLUTTER_PREFETCH_KEY, FIRST_SCREEN_SWITCH_KEYS, startDeclutterPrefetch } from "./declutterPrefetch";
import {
  previewIsTopOfList,
  readFirstScreenPreview,
  takeFirstScreenBundleSellers,
  takeFirstScreenDropStates,
  takeFirstScreenItems,
  takeFirstScreenPhotos,
  takeFirstScreenSwitches,
  takeFirstScreenWatching,
  takeFirstScreenZipParish,
} from "@/lib/declutter/bootPrefetch";

// @mutate src/boot/storedSession.ts | return session.expires_at - nowS > MIN_TOKEN_LIFE_S ? { token: session.access_token, userId } : null; | return { token: session.access_token, userId };
// @mutate src/boot/declutterPrefetch.ts | if (path !== "/declutter" \|\| typeof fetch !== "function") return; | if (typeof fetch !== "function") return;
// @mutate src/lib/declutter/bootPrefetch.ts |   return ok ? (x as FirstScreenAnswer) : null; |   return x as FirstScreenAnswer;
// @mutate src/lib/declutter/api.ts | const prefetched = await takeFirstScreenItems(); | const prefetched = null;
// @mutate src/lib/declutter/bootPrefetch.ts |   return a && !a.more ? a.items : null; |   return a ? a.items : null;
// @mutate src/lib/declutter/bootPrefetch.ts |   if (s.taken.has(part)) return null; |
// @mutate src/lib/declutter/bootPrefetch.ts |   if (userId !== undefined && userId !== s.userId) return null; |
// @mutate src/lib/declutter/bootPrefetch.ts |   if (!itemIds.every((id) => covered.has(id))) return null; |
// @mutate src/lib/declutter/bootPrefetch.ts |   return sellerIds.every((id) => asked.has(id)) ? a.bundle_sellers : null; |   return a.bundle_sellers;
// @mutate src/lib/declutter/bootPrefetch.ts |   if (!defaultView) return false; |
// @mutate src/lib/declutter/bootPrefetch.ts |   return known?.zip === zip && known.parish ? known.parish : null; |   return known?.parish ?? null;
// @mutate src/boot/signedInPrefetch.ts |   startDeclutterPrefetch(pathname); |

const BASE = "https://x.supabase.co";
const session = (expiresInS: number) =>
  JSON.stringify({ access_token: "tok", expires_at: Math.floor(Date.now() / 1000) + expiresInS, user: { id: "me" } });
const ANSWER = {
  switches: { declutter: true },
  items: [{ id: "a", seller_id: "s1", sale_mode: "offers", last_price_drop_on: null, drop_pct: 0 }, { id: "b", seller_id: "s2", sale_mode: null, last_price_drop_on: null }],
  more: false,
  near: null,
  photos: [{ item_id: "a" }, { item_id: "b" }],
  watching: ["a"],
  bundle_sellers: ["s1"],
  zip_parish: { zip: "70501", parish: "Lafayette" },
};
const stubAnswer = (body: unknown = ANSWER, status = 200) => {
  const f = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
  vi.stubGlobal("fetch", f);
  vi.stubEnv("VITE_SUPABASE_URL", BASE);
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "k");
  return f;
};
const start = () => {
  localStorage.setItem("sb-x-auth-token", session(3600));
  startDeclutterPrefetch("/declutter");
};

afterEach(() => {
  (window as unknown as Record<string, unknown>)[DECLUTTER_PREFETCH_KEY] = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
});

describe("the entry's /declutter first screen", () => {
  it("asks the one read, sending the member's session and every switch", () => {
    const f = stubAnswer();
    start();
    const [url, init] = f.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(url).toBe(`${BASE}/rest/v1/rpc/declutter_first_screen`);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body).p_switch_keys).toEqual([...FEATURE_SWITCH_KEYS]);
  });

  it("its switch keys are FEATURE_SWITCH_KEYS exactly, in a list the server accepts (at most 64)", () => {
    expect(FIRST_SCREEN_SWITCH_KEYS).toEqual([...FEATURE_SWITCH_KEYS]);
    expect(FIRST_SCREEN_SWITCH_KEYS.length).toBeGreaterThan(20);
    expect(FIRST_SCREEN_SWITCH_KEYS.length).toBeLessThanOrEqual(64);
  });

  it("the server answers every column Browse's reads ask for, and no other", () => {
    const api = blankComments(readFileSync("src/lib/declutter/api.ts", "utf8"));
    const quoted = (name: string) => (api.match(new RegExp(`const ${name} =\\s*"([^"]+)"`))?.[1] ?? "").split(", ");
    const asked = [...quoted("ITEM_COLUMNS"), ...quoted("DROP_COLUMNS")];
    expect(asked.length).toBeGreaterThan(15);
    const sql = blankSqlComments(readFileSync("supabase/migrations/20261031020705_declutter_drops_stopped_public.sql", "utf8"));
    const selected = (sql.match(/SELECT (i\.id,[\s\S]*?),\s*CASE WHEN/)?.[1] ?? "").split(",").map((c) => c.trim().replace(/^i\./, ""));
    expect(selected.sort()).toEqual(asked.sort());
  });

  it("each read takes its part once", async () => {
    stubAnswer();
    start();
    expect(await takeFirstScreenSwitches("me")).toEqual({ declutter: true });
    expect(await takeFirstScreenSwitches("me")).toBeNull();
    expect((await takeFirstScreenItems())?.map((i) => i.id)).toEqual(["a", "b"]);
    expect(await takeFirstScreenItems()).toBeNull();
    expect(await takeFirstScreenPhotos(["a"])).toEqual([{ item_id: "a" }]);
    expect(await takeFirstScreenPhotos(["a"])).toBeNull();
    expect((await takeFirstScreenDropStates(["a", "b"]))?.map((i) => i.id)).toEqual(["a", "b"]);
    expect(await takeFirstScreenDropStates(["a", "b"])).toBeNull();
    expect(await takeFirstScreenBundleSellers(["s1", "s2"])).toEqual(["s1"]);
    expect(await takeFirstScreenBundleSellers(["s1", "s2"])).toBeNull();
    expect(await takeFirstScreenWatching("me")).toEqual(["a"]);
    expect(await takeFirstScreenWatching("me")).toBeNull();
  });

  it("does nothing signed out, on another page, or with a session near expiry, malformed or nameless", () => {
    const f = stubAnswer();
    startDeclutterPrefetch("/declutter");
    localStorage.setItem("sb-x-auth-token", session(3600));
    startDeclutterPrefetch("/home");
    localStorage.setItem("sb-x-auth-token", session(10));
    startDeclutterPrefetch("/declutter");
    localStorage.setItem("sb-x-auth-token", "not json");
    startDeclutterPrefetch("/declutter");
    localStorage.setItem("sb-x-auth-token", JSON.stringify({ access_token: "t", expires_at: 9999999999 }));
    startDeclutterPrefetch("/declutter");
    expect(f).not.toHaveBeenCalled();
  });

  it("not deployed yet (404), refused, a broken answer or no network hands nothing over, so today's reads run", async () => {
    for (const stub of [
      () => stubAnswer({ code: "PGRST202" }, 404),
      () => stubAnswer({ message: "no" }, 500),
      () => stubAnswer({ items: "not a list" }),
      () => vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline")))),
    ]) {
      stub();
      vi.stubEnv("VITE_SUPABASE_URL", BASE);
      vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "k");
      start();
      expect(await takeFirstScreenItems()).toBeNull();
      expect(await takeFirstScreenSwitches("me")).toBeNull();
      expect(await takeFirstScreenPhotos(["a"])).toBeNull();
      expect(await takeFirstScreenDropStates(["a"])).toBeNull();
      expect(await takeFirstScreenBundleSellers(["s1"])).toBeNull();
      expect(await takeFirstScreenWatching("me")).toBeNull();
      expect(await readFirstScreenPreview()).toBeNull();
    }
  });

  it("another member's reads never take this member's answer", async () => {
    stubAnswer();
    start();
    expect(await takeFirstScreenSwitches("someone-else")).toBeNull();
    expect(await takeFirstScreenSwitches(null)).toBeNull();
    expect(await takeFirstScreenWatching("someone-else")).toBeNull();
  });

  it("what the answer did not cover is left to the page", async () => {
    stubAnswer();
    start();
    expect(await takeFirstScreenPhotos(["a", "not-covered"])).toBeNull();
    expect(await takeFirstScreenDropStates(["a", "not-covered"])).toBeNull();
    expect(await takeFirstScreenBundleSellers(["s1", "not-covered"])).toBeNull();
  });

  it("a capped answer is never the live list; it is only a preview", async () => {
    stubAnswer({ ...ANSWER, more: true, near: { lat: 30.45, lng: -91.15 } });
    start();
    expect(await takeFirstScreenItems()).toBeNull();
    const p = await readFirstScreenPreview();
    expect(p?.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(p?.near).toEqual({ lat: 30.45, lng: -91.15 });
  });

  it("the ZIP's parish is handed over only for that same ZIP, and only when the server knew it", async () => {
    stubAnswer();
    start();
    expect(await takeFirstScreenZipParish("70501")).toBe("Lafayette");
    expect(await takeFirstScreenZipParish("70501")).toBeNull();
    (window as unknown as Record<string, unknown>)[DECLUTTER_PREFETCH_KEY] = undefined;
    stubAnswer();
    start();
    expect(await takeFirstScreenZipParish("70808")).toBeNull();
    (window as unknown as Record<string, unknown>)[DECLUTTER_PREFETCH_KEY] = undefined;
    stubAnswer({ ...ANSWER, zip_parish: { zip: "70501", parish: null } });
    start();
    expect(await takeFirstScreenZipParish("70501")).toBeNull();
  });

  it("a whole answer is no preview", async () => {
    stubAnswer();
    start();
    expect(await readFirstScreenPreview()).toBeNull();
  });

  it("an old answer is not handed out", async () => {
    stubAnswer();
    start();
    expect(await takeFirstScreenItems(Date.now() + 60_000)).toBeNull();
    expect(await readFirstScreenPreview(Date.now() + 60_000)).toBeNull();
  });

  it("the preview shows only when it is the exact top of the final list", () => {
    const here = { lat: 30.45, lng: -91.15 };
    expect(previewIsTopOfList(here, { ...here }, true)).toBe(true);
    expect(previewIsTopOfList(null, null, true)).toBe(true);
    expect(previewIsTopOfList(here, { lat: 30.46, lng: -91.15 }, true)).toBe(false); // a device fix or a ZIP's centre
    expect(previewIsTopOfList(null, here, true)).toBe(false); // newest first, but the browser will sort by distance
    expect(previewIsTopOfList(here, null, true)).toBe(false);
    expect(previewIsTopOfList(here, here, false)).toBe(false); // a search, filter, distance or other sort
  });

  it("the entry starts it, and every read on the page takes its part", () => {
    const code = (p: string) => blankComments(readFileSync(p, "utf8"));
    // B78: through the entry's one signed-in prefetch door (src/boot/signedInPrefetch.ts).
    expect(code("src/entry.ts")).toMatch(/if \(hasToken\(\) && \/\^\\\/\(declutter\|home\)\\\/\?\$\/\.test\(window\.location\.pathname\)\) \{\s*void signedInPrefetch\(\)\s*\.then\(\(m\) => m\?\.startSignedInPrefetch\(window\.location\.pathname\)\)/);
    expect(code("src/boot/signedInPrefetch.ts")).toContain("startDeclutterPrefetch(pathname);");
    const api = code("src/lib/declutter/api.ts");
    for (const call of ["takeFirstScreenItems()", "takeFirstScreenPhotos(itemIds)", "takeFirstScreenDropStates(itemIds)", "takeFirstScreenWatching(userId)"]) {
      expect(api).toContain(call);
    }
    expect(code("src/lib/declutter/bundle.ts")).toContain("takeFirstScreenBundleSellers(sellerIds)");
    expect(code("src/hooks/useFeature.ts")).toContain("takeFirstScreenSwitches(uid)");
  });
});
