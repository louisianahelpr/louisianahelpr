// @mutate supabase/migrations/20261105172514_profile_job_photos.sql |      AND NOT public.job_photos_withheld(pp.job_id) |      AND true
// @mutate supabase/migrations/20261105172514_profile_job_photos.sql |      AND NOT public.profile_page_hidden(pp.user_id) |      AND true
// @mutate supabase/migrations/20261105172514_profile_job_photos.sql | jsonb_build_object('id', q.id, 'category', q.category, 'month', q.month) | jsonb_build_object('id', q.id, 'category', q.category, 'month', q.month, 'path', q.id)
// @mutate supabase/functions/_shared/webpStripMetadata.ts |     if (tag !== "EXIF" && tag !== "XMP ") { |     if (true) {
// @mutate supabase/functions/profile-work-photo/index.ts |     const clean = bytes ? stripWebpMetadata(bytes) : null; |     const clean = bytes;
// @mutate src/components/profile/publicProfile/PublicJobPhotos.tsx | src={jobPhotoUrl(ph.id, 320)} | src={ph.id}
/*
 * Owner 11-05 (share-profile H4, all three options combined): a job after photo shows on /u/<handle> only while the
 * poster AND every booked Helpr allow sharing AND the Helpr ticked "Show on my page"; a visitor gets a pick id,
 * category and month, and the image only through profile-work-photo (re-encoded, EXIF/XMP stripped).
 * Behaviour proof on the SQL: src/test/pglite/profileJobPhotos.pglite.mjs (3x; --before red, planted defects red).
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments, blankSqlComments } from "@/test/helpers/blankNonCode";
import { effectiveDefs } from "@/test/helpers/effectiveFunctionDefs";
import { isWebp, stripWebpMetadata } from "../../supabase/functions/_shared/webpStripMetadata";

const ROOT = join(__dirname, "..", "..");
const fetchPublicJobPhotos = vi.fn();
vi.mock("@/lib/profileLink/jobPhotos", async (orig) => ({
  ...(await orig<typeof import("@/lib/profileLink/jobPhotos")>()),
  fetchPublicJobPhotos: (h: string) => fetchPublicJobPhotos(h),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn() } }));
const { PublicJobPhotos } = await import("@/components/profile/publicProfile/PublicJobPhotos");

const enc = new TextEncoder();
const u32le = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const chunk = (tag: string, data: number[]) => [...enc.encode(tag), ...u32le(data.length), ...data, ...(data.length & 1 ? [0] : [])];
function webp(chunks: number[][]): Uint8Array {
  const body = chunks.flat();
  return new Uint8Array([...enc.encode("RIFF"), ...u32le(4 + body.length), ...enc.encode("WEBP"), ...body]);
}
const has = (b: Uint8Array, s: string) => new TextDecoder("latin1").decode(b).includes(s);

describe("job photos on the shareable profile (owner 11-05, H4)", () => {
  const defs = effectiveDefs(join(ROOT, "supabase", "migrations"));

  it("a pick shows only while the Helpr's page is public AND nobody on the job withheld sharing", () => {
    const vis = blankSqlComments(defs.get("profile_job_photo_visible")!.stmt);
    expect(vis).toContain("AND NOT public.profile_page_hidden(pp.user_id)");
    expect(vis).toContain("AND NOT public.job_photos_withheld(pp.job_id)");
    // Both the visitor read and the image lookup go through that one definition.
    for (const fn of ["public_profile_work_photos", "profile_work_photo_object"]) {
      expect(blankSqlComments(defs.get(fn)!.stmt), fn).toContain("public.profile_job_photo_visible(");
    }
  });

  it("a visitor gets the pick id, category and month only", () => {
    const read = blankSqlComments(defs.get("public_profile_work_photos")!.stmt);
    const built = [...read.matchAll(/jsonb_build_object\(([^)]*)\)/g)].map((m) => m[1]);
    expect(built.length).toBeGreaterThan(0);
    for (const b of built) {
      const keys = [...b.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
      expect(keys).toEqual(["category", "id", "month"]);
    }
  });

  it("anon executes the visitor read only (grants in the migration)", () => {
    const sql = blankSqlComments(readFileSync(join(ROOT, "supabase/migrations/20261105172514_profile_job_photos.sql"), "utf8"));
    const anonGrants = [...sql.matchAll(/GRANT EXECUTE ON FUNCTION public\.(\w+)\([^)]*\) TO ([^;]+);/g)]
      .filter((m) => /\banon\b/.test(m[2])).map((m) => m[1]);
    expect(anonGrants).toEqual(["public_profile_work_photos"]);
    const revoked = [...sql.matchAll(/REVOKE ALL ON FUNCTION public\.(\w+)\([^)]*\) FROM ([^;]+);/g)];
    expect(revoked.length).toBeGreaterThan(6);
    // Every REVOKE names both roles (CLAUDE.md: FROM PUBLIC alone leaves anon's grant); the names of any that do not.
    expect(revoked.filter((m) => !/\bPUBLIC, anon\b/.test(m[2])).map((m) => m[1])).toEqual([]);
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.profile_job_photos FROM PUBLIC, anon, authenticated;/);
  });

  it("the image is served re-encoded as WebP with its EXIF and XMP chunks dropped, never by path", () => {
    const fn = blankComments(readFileSync(join(ROOT, "supabase/functions/profile-work-photo/index.ts"), "utf8"));
    expect(fn).toContain('admin.rpc("profile_work_photo_object", { p_pick_id: id })');
    expect(fn).toContain("const clean = bytes ? stripWebpMetadata(bytes) : null;");
    expect(fn).toContain('Accept: "image/webp"');
    expect(fn).not.toMatch(/format=origin|object\/authenticated/);
    const toml = readFileSync(join(ROOT, "supabase/config.toml"), "utf8");
    expect(toml).toMatch(/\[functions\.profile-work-photo\]\s+verify_jwt = false/);
  });

  it("stripWebpMetadata drops EXIF / XMP, clears their VP8X flags, and refuses a broken file", () => {
    const vp8x = [0x0c, 0, 0, 0, 1, 0, 0, 1, 0, 0];
    const src = webp([chunk("VP8X", vp8x), chunk("VP8 ", [1, 2, 3, 4]), chunk("EXIF", [...enc.encode("LH-GPS-30.22N")]), chunk("XMP ", [...enc.encode("LH-XMP-LOC")])]);
    expect(has(src, "LH-GPS")).toBe(true);
    const out = stripWebpMetadata(src)!;
    expect(isWebp(out)).toBe(true);
    expect(has(out, "LH-GPS") || has(out, "LH-XMP")).toBe(false);
    expect(out[12 + 8] & 0x0c).toBe(0);
    expect(has(out, "VP8 ")).toBe(true);
    const riff = out[4] | (out[5] << 8) | (out[6] << 16) | (out[7] << 24);
    expect(riff).toBe(out.length - 8);
    expect(stripWebpMetadata(new Uint8Array([1, 2, 3]))).toBeNull();
    const truncated = src.slice(0, 30);
    truncated.set(u32le(1000), 16);
    expect(stripWebpMetadata(truncated)).toBeNull();
  });

  it("the page shows a picked photo through profile-work-photo by id, with its category and month, and nothing when none", async () => {
    fetchPublicJobPhotos.mockResolvedValueOnce([{ id: "11111111-1111-4111-8111-111111111111", category: "yard_work", month: "2026-10" }]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container, unmount } = render(<QueryClientProvider client={qc}><PublicJobPhotos handle="hal-h" /></QueryClientProvider>);
    await screen.findByTestId("pp-job-photos");
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toMatch(/\/functions\/v1\/profile-work-photo\?id=11111111-1111-4111-8111-111111111111&w=320$/);
    expect(screen.getByText(/Oct 2026/)).toBeTruthy();
    unmount();
    fetchPublicJobPhotos.mockResolvedValueOnce([]);
    const empty = render(<QueryClientProvider client={new QueryClient()}><PublicJobPhotos handle="nobody" /></QueryClientProvider>);
    await new Promise((r) => setTimeout(r, 20));
    expect(empty.queryByTestId("pp-job-photos")).toBeNull();
  });
});
