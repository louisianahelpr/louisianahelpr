import { loadModule } from "@/lib/loadModule";
/**
 * supabase-js's StorageClient, without storage-js on the boot path (B75 speed, 11-01).
 *
 * createClient() builds a StorageClient in its constructor, so the client module (on every page's boot) carried
 * storage-js (~6 KB gz) although only upload, photo and delete screens touch files. In the production build
 * vite.config.ts aliases "@supabase/storage-js" to this file and "supabase-storage-real" to the package.
 * knip.json lists @supabase/storage-js in ignoreDependencies: it is supabase-js's own dependency, imported only by this lazy
 * stand-in (through the alias), and its version is the one supabase-js pins, so package.json does not list it.
 * `supabase.storage.from(bucket)` hands back a stand-in whose async methods (upload, remove, createSignedUrl,
 * list, download, ...) load storage-js and call the real one; getPublicUrl, the one synchronous method, is
 * computed here exactly as storage-js does (src/integrations/supabase/lazyStorage.test.ts compares the two).
 * Dev and tests use the real package unchanged.
 */
import type { StorageClient as RealClient } from "supabase-storage-real";

// Loaded alone, then called: work chained straight onto import() runs inside Vite's preload wrapper, where a
// failure reads as a broken chunk (dynamicImportThenDoesNoWork).
const storageReal = () => loadModule(() => import("supabase-storage-real"));

type FileApi = ReturnType<RealClient["from"]>;
type PublicUrlOptions = { download?: string | boolean; transform?: unknown; cacheNonce?: unknown; versionId?: unknown };

/** supabase-js re-exports this name; nothing in the app reads it. A stand-in so the re-export resolves. */
export class StorageApiError extends Error {
  constructor(message: string, public status?: number, public statusCode?: string) {
    super(message);
    this.name = "StorageApiError";
  }
}

export class StorageClient {
  /** As storage-js's StorageBucketApi computes it (useNewHostname, no trailing slash). */
  readonly url: string;
  private real: Promise<RealClient> | null = null;

  constructor(
    url: string,
    private readonly headers: Record<string, string> = {},
    private readonly fetch?: unknown,
    private readonly opts?: { useNewHostname?: boolean },
  ) {
    const base = new URL(url);
    if (opts?.useNewHostname && /supabase\.(co|in|red)$/.test(base.hostname) && !base.hostname.includes("storage.supabase.")) {
      base.hostname = base.hostname.replace("supabase.", "storage.supabase.");
    }
    this.url = base.href.replace(/\/$/, "");
    // Every other StorageClient method (listBuckets, getBucket, ...) forwards to the real client.
    return new Proxy(this, {
      get(target, prop, receiver) {
        if (prop in target) return Reflect.get(target, prop, receiver);
        if (typeof prop !== "string" || prop === "then") return undefined;
        return (...args: unknown[]) => target.client().then((c) => (c as unknown as Record<string, (...a: unknown[]) => unknown>)[prop](...args));
      },
    });
  }

  /** The real client, made once storage-js has loaded. A failed load is retried on the next call. */
  client(): Promise<RealClient> {
    this.real ??= storageReal().then((m) => {
      if (!m) throw new Error("storage-js came back empty (a recovery reload is under way)");
      return new m.StorageClient(this.url, this.headers, this.fetch as never, this.opts);
    });
    const p = this.real;
    p.catch(() => {
      // The caller's own call rejects with this error; here only the cached failure is dropped so the next call retries.
      if (this.real === p) this.real = null;
    });
    return p;
  }

  from(bucketId: string): FileApi {
    const url = this.url;
    const load = () => this.client();
    const publicUrl = (path: string, options?: PublicUrlOptions) => {
      // Mirrors storage-js 2.117.3 StorageFileApi.getPublicUrl exactly, including image transforms (render/image),
      // which Declutter's resized photos use (hotfix 11-01: the old throw broke /declutter in production).
      const finalPath = `${bucketId}/${path.replace(/^\/+/, "")}`;
      const query = new URLSearchParams();
      if (options?.download) query.set("download", options.download === true ? "" : options.download);
      const t = options?.transform as
        | { width?: number; height?: number; resize?: string; format?: string; quality?: number }
        | null
        | undefined;
      if (t) {
        if (t.width) query.set("width", t.width.toString());
        if (t.height) query.set("height", t.height.toString());
        if (t.resize) query.set("resize", t.resize);
        if (t.format) query.set("format", t.format);
        if (t.quality) query.set("quality", t.quality.toString());
      }
      if (options?.cacheNonce != null) query.set("cacheNonce", String(options.cacheNonce));
      if (options?.versionId != null) query.set("versionId", String(options.versionId));
      const qs = query.toString();
      const renderPath = typeof t === "object" && t !== null && Object.keys(t).length > 0 ? "render/image" : "object";
      return { data: { publicUrl: encodeURI(`${url}/${renderPath}/public/${finalPath}`) + (qs ? `?${qs}` : "") } };
    };
    return new Proxy({ bucketId } as Record<string, unknown>, {
      get(target, prop) {
        if (prop === "getPublicUrl") return publicUrl;
        if (prop === "bucketId") return bucketId;
        // Not a thenable: `await supabase.storage.from(x)` must not try to call a forwarded `then`.
        if (typeof prop !== "string" || prop === "then") return undefined;
        return (...args: unknown[]) =>
          load().then((c) => (c.from(bucketId) as unknown as Record<string, (...a: unknown[]) => unknown>)[prop](...args));
      },
    }) as unknown as FileApi;
  }
}
