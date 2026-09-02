/**
 * `portfolioStorage` — removing a work photo must REMOVE it.
 *
 * The bug these pin: `removePortfolioAt` rewrote `profiles.portfolio_urls` and
 * never touched storage, so a photo the member deleted from their profile
 * stayed anonymously fetchable at its public URL forever. Reproduced against
 * prod on 2026-09-01 — column `[]`, object still listed, anonymous GET 200 for
 * 30s+ (not CDN lag).
 *
 * The second bug, and the reason half of these exist: a `.remove()` that
 * removed nothing answers `{ data: [], error: null }`. Every assertion that
 * mentions `staleRemaining` is checking that this module refuses to certify a
 * delete it did not observe.
 *
 * The third: "delete everything not in the keep set" is destructive if the keep
 * set is misread, so there are tests that it deletes NOTHING when a surviving
 * reference cannot be placed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  assertUploadablePortfolioImage,
  isUnresolvedPortfolioRef,
  newPortfolioObjectKey,
  portfolioObjectName,
  reconcilePortfolioObjects,
  uploadPortfolioImage,
  PortfolioImageTooLargeError,
  UnsupportedPortfolioImageError,
  type PortfolioStorageClient,
} from "./portfolioStorage";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
import { report } from "@/lib/errorLogger";

const CDN = "https://cdn.test/storage/v1/object/public/avatars";

/**
 * A storage double backed by a real key→object map, so "did the object
 * survive?" is answered by the same read the module makes rather than by a
 * recorded call. `removeBehaviour: "silent-noop"` is the RLS-filtered delete
 * verbatim — nothing is removed and the error is null.
 */
function fakeStorage(
  initial: string[],
  opts: {
    removeBehaviour?: "delete" | "silent-noop";
    listFails?: boolean | "after-remove";
    uploadError?: { message: string };
  } = {},
) {
  const objects = new Set(initial);
  const removeCalls: string[][] = [];
  let listCalls = 0;

  const client: PortfolioStorageClient = {
    storage: {
      from: () => ({
        upload: (path: string) => {
          if (opts.uploadError) return Promise.resolve({ error: opts.uploadError });
          objects.add(path);
          return Promise.resolve({ error: null });
        },
        list: (prefix: string) => {
          listCalls++;
          const fail =
            opts.listFails === true ||
            (opts.listFails === "after-remove" && removeCalls.length > 0);
          if (fail) {
            return Promise.resolve({ data: null, error: { message: "permission denied" } });
          }
          const seen = new Set<string>();
          const entries: Array<{ name: string; id?: string | null }> = [];
          for (const key of objects) {
            if (!key.startsWith(`${prefix}/`)) continue;
            const rest = key.slice(prefix.length + 1);
            const slash = rest.indexOf("/");
            const name = slash === -1 ? rest : rest.slice(0, slash);
            if (seen.has(name)) continue;
            seen.add(name);
            // A sub-prefix comes back with a NULL id and is not an object.
            entries.push({ name, id: slash === -1 ? "obj" : null });
          }
          return Promise.resolve({ data: entries, error: null });
        },
        remove: (paths: string[]) => {
          removeCalls.push(paths);
          // Both branches answer `error: null` — that is the whole point.
          if (opts.removeBehaviour !== "silent-noop") {
            for (const p of paths) objects.delete(p);
          }
          return Promise.resolve({ data: [], error: null });
        },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `${CDN}/${path}` } }),
      }),
    },
  };

  return { client, objects, removeCalls, listCalls: () => listCalls };
}

const file = (type: string, size = 1024) => ({ type, size }) as unknown as File;

beforeEach(() => vi.mocked(report).mockClear());

describe("newPortfolioObjectKey — content type, not file name; id, not index", () => {
  it("derives the extension from the content type", () => {
    expect(newPortfolioObjectKey("u1", "image/jpeg")).toMatch(/^u1\/portfolio\/[\w.-]+\.jpg$/);
    expect(newPortfolioObjectKey("u1", "IMAGE/PNG")).toMatch(/^u1\/portfolio\/[\w.-]+\.png$/);
    expect(newPortfolioObjectKey("u1", "image/webp")).toMatch(/\.webp$/);
    expect(newPortfolioObjectKey("u1", "image/gif")).toMatch(/\.gif$/);
  });

  it("refuses a type the bucket would reject anyway", () => {
    // HEIC is the iPhone default and is NOT in the bucket's allowed_mime_types.
    expect(() => newPortfolioObjectKey("u1", "image/heic")).toThrow(
      UnsupportedPortfolioImageError,
    );
    expect(() => newPortfolioObjectKey("u1", "image/svg+xml")).toThrow(
      UnsupportedPortfolioImageError,
    );
    expect(() => newPortfolioObjectKey("u1", "")).toThrow(UnsupportedPortfolioImageError);
  });

  it("never mints the same key twice, so a slot cannot be overwritten", () => {
    const keys = new Set(
      Array.from({ length: 200 }, () => newPortfolioObjectKey("u1", "image/jpeg")),
    );
    expect(keys.size).toBe(200);
  });
});

describe("assertUploadablePortfolioImage", () => {
  it("rejects an unsupported type and an oversized file with human copy", () => {
    expect(() => assertUploadablePortfolioImage(file("application/pdf"))).toThrow(
      UnsupportedPortfolioImageError,
    );
    expect(() => assertUploadablePortfolioImage(file("image/png", 6 * 1024 * 1024))).toThrow(
      PortfolioImageTooLargeError,
    );
    expect(() =>
      assertUploadablePortfolioImage(file("image/png", 5 * 1024 * 1024)),
    ).not.toThrow();
  });
});

describe("portfolioObjectName — which references belong to this folder", () => {
  it("resolves the public URL shape the app stores, cache-buster and all", () => {
    expect(portfolioObjectName("u1", `${CDN}/u1/portfolio/abc.jpg`)).toBe("abc.jpg");
    expect(portfolioObjectName("u1", `${CDN}/u1/portfolio/abc.jpg?t=123`)).toBe("abc.jpg");
    expect(
      portfolioObjectName(
        "u1",
        "https://cdn.test/storage/v1/render/image/public/avatars/u1/portfolio/abc.jpg?width=200",
      ),
    ).toBe("abc.jpg");
  });

  it("resolves a bare storage path", () => {
    expect(portfolioObjectName("u1", "u1/portfolio/abc.jpg")).toBe("abc.jpg");
  });

  it("does not claim references that are not ours", () => {
    // `complete-signup` puts bare user-documents paths in the SAME column.
    expect(portfolioObjectName("u1", "u1/1700-xyz.jpg")).toBeNull();
    // Another user's folder.
    expect(portfolioObjectName("u1", `${CDN}/u2/portfolio/abc.jpg`)).toBeNull();
    // The user's own avatar, which must never be swept by the portfolio path.
    expect(portfolioObjectName("u1", `${CDN}/u1/avatar.png`)).toBeNull();
    expect(portfolioObjectName("u1", "https://api.dicebear.com/7.x/initials/svg?seed=AH")).toBeNull();
    expect(portfolioObjectName("u1", "")).toBeNull();
  });

  it("flags a reference that points into the folder but cannot be placed", () => {
    // Nested — `.list()` only reads one level, so treating this as resolved
    // would let it be silently skipped.
    expect(isUnresolvedPortfolioRef("u1", `${CDN}/u1/portfolio/nested/abc.jpg`)).toBe(true);
    expect(isUnresolvedPortfolioRef("u1", "u1/portfolio/nested/abc.jpg")).toBe(true);
    expect(isUnresolvedPortfolioRef("u1", `${CDN}/u1/portfolio/abc.jpg`)).toBe(false);
    expect(isUnresolvedPortfolioRef("u1", `${CDN}/u1/avatar.png`)).toBe(false);
  });
});

describe("uploadPortfolioImage", () => {
  it("stores at a fresh key and returns its public URL", async () => {
    const { client, objects } = fakeStorage([]);
    const res = await uploadPortfolioImage(client, "u1", file("image/png"), "image/png");
    expect(objects.has(res.path)).toBe(true);
    expect(res.path).toMatch(/^u1\/portfolio\/[\w.-]+\.png$/);
    expect(res.publicUrl).toBe(`${CDN}/${res.path}`);
  });

  it("throws rather than returning a URL for an object that was not stored", async () => {
    const { client } = fakeStorage([], { uploadError: { message: "413" } });
    await expect(
      uploadPortfolioImage(client, "u1", file("image/png"), "image/png"),
    ).rejects.toMatchObject({ message: "413" });
  });
});

describe("reconcilePortfolioObjects — the orphan bug", () => {
  it("DELETES the object a removed URL pointed at (the whole defect)", async () => {
    const { client, objects } = fakeStorage(["u1/portfolio/a.jpg", "u1/portfolio/b.jpg"]);
    // The user dropped `b`. Before the fix this call did not exist and `b.jpg`
    // stayed public forever.
    const res = await reconcilePortfolioObjects(client, "u1", [`${CDN}/u1/portfolio/a.jpg`]);
    expect(res.removed).toEqual(["u1/portfolio/b.jpg"]);
    expect(res.staleRemaining).toEqual([]);
    expect(objects.has("u1/portfolio/b.jpg")).toBe(false);
    expect(objects.has("u1/portfolio/a.jpg")).toBe(true);
  });

  it("clears orphans the OLD code already left behind (self-healing)", async () => {
    const { client, objects } = fakeStorage([
      "u1/portfolio/keep.jpg",
      "u1/portfolio/1700-abc.jpeg",
      "u1/portfolio/1701-def.JPG".toLowerCase(),
    ]);
    const res = await reconcilePortfolioObjects(client, "u1", [`${CDN}/u1/portfolio/keep.jpg`]);
    expect(res.removed.sort()).toEqual([
      "u1/portfolio/1700-abc.jpeg",
      "u1/portfolio/1701-def.jpg",
    ]);
    expect(objects.size).toBe(1);
  });

  it("never touches the avatar or another user's folder", async () => {
    const { client, objects } = fakeStorage([
      "u1/avatar.png",
      "u1/portfolio/gone.jpg",
      "u2/portfolio/theirs.jpg",
    ]);
    await reconcilePortfolioObjects(client, "u1", []);
    expect(objects.has("u1/avatar.png")).toBe(true);
    expect(objects.has("u2/portfolio/theirs.jpg")).toBe(true);
    expect(objects.has("u1/portfolio/gone.jpg")).toBe(false);
  });

  it("a REORDER moves no bytes", async () => {
    const { client, removeCalls } = fakeStorage(["u1/portfolio/a.jpg", "u1/portfolio/b.jpg"]);
    const res = await reconcilePortfolioObjects(client, "u1", [
      `${CDN}/u1/portfolio/b.jpg`,
      `${CDN}/u1/portfolio/a.jpg`,
    ]);
    expect(removeCalls).toEqual([]);
    expect(res).toEqual({ removed: [], staleRemaining: [] });
  });
});

describe("reconcilePortfolioObjects — a null error is not a delete", () => {
  it("reports the survivor when remove() silently removes nothing", async () => {
    // The RLS-filtered delete: `{ data: [], error: null }` and the object stays.
    const { client, objects } = fakeStorage(["u1/portfolio/b.jpg"], {
      removeBehaviour: "silent-noop",
    });
    const res = await reconcilePortfolioObjects(client, "u1", []);
    expect(res.removed).toEqual([]);
    expect(res.staleRemaining).toEqual(["u1/portfolio/b.jpg"]);
    expect(objects.has("u1/portfolio/b.jpg")).toBe(true);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("reports still-exposed when the folder cannot be READ at all", async () => {
    const { client, removeCalls } = fakeStorage(["u1/portfolio/b.jpg"], { listFails: true });
    const res = await reconcilePortfolioObjects(client, "u1", []);
    expect(removeCalls).toEqual([]);
    expect(res.staleRemaining).toEqual(["u1/portfolio/<unreadable folder>"]);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("reports still-exposed when the VERIFYING re-list fails", async () => {
    const { client } = fakeStorage(["u1/portfolio/b.jpg"], { listFails: "after-remove" });
    const res = await reconcilePortfolioObjects(client, "u1", []);
    // The remove may well have worked — but it was not observed, and unobserved
    // is reported as exposed, never as clean.
    expect(res.removed).toEqual([]);
    expect(res.staleRemaining).toEqual(["u1/portfolio/b.jpg"]);
  });

  it("stays silent on a clean sweep", async () => {
    const { client } = fakeStorage(["u1/portfolio/b.jpg"]);
    await reconcilePortfolioObjects(client, "u1", []);
    expect(report).not.toHaveBeenCalled();
  });
});

describe("reconcilePortfolioObjects — fails closed", () => {
  it("deletes NOTHING when a surviving reference cannot be placed", async () => {
    const { client, objects, removeCalls } = fakeStorage([
      "u1/portfolio/a.jpg",
      "u1/portfolio/b.jpg",
    ]);
    // A reference the resolver cannot map to a single listed object. Deleting
    // "everything not in the keep set" here could destroy a photo the user
    // still has on their profile, so nothing is deleted.
    const res = await reconcilePortfolioObjects(client, "u1", [
      `${CDN}/u1/portfolio/nested/a.jpg`,
    ]);
    expect(removeCalls).toEqual([]);
    expect(objects.size).toBe(2);
    expect(res.staleRemaining).toEqual(["u1/portfolio/<unresolved reference; sweep skipped>"]);
  });

  it("is not confused by a foreign reference sharing the column", async () => {
    // `complete-signup` writes bare `user-documents` paths into portfolio_urls.
    const { client, objects } = fakeStorage(["u1/portfolio/a.jpg", "u1/portfolio/b.jpg"]);
    const res = await reconcilePortfolioObjects(client, "u1", [
      "u1/1700-signupfile.jpg",
      `${CDN}/u1/portfolio/a.jpg`,
    ]);
    expect(res.removed).toEqual(["u1/portfolio/b.jpg"]);
    expect(objects.has("u1/portfolio/a.jpg")).toBe(true);
  });

  it("is idempotent — a second run finds nothing to do", async () => {
    const { client, removeCalls } = fakeStorage(["u1/portfolio/a.jpg", "u1/portfolio/b.jpg"]);
    const keep = [`${CDN}/u1/portfolio/a.jpg`];
    await reconcilePortfolioObjects(client, "u1", keep);
    const second = await reconcilePortfolioObjects(client, "u1", keep);
    expect(removeCalls.length).toBe(1);
    expect(second).toEqual({ removed: [], staleRemaining: [] });
  });
});
