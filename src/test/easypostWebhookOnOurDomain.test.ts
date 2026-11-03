/**
 * Owner order 11-03 (via the lead): webhook URLs are on louisianahelpr.com, never the *.supabase.co address. EasyPost
 * posts to https://www.louisianahelpr.com/hooks/easypost (www: the apex redirects and webhooks do not follow redirects),
 * which vercel.json rewrites to the easypost-webhook edge function. Vercel takes the FIRST matching rewrite, so it must
 * come before the catch-all not-found rewrite to /api/share (which would answer EasyPost with a page).
 *
 * @mutate vercel.json |       "source": "/hooks/easypost",\n |       "source": "/hooks/easypost-old",\n
 * @mutate vercel.json |       "destination": "https://fncmgoasalhdgfwzhsqa.supabase.co/functions/v1/easypost-webhook"\n |       "destination": "/api/share?_og=notfound"\n
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface Rewrite { source: string; destination: string }
const rewrites: Rewrite[] = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")).rewrites ?? [];

describe("EasyPost's webhook is served from our own domain", () => {
  it("/hooks/easypost rewrites to the easypost-webhook function", () => {
    expect(rewrites.length).toBeGreaterThan(10);
    const hook = rewrites.filter((r) => r.source === "/hooks/easypost");
    expect(hook).toEqual([
      { source: "/hooks/easypost", destination: "https://fncmgoasalhdgfwzhsqa.supabase.co/functions/v1/easypost-webhook" },
    ]);
  });

  it("comes before every rewrite to /api/share, the catch-all among them", () => {
    const at = rewrites.findIndex((r) => r.source === "/hooks/easypost");
    const share = rewrites.map((r, i) => (r.destination.startsWith("/api/share") ? i : -1)).filter((i) => i >= 0);
    const catchAll = rewrites.findIndex((r) => r.destination === "/api/share?_og=notfound");
    expect(catchAll).toBeGreaterThan(0);
    expect(share.length).toBeGreaterThan(1);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(Math.min(...share));
  });
});
