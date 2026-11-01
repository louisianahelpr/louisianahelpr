/**
 * GROW-6 (owner growth item, 10-31): every shared link previews with its own photo. Shops (SH2b) and Declutter
 * items (Q2426) already did; a job link and a Helpr's Book me link showed the generic Helpr card image.
 *
 * Now api/share.ts gives:
 *  - a job with a photo: og:image = shop-photo kind=job keyed by the JOB id, 1200x630 JPEG. Never the photo's
 *    own URL (its storage path starts with the poster's user id). shop-photo reads the path from open_jobs_browse
 *    (the guest page's public view) on every fetch and serves only this project's job-photos bucket.
 *  - a Helpr's /book link: og:image = their own avatars/<user id>/avatar.jpg|png through the storage render
 *    endpoint, 630x630, format=origin so the declared type is true. A social-login photo, another folder or an
 *    unknown type gives no image block (the shell's card image stays).
 *
 * @mutate api/share.ts |     image: jobImage(job, title), |
 * @mutate api/share.ts |     url: `${SUPABASE_URL}/functions/v1/shop-photo?id=${job.id}&kind=job&w=1200&og=1`, |     url: first,
 * @mutate api/share.ts |     image: bookImage(lookup.profile.avatar_url, id, name), |
 * @mutate api/share.ts |   if (!avatarUrl.startsWith(prefix)) return undefined; |
 * @mutate supabase/functions/shop-photo/index.ts |  askedKind === "job" ? "job" : "shop"; |  "shop";
 * @mutate supabase/functions/shop-photo/index.ts |   if (!first \|\| !first.startsWith(JOB_PHOTO_PREFIX)) return { data: null, error: null }; |   if (!first) return { data: null, error: null };
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";

const SB = "https://example.supabase.co";
const JOB = "3f2a1b0c-1111-4222-8333-444455556666";
const POSTER = "0a0b0c0d-1111-4222-8333-444455556666";
const HELPR = "5e6f7a8b-1111-4222-8333-444455556666";

describe("GROW-6: job and Helpr links preview with their own photo (api/share.ts)", () => {
  let handler: { fetch: (req: Request) => Promise<Response> };
  let jobRows: unknown[] = [];
  let profiles: unknown[] = [];
  beforeAll(async () => {
    vi.stubEnv("VITE_SUPABASE_URL", SB);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
    vi.stubGlobal("fetch", async (url: string) => {
      const u = String(url);
      const body = u.includes("/rest/v1/open_jobs_browse?") ? jobRows
        : u.endsWith("/rpc/get_safe_profiles") ? profiles
        : u.endsWith("/rpc/get_public_profile_stats") ? []
        : undefined;
      if (body === undefined) throw new Error(`unexpected fetch ${u}`);
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    ensureOgShellSnapshot(resolve("."));
    const sharePath = ["..", "..", "api", "share"].join("/");
    handler = (await import(/* @vite-ignore */ sharePath)).default;
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const html = async (kind: string, id: string) =>
    (await handler.fetch(new Request(`https://www.louisianahelpr.com/api/share?_og=${kind}&_id=${id}`))).text();
  const ogImage = (h: string) => h.match(/<meta property="og:image" content="([^"]*)"/)?.[1];
  const job = (photos: string[] | null) => ({
    id: JOB, title: "Mow the back yard", category: "yard_work", budget: 60, location: "Lafayette",
    date_needed: null, pricing_mode: "set_price", expires_at: null, photos,
  });

  it("a job with a photo previews with it, by job id through shop-photo, never the poster's storage path", async () => {
    jobRows = [job([`${SB}/storage/v1/object/public/job-photos/${POSTER}/jobs/a.jpg`])];
    const h = await html("job", JOB);
    expect(ogImage(h)).toBe(`${SB}/functions/v1/shop-photo?id=${JOB}&amp;kind=job&amp;w=1200&amp;og=1`);
    expect(h).toContain('<meta property="og:image:width" content="1200"');
    expect(h).toContain('<meta property="og:image:height" content="630"');
    expect(h).toContain('<meta property="og:image:type" content="image/jpeg"');
    expect(h).toContain('<meta name="twitter:image" content="' + `${SB}/functions/v1/shop-photo?id=${JOB}&amp;kind=job`);
    expect(h).not.toContain(POSTER);
    expect(h).not.toMatch(/job-photos/);
    expect(h.match(/<meta property="og:image" /g)?.length).toBe(1);
  });

  it("a job with no photo keeps the shell's card image", async () => {
    jobRows = [job([])];
    const none = await html("job", JOB);
    jobRows = [job(null)];
    const nul = await html("job", JOB);
    for (const h of [none, nul]) {
      expect(ogImage(h)).not.toContain("shop-photo");
      expect(h).toContain('<meta property="og:title" content="Mow the back yard"');
    }
  });

  it("a Helpr's Book me link previews with their own stored photo, square, with its true type", async () => {
    profiles = [{ full_name: "Marie T.", location: "Lafayette", avatar_url: `${SB}/storage/v1/object/public/avatars/${HELPR}/avatar.png?t=17` }];
    const h = await html("book", HELPR);
    expect(ogImage(h)).toBe(`${SB}/storage/v1/render/image/public/avatars/${HELPR}/avatar.png?width=630&amp;height=630&amp;resize=cover&amp;quality=80&amp;format=origin`);
    expect(h).toContain('<meta property="og:image:type" content="image/png"');
    expect(h).toContain('<meta property="og:image:width" content="630"');
    expect(h).toContain('<meta property="og:image:alt" content="Marie T. on Louisiana Helpr"');
    expect(h.match(/<meta property="og:image" /g)?.length).toBe(1);
  });

  it("a photo outside the Helpr's own avatar folder, or of an unmeasured type, gives no image block", async () => {
    const bad = [
      `${SB}/storage/v1/object/public/avatars/${POSTER}/avatar.jpg`,
      `https://lh3.googleusercontent.com/a/abc`,
      `${SB}/storage/v1/object/public/avatars/${HELPR}/avatar.gif`,
      `${SB}/storage/v1/object/public/job-photos/${HELPR}/avatar.jpg`,
      null,
    ];
    for (const avatar_url of bad) {
      profiles = [{ full_name: "Marie T.", location: "Lafayette", avatar_url }];
      const h = await html("book", HELPR);
      expect(ogImage(h), String(avatar_url)).not.toMatch(/avatars|googleusercontent|job-photos/);
    }
    expect(bad.length).toBeGreaterThan(3);
  });
});

describe("GROW-6: shop-photo serves kind=job only from the public view and this project's bucket", () => {
  const edge = blankComments(readFileSync(resolve("supabase/functions/shop-photo/index.ts"), "utf8"));
  const flat = edge.replace(/\s+/g, " ");

  it("kind=job is recognised and looked up by publicJobPhotoPath, after the rate limit", () => {
    expect(edge).toContain('askedKind === "job" ? "job" : "shop"');
    expect(flat).toContain('kind === "job" ? await publicJobPhotoPath(id)');
    expect(edge.indexOf("await checkRateLimit(req,")).toBeLessThan(edge.indexOf("await publicJobPhotoPath(id)"));
  });

  it("the path comes from open_jobs_browse, only from a job-photos public URL on this project, never with ..", () => {
    expect(flat).toContain('admin.from("open_jobs_browse").select("photos").eq("id", jobId).maybeSingle()');
    expect(edge).toContain("const JOB_PHOTO_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/job-photos/`;");
    expect(flat).toContain("if (!first || !first.startsWith(JOB_PHOTO_PREFIX)) return { data: null, error: null };");
    expect(flat).toContain('!path.split("/").includes("..")');
  });
});
