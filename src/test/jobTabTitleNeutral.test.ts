/**
 * F110 (owner UI audit 2026-11-09): opening a job link showed the tab title "This job is no longer available" before
 * the job's own title, even for valid jobs. api/share.ts serves /jobs/:id's HTML head from `open_jobs_browse`, which
 * lists only OPEN jobs, so every hired, done or cancelled job (the ones its poster and Helpr open most) read as absent.
 * The tab title is now neutral ("Job — Helpr") until the app draws the job's title; the share card keeps the honest
 * "no longer available" wording for people the link was sent to.
 */
// @mutate api/share.ts |     title: "Job — Helpr", |     title: "This job is no longer available — Helpr",
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";

let handler: { fetch: (req: Request) => Promise<Response> };
const lookups: string[] = [];

beforeAll(async () => {
  // The database answers, with no public row: the `absent` branch (a job that is not open, or gone).
  vi.stubGlobal("fetch", (url: string) => {
    lookups.push(String(url));
    return Promise.resolve(new Response("[]", { status: 200, headers: { "content-type": "application/json" } }));
  });
  vi.stubEnv("VITE_SUPABASE_URL", "https://fncmgoasalhdgfwzhsqa.supabase.co");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_key_for_e2e_only");
  ensureOgShellSnapshot(resolve("."));
  const sharePath = ["..", "..", "api", "share"].join("/");
  handler = (await import(/* @vite-ignore */ sharePath)).default;
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("a job link's tab title is neutral when the job is not public (F110)", () => {
  it("a not-open job: tab title 'Job — Helpr', share card still says it is no longer available", async () => {
    const res = await handler.fetch(new Request("https://www.louisianahelpr.com/api/share?_og=job&_id=28f8cff5-9cd5-4c6b-8f95-a526712459a7"));
    const html = await res.text();
    // Inventory floor: the handler asked the browse view (the absent branch, not the no-env fallback).
    expect(lookups.some((u) => u.includes("open_jobs_browse"))).toBe(true);
    expect(html).toMatch(/<title>Job — Helpr<\/title>/);
    expect(html).not.toMatch(/<title>[^<]*no longer available/);
    expect(html).toMatch(/property="og:title" content="This job is no longer available"/);
  });
});
