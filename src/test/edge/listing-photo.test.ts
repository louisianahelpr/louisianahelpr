/**
 * The `listing-photo` edge function (Q2211, Q2212, Q2213): Homes listing photos
 * served from the PRIVATE listing-photos bucket by signed photo ref, re-encoded
 * and stripped of every metadata segment server-side.
 *
 * Q2212's done-when: a JPEG carrying GPS EXIF goes in, and the served bytes
 * carry none. The fixture is a real JPEG from the repo with a GPS EXIF block,
 * XMP, IPTC, a comment and an MPF trailer (a phone's appended second picture
 * with its own EXIF) injected; each carries a sentinel string, and the bytes
 * served must contain none of them, while the picture itself (every table and
 * the scan data) comes through byte for byte.
 *
 * Runs the REAL function source via the edge harness, with the REAL
 * _shared/jpegStripMetadata.ts. PROVEN ABLE TO FAIL 2026-10-19: serving the
 * storage bytes unstripped (the @mutate below) turns the GPS tests red.
 */
// @mutate supabase/functions/listing-photo/index.ts | const clean = isJpeg(bytes) ? stripJpegMetadata(bytes) : null; | const clean = bytes;
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, rateLimitState, rateLimitCalls, rateLimitAuthSeen } from "./mocks/shared";
import { isJpeg, stripJpegMetadata, ICC_MAX_BYTES } from "../../../supabase/functions/_shared/jpegStripMetadata";

const enc = new TextEncoder();
const bytesOf = (s: string) => enc.encode(s);
const REAL = new Uint8Array(readFileSync(resolve(process.cwd(), "docs/audit/visual-notes-2026-09-14/vn11-375-before.jpg")));

function segment(marker: number, payload: Uint8Array): Uint8Array {
  const len = payload.length + 2;
  return new Uint8Array([0xff, marker, len >> 8, len & 0xff, ...payload]);
}
function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
function includes(hay: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

// A TIFF/EXIF block whose IFD0 points at a GPS IFD (tag 0x8825) holding a latitude, plus a sentinel.
const GPS_EXIF = cat(
  bytesOf("Exif\0\0"),
  new Uint8Array([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x88, 0x25, 0x00, 0x04, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x1a, 0x00, 0x00, 0x00, 0x00]),
  new Uint8Array([0x00, 0x01, 0x00, 0x01, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02, 0x4e, 0x00, 0x00, 0x00]),
  bytesOf("LH-GPS-30.2241N-92.0198W"),
);
const SENTINELS = ["LH-GPS-30.2241N-92.0198W", "LH-XMP-LOCATION", "LH-IPTC-CITY", "LH-COMMENT", "LH-MPF-TRAILER-GPS"];
const ICC = cat(bytesOf("ICC_PROFILE\0"), new Uint8Array([1, 1]), bytesOf("colour-only"));

/** The real JPEG with every kind of metadata injected after SOI, and a phone-style trailer after EOI. */
function withMetadata(base: Uint8Array): Uint8Array {
  return cat(
    base.subarray(0, 2),
    segment(0xe1, GPS_EXIF),
    segment(0xe1, cat(bytesOf("http://ns.adobe.com/xap/1.0/\0"), bytesOf("<x:xmpmeta>LH-XMP-LOCATION</x:xmpmeta>"))),
    segment(0xed, cat(bytesOf("Photoshop 3.0\0"), bytesOf("LH-IPTC-CITY"))),
    segment(0xfe, bytesOf("LH-COMMENT")),
    segment(0xe2, cat(bytesOf("MPF\0"), bytesOf("index"))),
    segment(0xe2, ICC),
    base.subarray(2),
    // MPF: a second picture after the end-of-image marker, with its own GPS EXIF.
    new Uint8Array([0xff, 0xd8]),
    segment(0xe1, cat(bytesOf("Exif\0\0"), bytesOf("LH-MPF-TRAILER-GPS"))),
    new Uint8Array([0xff, 0xd9]),
  );
}

describe("jpegStripMetadata (Q2212, the server-side strip)", () => {
  it("removes GPS EXIF, XMP, IPTC, comments and the MPF trailer, and keeps the picture and its colour profile", () => {
    const dirty = withMetadata(REAL);
    expect(isJpeg(dirty)).toBe(true);
    for (const s of SENTINELS) expect(includes(dirty, bytesOf(s))).toBe(true); // the fixture really carries them
    const clean = stripJpegMetadata(dirty);
    expect(clean).not.toBeNull();
    const checked = SENTINELS.filter((s) => !includes(clean!, bytesOf(s)));
    expect(checked).toEqual(SENTINELS);
    expect(checked.length).toBeGreaterThan(4);
    expect(includes(clean!, bytesOf("Exif\0\0"))).toBe(false);
    expect(includes(clean!, bytesOf("ICC_PROFILE\0"))).toBe(true);
    // The picture itself: the real file stripped the same way, byte for byte, ending at its EOI.
    const realClean = stripJpegMetadata(REAL)!;
    const withoutIcc = cat(clean!.subarray(0, 2), clean!.subarray(2 + 4 + ICC.length));
    expect(Buffer.from(withoutIcc).equals(Buffer.from(realClean))).toBe(true);
    expect(clean![clean!.length - 2]).toBe(0xff);
    expect(clean![clean!.length - 1]).toBe(0xd9);
  });

  it("keeps the colour blocks only in their minimal form: bare JFIF, Adobe transform, one small ICC chunk", () => {
    const at = (seg: Uint8Array) => cat(REAL.subarray(0, 2), seg, REAL.subarray(2));
    const kept = (seg: Uint8Array) => includes(stripJpegMetadata(at(seg))!, seg);
    const jfxx = segment(0xe0, cat(bytesOf("JFXX\0"), new Uint8Array([0x10]), bytesOf("LH-JFXX-THUMB")));
    const jfifThumb = segment(0xe0, cat(bytesOf("JFIF\0"), new Uint8Array([1, 2, 0, 0, 1, 0, 1, 1, 1]), new Uint8Array([9, 9, 9])));
    const adobe = segment(0xee, cat(bytesOf("Adobe"), new Uint8Array([0, 100, 0, 0, 0, 0, 1])));
    const adobeLong = segment(0xee, cat(bytesOf("Adobe"), new Uint8Array([0, 100, 0, 0, 0, 0, 1]), bytesOf("LH-EXTRA")));
    const iccBig = segment(0xe2, cat(bytesOf("ICC_PROFILE\0"), new Uint8Array([1, 1]), new Uint8Array(ICC_MAX_BYTES)));
    const iccChunked = segment(0xe2, cat(bytesOf("ICC_PROFILE\0"), new Uint8Array([1, 2]), bytesOf("part-one")));
    const checks = [
      [jfxx, false], [jfifThumb, false], [adobe, true], [adobeLong, false], [segment(0xe2, ICC), true], [iccBig, false], [iccChunked, false],
    ] as const;
    for (const [seg, want] of checks) expect(kept(seg)).toBe(want);
    expect(checks.length).toBeGreaterThan(5);
  });

  it("refuses bytes that are not a well-formed JPEG (never 'serve it as is')", () => {
    expect(stripJpegMetadata(bytesOf("\x89PNG\r\n\x1a\n not a jpeg"))).toBeNull();
    expect(stripJpegMetadata(REAL.subarray(0, REAL.length - 200))).toBeNull(); // truncated: no EOI
    expect(stripJpegMetadata(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]))).toBeNull(); // segment longer than the file
  });
});

const REF = "11111111-2222-4333-8444-555555555555.m.1792396800.0123456789abcdef0123456789abcdef";
const PATH = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/rental-listings/99999999-8888-4777-8666-555555555555/p0.jpg";

async function load(): Promise<EdgeHarness> {
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key" });
  return loadEdgeFunction("listing-photo");
}
const get = (fn: EdgeHarness, qs: string) => fn.fetch(fn.request({ method: "GET", url: `https://edge.test/listing-photo?${qs}` }));
const jpegResponse = (b: Uint8Array) => new Response(b as unknown as BodyInit, { status: 200, headers: { "Content-Type": "image/jpeg", "Content-Length": String(b.length) } });

describe("listing-photo handler", () => {
  let calls: Array<{ url: string; auth: string | null }>;
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEnv();
    calls = [];
  });
  afterEach(() => vi.unstubAllGlobals());

  function storage(render: () => Response, object: () => Response = () => new Response("missing", { status: 404 })) {
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, auth: new Headers(init?.headers).get("Authorization") });
      return url.includes("/render/image/") ? render() : object();
    }));
  }

  it("Q2212: a photo stored WITH GPS EXIF is served with none (rendered path)", async () => {
    scenario.rpc.rentals_listing_photo_object = PATH;
    storage(() => jpegResponse(withMetadata(REAL)));
    const fn = await load();
    const res = await get(fn, `r=${REF}&w=500`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=300");
    const body = new Uint8Array(await res.arrayBuffer());
    for (const s of SENTINELS) expect(includes(body, bytesOf(s))).toBe(false);
    expect(includes(body, bytesOf("Exif\0\0"))).toBe(false);
    // The private bucket's authenticated render route, re-encoded as a JPEG, with the service key.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/storage/v1/render/image/authenticated/listing-photos/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/rental-listings/");
    expect(calls[0].url).toContain("width=640");
    expect(calls[0].url).toContain("format=origin");
    expect(calls[0].auth).toBe("Bearer service-key");
    expect(scenario.rpcCalls?.[0]).toMatchObject({ name: "rentals_listing_photo_object", args: { p_ref: REF } });
  });

  it("Q2212: the capped original fallback is stripped too", async () => {
    scenario.rpc.rentals_listing_photo_object = PATH;
    storage(() => new Response("transform off", { status: 400 }), () => jpegResponse(withMetadata(REAL)));
    const fn = await load();
    const res = await get(fn, `r=${REF}`);
    expect(res.status).toBe(200);
    const body = new Uint8Array(await res.arrayBuffer());
    for (const s of SENTINELS) expect(includes(body, bytesOf(s))).toBe(false);
    expect(calls[1].url).toBe(`https://x.supabase.co/storage/v1/object/authenticated/listing-photos/${PATH}`);
  });

  it("a public-link ref is served re-encoded only: no original fallback for strangers", async () => {
    scenario.rpc.rentals_listing_photo_object = PATH;
    storage(() => new Response("transform off", { status: 400 }), () => jpegResponse(REAL));
    const fn = await load();
    expect((await get(fn, `r=${REF.replace(".m.", ".p.")}`)).status).toBe(502);
    expect(calls).toHaveLength(1);
  });

  it("never serves an original over 2 MB un-resized", async () => {
    scenario.rpc.rentals_listing_photo_object = PATH;
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    storage(() => new Response("transform off", { status: 400 }), () => jpegResponse(big));
    const fn = await load();
    expect((await get(fn, `r=${REF}`)).status).toBe(502);
  });

  it("refuses bytes that are not a JPEG (a crafted PNG is never served as is)", async () => {
    scenario.rpc.rentals_listing_photo_object = PATH;
    storage(() => new Response(bytesOf("\x89PNG\r\n\x1a\nLH-GPS"), { status: 200 }));
    const fn = await load();
    expect((await get(fn, `r=${REF}`)).status).toBe(502);
  });

  it("Q2211: a ref the database refuses (expired, forged, taken down, hidden) is a 404 and storage is never asked", async () => {
    scenario.rpc.rentals_listing_photo_object = null;
    storage(() => jpegResponse(REAL));
    const fn = await load();
    expect((await get(fn, `r=${REF}`)).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("a malformed ref, or a raw storage path, is a 404 without a lookup", async () => {
    storage(() => jpegResponse(REAL));
    const fn = await load();
    for (const r of ["", "not-a-ref", PATH, `${REF}x`, REF.replace(".m.", ".x.")]) {
      expect((await get(fn, `r=${encodeURIComponent(r)}`)).status).toBe(404);
    }
    expect(scenario.rpcCalls ?? []).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("a lookup failure is a logged 503, never a silent 404", async () => {
    scenario.rpcErrors = { rentals_listing_photo_object: { message: "connection reset", code: "08006" } };
    storage(() => jpegResponse(REAL));
    const fn = await load();
    expect((await get(fn, `r=${REF}`)).status).toBe(503);
  });

  it("is rate limited per address with a wide window", async () => {
    rateLimitState.allowed = false;
    storage(() => jpegResponse(REAL));
    const fn = await load();
    // By address only: a bearer (unverified, any sub) never picks the bucket.
    const res = await fn.fetch(fn.request({ method: "GET", url: `https://edge.test/listing-photo?r=${REF}`, headers: { Authorization: "Bearer forged" } }));
    expect(rateLimitAuthSeen).toEqual([false]);
    expect(res.status).toBe(429);
    expect(rateLimitCalls[0]).toMatchObject({ windowMs: 60_000, keyPrefix: "listing-photo" });
    expect((rateLimitCalls[0] as { ipMaxRequests?: number }).ipMaxRequests).toBeGreaterThan(rateLimitCalls[0].maxRequests ?? 0);
  });

  it("answers only GET and HEAD", async () => {
    const fn = await load();
    expect((await fn.fetch(fn.request({ method: "POST", url: `https://edge.test/listing-photo?r=${REF}` }))).status).toBe(405);
  });
});
