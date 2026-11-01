/**
 * PERF-SHELL (Q652): api/share.ts serves /browse with its first job cards in the raw HTML, read from the masked
 * public view with only the columns the card draws, and degrades to the plain page on any failed read.
 * What a card may carry is pinned by browseShellCards.test.tsx; this pins the handler's read and placement.
 *
 * @mutate src/lib/browseShellCards.mjs |   u.searchParams.set("status", "eq.open"); |   u.searchParams.set("status", "neq.cancelled");
 * @mutate api/share.ts |       if (isBrowsePage(url)) return respond(withBrowseShell(page, await fetchBrowseShellRows()), BROWSE_SHELL_CDN_CACHE); |       if (isBrowsePage(url)) return respond(page, BROWSE_SHELL_CDN_CACHE);
 * @mutate api/share.ts |   return !!route && route.kind === "page" && route.id === "browse"; |   return !!route && route.kind === "page";
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";
import { SHELL_JOB_COLUMNS } from "@/lib/browseShellCards.mjs";

const ROWS = [
  { title: "Mow the front yard", category: "yard_work", budget: 85, location: "Lafayette, LA", status: "open", created_at: "2026-10-31T12:00:00Z" },
  { title: "Rake leaves", category: "yard_work", budget: 40, location: "Broussard, LA", status: "open", created_at: "2026-10-30T12:00:00Z" },
];

describe("/browse's raw HTML carries its first job cards", () => {
  let handler: { fetch: (req: Request) => Promise<Response> };
  let mode: "ok" | "fail" | "throw" = "ok";
  const asked: string[] = [];
  beforeAll(async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      asked.push(String(url));
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer anon-key");
      if (mode === "throw") throw new Error("timeout");
      if (mode === "fail") return new Response("{}", { status: 503 });
      return new Response(JSON.stringify(ROWS), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    ensureOgShellSnapshot(resolve("."));
    const sharePath = ["..", "..", "api", "share"].join("/");
    handler = (await import(/* @vite-ignore */ sharePath)).default;
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const get = (q: string) => handler.fetch(new Request(`https://www.louisianahelpr.com/api/share?${q}`));

  it("reads the masked view, open jobs only, only the drawn columns, the feed's order", async () => {
    mode = "ok";
    asked.length = 0;
    const res = await get("_og=page&_id=browse");
    expect(asked).toHaveLength(1);
    const u = new URL(asked[0]);
    expect(u.pathname).toBe("/rest/v1/open_jobs_browse");
    expect(u.searchParams.get("select")).toBe(SHELL_JOB_COLUMNS);
    expect(SHELL_JOB_COLUMNS.split(",")).not.toEqual(expect.arrayContaining(["id"]));
    expect(SHELL_JOB_COLUMNS).not.toMatch(/description|latitude|longitude|customer_id|photos|\bid\b/);
    expect(u.searchParams.get("status")).toBe("eq.open");
    expect(u.searchParams.get("payment_status")).toBe("neq.abandoned");
    expect(u.searchParams.get("order")).toBe("boosted_at.desc.nullslast,created_at.desc");
    const html = await res.text();
    expect(html).toMatch(/<div\s+id="boot-loader"[^>]*><div id="lh-browse-shell"/);
    expect(html.match(/data-feed-card=""/g)?.length).toBe(2);
    expect(html).toContain(">Mow the front yard</h2>");
    expect(html).toContain(">Broussard<");
    expect(res.headers.get("Vercel-CDN-Cache-Control")).toBe("public, s-maxage=120, stale-while-revalidate=600");
    // Head tags are still the page's own.
    expect(html).toContain('<link rel="canonical" href="https://www.louisianahelpr.com/browse"');
  });

  it("a failed or slow read serves the page with no cards", async () => {
    for (const m of ["fail", "throw"] as const) {
      mode = m;
      const html = await (await get("_og=page&_id=browse")).text();
      expect(html, m).not.toContain("lh-browse-shell");
      expect(html, m).toContain('id="boot-loader"');
    }
  });

  it("no other page reads jobs or carries cards", async () => {
    mode = "ok";
    asked.length = 0;
    for (const id of ["help", "support", "legal", "declutter"]) {
      const html = await (await get(`_og=page&_id=${id}`)).text();
      expect(html, id).not.toContain("lh-browse-shell");
    }
    expect(asked).toEqual([]);
  });
});
