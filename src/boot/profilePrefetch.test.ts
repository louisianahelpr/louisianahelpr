/**
 * Lead 11-14 (after F260a): the You landing waited ~6 s on Slow 4G for four answers its arrival gate needs, asked only
 * once the app and Profile.js had run, in a chain. The entry now asks them at once beside the app download
 * (src/boot/profilePrefetch.ts), and each query takes its answer ONCE (src/lib/profileBootPrefetch.ts). This pins: the
 * route rule, the reads and their bodies, the hand-over rules (once, fresh, same member, same switch keys, same handle,
 * shape), that a failure hands nothing over, and that the three queries and the entry's door are wired.
 */
// @mutate src/boot/profilePrefetch.ts | if (path !== "/profile" \|\| new URLSearchParams(search).get("tab") \|\| typeof fetch !== "function") return; | if (path !== "/profile" \|\| typeof fetch !== "function") return;
// @mutate src/boot/profilePrefetch.ts |       if (!r.ok) return null; |
// @mutate src/boot/profilePrefetch.ts | profiles?select=handle&user_id=eq. | profiles?select=handle&id=eq.
// @mutate src/lib/profileBootPrefetch.ts |   if (!userId \|\| !s \|\| s.userId !== userId \|\| s.keys !== FEATURE_SWITCH_KEYS.join(",") \|\| !claim(s, "switches")) return null; |   if (!userId \|\| !s \|\| !claim(s, "switches")) return null;
// @mutate src/lib/profileBootPrefetch.ts |   if (!a \|\| a.handle !== handle \|\| !claim(s, "page")) return null; |   if (!a \|\| !claim(s, "page")) return null;
// @mutate src/lib/profileBootPrefetch.ts |   if (s.taken.has(part)) return false; |
// @mutate src/lib/profileBootPrefetch.ts |   return s && now - s.at <= PROFILE_PREFETCH_MAX_AGE_MS ? s : null; |   return s ?? null;
// @mutate src/hooks/useFeature.ts | (await takeFirstScreenSwitches(uid)) ?? (await takeProfileSwitches(uid)) | await takeFirstScreenSwitches(uid)
// @mutate src/components/landing/useSectionsOpen.ts | (await takeGuestSectionsOpen()) ?? (await takeProfileSectionsOpen()) | await takeGuestSectionsOpen()
// @mutate src/lib/profileLink/api.ts |   const boot = await takeProfilePage(handle); |   const boot = null as { data: unknown } \| null;
// @mutate src/boot/signedInPrefetch.ts |   startProfilePrefetch(pathname, location.search); |
// @mutate src/entry.ts | \|posts\|profile)?\/?$/.test(window.location.pathname) | \|posts)?\/?$/.test(window.location.pathname)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PROFILE_PREFETCH_KEY, startProfilePrefetch } from "./profilePrefetch";
import { FIRST_SCREEN_SWITCH_KEYS } from "./declutterPrefetch";
import { PROFILE_PREFETCH_MAX_AGE_MS, takeProfilePage, takeProfileSectionsOpen, takeProfileSwitches } from "@/lib/profileBootPrefetch";
import { blankComments } from "@/test/helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const code = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));
const UID = "11111111-2222-4333-8444-555555555555";
const STORE_KEY = "sb-test-auth-token";
const session = (expiresInS: number, id = UID) =>
  JSON.stringify({ access_token: "tok", expires_at: Math.floor(Date.now() / 1000) + expiresInS, user: { id } });
const ok = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;
const bad = () => ({ ok: false, json: async () => ({}) }) as unknown as Response;

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
function stubFetch(answer: (url: string) => Response) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return answer(url);
  }));
}
const PAGE = { display_name: "Pat", listings: [] };
const happy = (url: string) =>
  url.includes("rpc/feature_switches_for_me") ? ok({ declutter: true, shops: false })
  : url.includes("rpc/features_open_to_everyone") ? ok(["declutter"])
  : url.includes("/profiles?") ? ok([{ handle: "pat" }])
  : url.includes("rpc/public_profile_by_handle") ? ok(PAGE)
  : bad();
const slot = () => (window as unknown as Record<string, unknown>)[PROFILE_PREFETCH_KEY];
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://x.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "pk");
  localStorage.setItem(STORE_KEY, session(3600));
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>)[PROFILE_PREFETCH_KEY];
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the entry asks the You landing's gated reads at once", () => {
  it("fires only on a cold /profile landing (no ?tab=) with a live session", () => {
    stubFetch(happy);
    startProfilePrefetch("/profile", "?tab=earnings");
    startProfilePrefetch("/home", "");
    startProfilePrefetch("/profiles", "");
    expect(calls).toHaveLength(0);
    localStorage.setItem(STORE_KEY, session(10));
    startProfilePrefetch("/profile", "");
    expect(calls).toHaveLength(0);
    localStorage.setItem(STORE_KEY, session(3600));
    startProfilePrefetch("/profile/", "");
    expect(slot()).toBeTruthy();
  });

  it("asks the switches, open-to-everyone and the handle in parallel, then the page for that handle", async () => {
    stubFetch(happy);
    startProfilePrefetch("/profile", "");
    // Three at once, before any answers: no chain.
    expect(calls.map((c) => c.url.replace("https://x.supabase.co/rest/v1/", ""))).toEqual([
      "rpc/feature_switches_for_me",
      "rpc/features_open_to_everyone",
      `profiles?select=handle&user_id=eq.${UID}`,
    ]);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ p_keys: FIRST_SCREEN_SWITCH_KEYS });
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    await flush();
    await flush();
    expect(calls[3].url).toBe("https://x.supabase.co/rest/v1/rpc/public_profile_by_handle");
    expect(JSON.parse(String(calls[3].init?.body))).toEqual({ p_handle: "pat" });
  });

  it("hands each answer over once, to the same member, the same handle, while fresh", async () => {
    stubFetch(happy);
    startProfilePrefetch("/profile", "");
    expect(await takeProfileSwitches("someone-else")).toBeNull();
    expect(await takeProfileSwitches(UID)).toEqual({ declutter: true, shops: false });
    expect(await takeProfileSwitches(UID)).toBeNull();
    expect(await takeProfileSectionsOpen()).toEqual(["declutter"]);
    expect(await takeProfileSectionsOpen()).toBeNull();
    // Another handle (a /u page) never uses it up.
    expect(await takeProfilePage("other")).toBeNull();
    expect(await takeProfilePage("pat")).toEqual({ data: PAGE });
    expect(await takeProfilePage("pat")).toBeNull();
  });

  it("a 200 null page is a real 'no page'; a refused read, a stale or odd answer hands nothing over", async () => {
    stubFetch((u) => (u.includes("public_profile_by_handle") ? ok(null) : happy(u)));
    startProfilePrefetch("/profile", "");
    expect(await takeProfilePage("pat")).toEqual({ data: null });

    stubFetch((u) => (u.includes("public_profile_by_handle") || u.includes("features_open") ? bad() : u.includes("feature_switches") ? ok(["not", "a map"]) : happy(u)));
    startProfilePrefetch("/profile", "");
    expect(await takeProfilePage("pat")).toBeNull();
    expect(await takeProfileSectionsOpen()).toBeNull();
    expect(await takeProfileSwitches(UID)).toBeNull();

    stubFetch(happy);
    startProfilePrefetch("/profile", "");
    const later = Date.now() + PROFILE_PREFETCH_MAX_AGE_MS + 1;
    expect(await takeProfileSwitches(UID, later)).toBeNull();
    expect(await takeProfileSectionsOpen(later)).toBeNull();
    expect(await takeProfilePage("pat", later)).toBeNull();
  });

  it("the switch keys asked are exactly the app's", async () => {
    stubFetch(happy);
    startProfilePrefetch("/profile", "");
    (slot() as { keys: string }).keys = "declutter";
    expect(await takeProfileSwitches(UID)).toBeNull();
  });

  it("reads the handle by the same column the app reads its own profile row by (user_id, not id)", () => {
    // The first lab run read `id=eq.<uid>`: RLS answered [] and no page was ever handed over (cwv-lab 11-14,
    // ~/.lh-shots/b2-perf2-1114/step1-prefetch.json: public_profile_by_handle still asked by the app at 4.67 s).
    expect(code("src/hooks/useCurrentUser.ts")).toMatch(/\.from\("profiles"\)\.select\("\*"\)\.eq\("user_id", userId\)/);
    expect(code("src/boot/profilePrefetch.ts")).toContain("profiles?select=handle&user_id=eq.${encodeURIComponent(session.userId)}");
  });

  it("the three queries take their answer, and the entry's door starts it on /profile", () => {
    expect(code("src/hooks/useFeature.ts")).toMatch(/\(await takeFirstScreenSwitches\(uid\)\) \?\? \(await takeProfileSwitches\(uid\)\)/);
    expect(code("src/components/landing/useSectionsOpen.ts")).toMatch(/\(await takeGuestSectionsOpen\(\)\) \?\? \(await takeProfileSectionsOpen\(\)\)/);
    const api = code("src/lib/profileLink/api.ts");
    expect(api).toMatch(/const boot = await takeProfilePage\(handle\);/);
    expect(api).toMatch(/if \(!boot\) \{\s*const res = await supabase\.rpc\("public_profile_by_handle"/);
    expect(code("src/boot/signedInPrefetch.ts")).toMatch(/startProfilePrefetch\(pathname, location\.search\);/);
    const gate = /hasToken\(\) && (\/.*\/)\.test\(window\.location\.pathname\)/.exec(code("src/entry.ts"))?.[1];
    expect(gate).toBeTruthy();
    const re = new Function(`return ${gate}`)() as RegExp;
    expect(re.test("/profile")).toBe(true);
    expect(re.test("/profile/")).toBe(true);
  });
});
