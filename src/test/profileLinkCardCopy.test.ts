/**
 * M1 (share-profile audit 2026-11-05): the /u link card was weak and partly wrong. Measured with curl on prod 2026-11-05: "See what
 * Lexi L. posts and does… 24 items for sale" for a seller with 201 live items (it counted the capped list), no town
 * or skills, and og:image declared 1200x630 while the served file was 800x630 (render never upscales).
 * Now: the description leads with skills and town, the counts are the read's true listing_count / job_count, and
 * the photo is asked and declared as a 630x630 square (the size every avatar can fill; /book already did this).
 *
 * @mutate api/share.ts |   const selling = profileCount(card.listing_count, card.listings); |   const selling = Array.isArray(card.listings) ? card.listings.length : 0;
 * @mutate api/share.ts |   const open = profileCount(card.job_count, card.jobs); |   const open = Array.isArray(card.jobs) ? card.jobs.length : 0;
 * @mutate api/share.ts |   const lead = skills ? `${skills}${town ? ` in ${town}` : ""}.` : town | const lead = skills ? `${skills}.` : town
 * @mutate api/share.ts |   return parts.join(", "); |   return "";
 * @mutate api/share.ts |   return Number.isFinite(n) && n >= 0 ? n : Array.isArray(list) ? list.length : 0; |   return Array.isArray(list) ? list.length : 0;
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";

const USER = "3f2a1b0c-1111-4222-8333-444455556666";
const BASE = {
  handle: "lexi-l", name: "Lexi L.", member_since: "2025-03-01T12:00:00Z",
  photo_url: `https://example.supabase.co/storage/v1/object/public/avatars/${USER}/avatar.jpg`,
  stats: { review_count: 1, avg_rating: 5 }, helpr: { jobs_done: 1, categories: [], reviews: [] }, wanted: [],
  listings: Array.from({ length: 24 }, (_, i) => ({ id: String(i) })), jobs: [],
};

describe("the /u link card copy and image size (api/share.ts)", () => {
  let handler: { fetch: (req: Request) => Promise<Response> };
  let answer: unknown = BASE;
  beforeAll(async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).endsWith("/rest/v1/rpc/public_profile_by_handle")) return new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json" } });
      throw new Error(`unexpected fetch ${url}`);
    });
    ensureOgShellSnapshot(resolve("."));
    const sharePath = ["..", "..", "api", "share"].join("/");
    handler = (await import(/* @vite-ignore */ sharePath)).default;
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const description = async () => {
    const html = await (await handler.fetch(new Request("https://www.louisianahelpr.com/api/share?_og=profile&_id=lexi-l"))).text();
    return { html, d: html.match(/<meta property="og:description" content="([^"]*)"/)?.[1] ?? "" };
  };

  it("skills and town lead; the true item count, not the list length", async () => {
    answer = { ...BASE, listing_count: 201, job_count: 2, jobs: [{}], town: "Delcambre", skills: "Yard work, Handyman" };
    const { d } = await description();
    expect(d).toBe("Yard work, Handyman in Delcambre. 5.0 stars (1 review) · 1 job done · 201 items for sale · 2 open jobs.");
  });

  it("at most three skills; town alone names the member; nothing set keeps the old line", async () => {
    answer = { ...BASE, listing_count: 0, listings: [], skills: "A, B, C, D", town: null, stats: {}, helpr: { jobs_done: 0 } };
    expect((await description()).d).toBe("A, B, C.");
    answer = { ...BASE, listing_count: 0, listings: [], skills: "", town: "Delcambre", stats: {}, helpr: { jobs_done: 0 } };
    expect((await description()).d).toBe("Lexi L. in Delcambre on Louisiana Helpr.");
    answer = { ...BASE, listing_count: 0, listings: [], stats: {}, helpr: { jobs_done: 0 } };
    expect((await description()).d).toBe("See what Lexi L. posts and does on Louisiana Helpr.");
  });

  it("an older read without listing_count still counts its list", async () => {
    answer = { ...BASE };
    expect((await description()).d).toContain("24 items for sale");
  });

  it("the photo is asked and declared as the same 630x630 square", async () => {
    answer = { ...BASE, listing_count: 3 };
    const { html } = await description();
    expect(html).toContain(`avatars/${USER}/avatar.jpg?width=630&amp;height=630&amp;resize=cover`);
    expect(html).toContain('<meta property="og:image:width" content="630"');
    expect(html).toContain('<meta property="og:image:height" content="630"');
  });
});
