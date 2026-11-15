/**
 * Builder 2 (11-15): a member's first-screen reads start from index.html's HEAD, not from the entry.
 *
 * cwv-lab (signed-in /home, helper persona, Slow 4G + 4x, 375, 3 runs): signedInPrefetch.js was requested only once the
 * entry ran (1.47 s) and, sharing the link with ~400 KB of app JS, arrived at 2.92 s, so every entry read started at
 * 2.93 s. An inline script in the head now imports that chunk for a member with a live stored session, on the routes
 * the entry starts it for. The build writes the chunk's URL into <meta name="lh-signed-in-prefetch"> (vite.config.ts),
 * because a hashed inline script cannot name a hashed file. The entry's own later call does nothing (one start).
 *
 * Also here: Home's poster first-job read (usePosterFirstJob, which topSettled waits on) is asked by the entry beside
 * the first-job counts and taken once (homePrefetch.ts / homePrefetchTake.ts / PosterFirstJobCard.tsx).
 */
// @mutate index.html | m.startSignedInPrefetch(path); |
// @mutate index.html |             if (live.expires_at - Date.now() / 1000 <= 60) return; |
// @mutate index.html | if (!src \|\| !/^\/(home)?\/?$/.test(path)) return; | if (!src) return;
// @mutate index.html | if (!src \|\| !/^\/(home)?\/?$/.test(path)) return; | if (!src \|\| !/^\/home\/?$/.test(path)) return;
// @mutate index.html | if (!live \|\| typeof live.access_token !== "string" | if (!live \|\| typeof live.refresh_token !== "string"
// @mutate src/boot/signedInPrefetch.ts |   if (w[SIGNED_IN_PREFETCH_STARTED_KEY]) return; |
// @mutate vite.config.ts |         if (!chunk) throw new Error("lh-signed-in-prefetch-url: no chunk for src/boot/signedInPrefetch.ts"); |
// @mutate vite.config.ts |         return html.replace(meta, `<meta name="lh-signed-in-prefetch" content="/${chunk.fileName}" />`); |         return html;
// @mutate src/boot/homePrefetch.ts |   w[HOME_POSTER_PREFETCH_KEY] = { at: Date.now(), userId: session.userId, rows: poster }; |
// @mutate src/boot/homePrefetch.ts |   u.searchParams.set("limit", "50"); |
// @mutate src/pages/home/homeDashboard/homePrefetchTake.ts |   w[POSTER_KEY] = undefined; |
// @mutate src/pages/home/homeDashboard/homePrefetchTake.ts |   if (!s \|\| s.userId !== userId) return null; |   if (!s) return null;
// @mutate src/pages/home/homeDashboard/homePrefetchTake.ts |   if (now - s.at > HOME_PREFETCH_MAX_AGE_MS) return null; |
// @mutate src/pages/home/homeDashboard/homePrefetchTake.ts |     (rows) => (Array.isArray(rows) ? (rows as Record<string, unknown>[]) : null), |     (rows) => rows as Record<string, unknown>[],
// @mutate src/pages/home/homeDashboard/PosterFirstJobCard.tsx |       if (pre) return posterFirstJobState(pre); |
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { blankComments } from "@/test/helpers/blankNonCode";
import { SIGNED_IN_PREFETCH_STARTED_KEY, startSignedInPrefetch } from "./signedInPrefetch";
import { HOME_POSTER_PREFETCH_KEY, homePosterFirstJobUrl, startHomePrefetch } from "./homePrefetch";
import { HOME_PREFETCH_MAX_AGE_MS, takeHomePosterFirstJobPrefetch } from "@/pages/home/homeDashboard/homePrefetchTake";

const ROOT = resolve(__dirname, "../..");
const raw = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const code = (p: string) => blankComments(raw(p));
const UID = "11111111-2222-4333-8444-555555555555";
const w = window as unknown as Record<string, unknown>;

/** The head script that reads the meta (index.html), as written. */
function headScript(): string {
  const html = raw("index.html");
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map((m) => m[1]);
  const mine = scripts.filter((s) => s.includes('meta[name="lh-signed-in-prefetch"]'));
  expect(mine).toHaveLength(1);
  return mine[0];
}

/** Runs the head script with `import()` swapped for a spy; resolves once its promise chain has run. */
async function runHead(o: { path: string; meta?: string; session?: unknown }): Promise<{ imported: string[]; started: string[] }> {
  document.head.innerHTML = `<meta name="lh-signed-in-prefetch" content="${o.meta ?? "/assets/signedInPrefetch-x.js"}" />`;
  window.history.replaceState(null, "", o.path);
  localStorage.clear();
  if (o.session !== undefined) localStorage.setItem("sb-proj-auth-token", JSON.stringify(o.session));
  const imported: string[] = [];
  const started: string[] = [];
  const body = headScript();
  expect(body).toContain("import(src)");
  const fn = new Function("__import", body.replace("import(src)", "__import(src)"));
  fn((src: string) => {
    imported.push(src);
    return Promise.resolve({ startSignedInPrefetch: (p: string) => started.push(p) });
  });
  await new Promise((r) => setTimeout(r, 0));
  return { imported, started };
}
const live = (inS = 3600) => ({ access_token: "tok", expires_at: Math.floor(Date.now() / 1000) + inS, user: { id: UID } });

afterEach(() => {
  for (const k of [SIGNED_IN_PREFETCH_STARTED_KEY, HOME_POSTER_PREFETCH_KEY, "__lhHomePrefetch", "__lhHomePagePrefetch", "__lhJobsPrefetch"]) w[k] = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
  document.head.innerHTML = "";
  window.history.replaceState(null, "", "/");
});

describe("index.html's head starts a member's first-screen reads (Builder 2, 11-15)", () => {
  it("imports the chunk the meta names and starts it for this path, for a member with a live session", async () => {
    for (const path of ["/home", "/home/", "/"]) {
      const r = await runHead({ path, session: live() });
      expect(r.imported, path).toEqual(["/assets/signedInPrefetch-x.js"]);
      expect(r.started, path).toEqual([path]);
    }
  });

  it("does nothing for a guest, an expiring or malformed session, another route, or a build that wrote no URL", async () => {
    expect((await runHead({ path: "/home" })).imported).toEqual([]);
    expect((await runHead({ path: "/home", session: live(30) })).imported).toEqual([]);
    expect((await runHead({ path: "/home", session: { refresh_token: "r", expires_at: 9e9, user: { id: UID } } })).imported).toEqual([]);
    expect((await runHead({ path: "/home", session: { access_token: "t", expires_at: 9e9 } })).imported).toEqual([]);
    for (const path of ["/messages", "/jobs", "/profile", "/posts", "/declutter", "/declutter/item/abc-1", "/home/x"]) {
      expect((await runHead({ path, session: live() })).imported, path).toEqual([]);
    }
    expect((await runHead({ path: "/home", session: live(), meta: "" })).imported).toEqual([]);
  });

  it("its routes are ones the entry also starts for a member, and the meta ships empty for the build to fill", () => {
    const entryRe = /if \(hasToken\(\) && (\/\^.*?\/)\.test\(window\.location\.pathname\)\)/.exec(code("src/entry.ts"))?.[1];
    expect(entryRe).toBeTruthy();
    const entry = new Function(`return ${entryRe}`)() as RegExp;
    for (const path of ["/home", "/home/", "/"]) expect(entry.test(path), path).toBe(true);
    expect(raw("index.html")).toContain('<meta name="lh-signed-in-prefetch" content="" />');
  });

  it("the build writes the chunk's URL into the meta, and refuses to build without the chunk", () => {
    const vite = code("vite.config.ts");
    expect(vite).toContain('name: "lh-signed-in-prefetch-url"');
    expect(vite).toContain('norm(c.facadeModuleId ?? "").endsWith("/src/boot/signedInPrefetch.ts")');
    expect(vite).toMatch(/if \(!chunk\) throw new Error\(/);
    expect(vite).toContain('return html.replace(meta, `<meta name="lh-signed-in-prefetch" content="/${chunk.fileName}" />`);');
  });

  it("starts once: the entry's later call asks nothing again", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "pk");
    localStorage.setItem("sb-proj-auth-token", JSON.stringify(live()));
    const fetchSpy = vi.fn(async () => ({ ok: true, headers: new Headers({ "content-range": "*/0" }), json: async () => [] }) as unknown as Response);
    vi.stubGlobal("fetch", fetchSpy);
    startSignedInPrefetch("/home");
    const first = fetchSpy.mock.calls.length;
    expect(first).toBeGreaterThan(3);
    startSignedInPrefetch("/home");
    expect(fetchSpy.mock.calls.length).toBe(first);
  });
});

describe("Home's poster first-job read starts from the entry and is taken once (Builder 2, 11-15)", () => {
  it("its URL is the one supabase-js builds for usePosterFirstJob, and the query asks exactly that chain", () => {
    const base = "https://proj.supabase.co";
    const sb = createClient(base, "k");
    const want = (sb.from("jobs").select("helper_id, status, poster_completed_at").eq("customer_id", UID).limit(50) as unknown as { url: URL }).url.toString();
    expect(homePosterFirstJobUrl(base, UID)).toBe(want);
    expect(code("src/pages/home/homeDashboard/PosterFirstJobCard.tsx")).toMatch(
      /\.from\("jobs"\)\.select\("helper_id, status, poster_completed_at"\)\.eq\("customer_id", userId!\)\.limit\(50\)/,
    );
  });

  it("a cold /home asks it as the member, and the card's query takes it once instead of reading", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "pk");
    localStorage.setItem("sb-proj-auth-token", JSON.stringify(live()));
    const rows = [{ helper_id: null, status: "open", poster_completed_at: null }];
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      return { ok: true, headers: new Headers({ "content-range": "*/0" }), json: async () => (url.includes("poster_completed_at") ? rows : []) } as unknown as Response;
    }));
    startHomePrefetch("/home");
    expect(urls).toContain(homePosterFirstJobUrl("https://proj.supabase.co", UID));
    expect(await takeHomePosterFirstJobPrefetch("someone-else")).toBeNull();
    startHomePrefetch("/home");
    expect(await takeHomePosterFirstJobPrefetch(UID)).toEqual(rows);
    expect(await takeHomePosterFirstJobPrefetch(UID)).toBeNull();
  });

  it("an old or malformed answer is not handed out", async () => {
    w[HOME_POSTER_PREFETCH_KEY] = { at: Date.now() - HOME_PREFETCH_MAX_AGE_MS - 1, userId: UID, rows: Promise.resolve([]) };
    expect(await takeHomePosterFirstJobPrefetch(UID)).toBeNull();
    w[HOME_POSTER_PREFETCH_KEY] = { at: Date.now(), userId: UID, rows: Promise.resolve({ message: "nope" }) };
    expect(await takeHomePosterFirstJobPrefetch(UID)).toBeNull();
  });

  it("usePosterFirstJob's queryFn uses the hand-over before it reads", () => {
    const src = code("src/pages/home/homeDashboard/PosterFirstJobCard.tsx");
    expect(src).toContain("const slot = takeHomePosterFirstJobPrefetch(userId!);");
    expect(src).toContain("if (pre) return posterFirstJobState(pre);");
  });
});
