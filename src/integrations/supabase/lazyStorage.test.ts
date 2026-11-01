import { describe, expect, it, vi } from "vitest";
import { StorageClient as RealStorage } from "supabase-storage-real";
import { StorageApiError as LazyStorageApiError, StorageClient as LazyStorage } from "./lazyStorage";

/**
 * B75 (11-01): in the production build supabase-js's StorageClient is lazyStorage.ts's stand-in, so storage-js
 * leaves the boot path. Each case runs the same call through the real client and the stand-in and compares what
 * reaches the network (URL, method, headers, body) and what comes back.
 */
// @mutate src/integrations/supabase/lazyStorage.ts | encodeURI(`${url}/object/public/${finalPath}`) | encodeURI(`${url}/object/${finalPath}`)
// @mutate src/integrations/supabase/lazyStorage.ts | ? "render/image" : "object" | ? "object" : "object"
// @mutate src/integrations/supabase/lazyStorage.ts |           load().then((c) => (c.from(bucketId) as | load().then((c) => (c.from(bucketId + "x") as

const URL_ = "https://fncmgoasalhdgfwzhsqa.supabase.co/storage/v1";
const HEADERS = { apikey: "sb_publishable_test", "X-Client-Info": "supabase-js-web/2" };

function recorder() {
  const calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", headers: Object.fromEntries(new Headers(init?.headers).entries()), body: init?.body });
    return new Response(JSON.stringify(init?.method === "POST" ? { Key: "job-photos/a/b.png", Id: "1" } : []), { status: 200, headers: { "content-type": "application/json" } });
  });
  return { calls, fetch };
}

describe("lazyStorage (the build's storage-js stand-in)", () => {
  it("getPublicUrl is synchronous and builds the same URL as storage-js", () => {
    const real = new RealStorage(URL_, HEADERS);
    const lazy = new LazyStorage(URL_, HEADERS);
    const cases: [string, string, Record<string, unknown> | undefined][] = [
      ["job-photos", "u1/photo one.png", undefined],
      ["avatars", "/u1/a.webp", undefined],
      ["declutter-photos", "x/y z/ü.jpg", { download: true }],
      ["quote-photos", "q/1.jpg", { download: "named.jpg", cacheNonce: 3 }],
      // Hotfix 11-01: Declutter's resized photos call getPublicUrl with a transform (render/image).
      ["job-photos", "u1/d/item/p.jpg", { transform: { width: 340, height: 340, resize: "cover", quality: 70 } }],
      ["job-photos", "u1/d/item/p.jpg", { transform: { width: 160, format: "origin" }, download: true }],
      ["job-photos", "u1/d/item/p.jpg", { transform: {} }],
    ];
    let n = 0;
    for (const [bucket, path, opts] of cases) {
      expect(lazy.from(bucket).getPublicUrl(path, opts as never)).toEqual(real.from(bucket).getPublicUrl(path, opts as never));
      n++;
    }
    expect(n).toBeGreaterThan(3);
  });

  it("upload, remove, createSignedUrl and list send the same requests and return the same results", async () => {
    const a = recorder();
    const b = recorder();
    const real = new RealStorage(URL_, HEADERS, a.fetch as never);
    const lazy = new LazyStorage(URL_, HEADERS, b.fetch as never);
    const file = new Blob(["hello"], { type: "image/png" });
    const run = async (s: RealStorage | LazyStorage) => [
      await s.from("job-photos").upload("u1/a.png", file, { upsert: true, contentType: "image/png" }),
      await s.from("job-photos").remove(["u1/a.png"]),
      await s.from("job-photos").createSignedUrl("u1/a.png", 60),
      await s.from("job-photos").list("u1"),
    ];
    const ra = await run(real);
    const rb = await run(lazy);
    expect(rb).toEqual(ra);
    expect(b.calls.map((c) => [c.url, c.method, c.headers])).toEqual(a.calls.map((c) => [c.url, c.method, c.headers]));
    expect(b.calls.length).toBeGreaterThan(3);
  });

  it("supabase-js's StorageApiError re-export resolves to an Error class", () => {
    const e = new LazyStorageApiError("nope", 400, "400");
    expect(e).toBeInstanceOf(Error);
    expect([e.name, e.status]).toEqual(["StorageApiError", 400]);
  });

  it("is not a thenable, and the client forwards bucket-level calls", async () => {
    const b = recorder();
    const lazy = new LazyStorage(URL_, HEADERS, b.fetch as never);
    expect((lazy.from("job-photos") as unknown as { then?: unknown }).then).toBeUndefined();
    await (lazy as unknown as { listBuckets: () => Promise<unknown> }).listBuckets();
    expect(b.calls[0]?.url).toBe(`${URL_}/bucket`);
  });
});
