/**
 * `avatarStorage` — replacing a profile photo must REPLACE it.
 *
 * The bug these pin: the avatar key used to embed the picked file's own
 * extension, so a `.png` uploaded over a `.jpg` created a SECOND public object
 * and left the first one anonymously fetchable forever. On this surface the
 * first object may be a photo of a driver's licence, so "the member re-uploaded
 * a selfie" and "the licence is gone" were two different facts.
 *
 * The second bug, and the reason half of these tests exist: a `.remove()` that
 * removed nothing answers `{ data: [], error: null }`. Every assertion below
 * that mentions `staleRemaining` is checking that this module refuses to
 * certify a delete it did not observe.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  assertUploadableAvatar,
  avatarObjectKey,
  isAvatarObjectName,
  replaceAvatarObject,
  AvatarTooLargeError,
  UnsupportedAvatarError,
  type AvatarStorageClient,
} from "./avatarStorage";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
import { report } from "@/lib/errorLogger";

/**
 * A storage double backed by a real key→object map, so "did the old object
 * survive?" is answered by the same read the module makes rather than by a
 * recorded call. `removeBehaviour` is what makes the silent-failure case
 * expressible: `"silent-noop"` is the RLS-filtered delete verbatim — nothing
 * is removed and the error is null.
 */
function fakeStorage(
  initial: Record<string, string>,
  opts: {
    removeBehaviour?: "delete" | "silent-noop";
    listFails?: boolean;
    uploadError?: { message: string };
  } = {},
) {
  const objects = new Map(Object.entries(initial));
  const removeCalls: string[][] = [];

  const client: AvatarStorageClient = {
    storage: {
      from: () => ({
        upload: (path: string, _body: unknown, o?: { contentType?: string }) => {
          if (opts.uploadError) return Promise.resolve({ error: opts.uploadError });
          objects.set(path, o?.contentType ?? "application/octet-stream");
          return Promise.resolve({ error: null });
        },
        list: (prefix: string) => {
          if (opts.listFails) {
            return Promise.resolve({ data: null, error: { message: "permission denied" } });
          }
          const names = new Set<string>();
          const entries: Array<{ name: string; id?: string | null }> = [];
          for (const key of objects.keys()) {
            if (!key.startsWith(`${prefix}/`)) continue;
            const rest = key.slice(prefix.length + 1);
            const slash = rest.indexOf("/");
            // Sub-folders come back as one entry with a NULL id — the shape
            // that keeps `<uid>/portfolio/x.jpg` out of the avatar sweep.
            const name = slash === -1 ? rest : rest.slice(0, slash);
            if (names.has(name)) continue;
            names.add(name);
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
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://cdn.test/storage/v1/object/public/avatars/${path}` },
        }),
      }),
    },
  };

  return { client, objects, removeCalls };
}

const file = (type: string, size = 1024) => ({ type, size }) as unknown as File;

beforeEach(() => vi.mocked(report).mockClear());

describe("avatarObjectKey — derived from the content type, never the file name", () => {
  it("collapses every spelling of one format onto ONE key", () => {
    // `IMG_0001.JPEG`, `photo.jpg` and `scan.jpe` used to be three permanent
    // public objects. They are one.
    expect(avatarObjectKey("u1", "image/jpeg")).toBe("u1/avatar.jpg");
    expect(avatarObjectKey("u1", "IMAGE/JPEG")).toBe("u1/avatar.jpg");
    expect(avatarObjectKey("u1", "image/png")).toBe("u1/avatar.png");
    expect(avatarObjectKey("u1", "image/webp")).toBe("u1/avatar.webp");
    expect(avatarObjectKey("u1", "image/gif")).toBe("u1/avatar.gif");
  });

  it("refuses a type the bucket would reject anyway", () => {
    // `image/heic` is what an iPhone hands over by default and is NOT in the
    // bucket's allowed_mime_types; the old `startsWith("image/")` check let it
    // through to fail at the server with an opaque message.
    expect(() => avatarObjectKey("u1", "image/heic")).toThrow(UnsupportedAvatarError);
    expect(() => avatarObjectKey("u1", "")).toThrow(UnsupportedAvatarError);
  });

  it("recognises every legacy key shape as an avatar object", () => {
    expect(isAvatarObjectName("avatar.jpg")).toBe(true);
    expect(isAvatarObjectName("avatar.jpeg")).toBe(true);
    // The key an extension-less filename used to produce.
    expect(isAvatarObjectName("avatar.undefined")).toBe(true);
    expect(isAvatarObjectName("portfolio")).toBe(false);
    expect(isAvatarObjectName("id-document-123.pdf")).toBe(false);
  });
});

describe("assertUploadableAvatar", () => {
  it("rejects an unsupported type and an oversized file with human copy", () => {
    expect(() => assertUploadableAvatar(file("application/pdf"))).toThrow(UnsupportedAvatarError);
    expect(() => assertUploadableAvatar(file("image/png", 6 * 1024 * 1024))).toThrow(
      AvatarTooLargeError,
    );
    expect(() => assertUploadableAvatar(file("image/png", 5 * 1024 * 1024))).not.toThrow();
  });
});

describe("replaceAvatarObject — the orphan bug", () => {
  it("REPLACES a .jpg with a .png instead of leaving both public", async () => {
    const { client, objects } = fakeStorage({ "u1/avatar.jpg": "image/jpeg" });

    const res = await replaceAvatarObject(client, "u1", file("image/png"), "image/png");

    expect(res.path).toBe("u1/avatar.png");
    expect(res.removed).toEqual(["u1/avatar.jpg"]);
    expect(res.staleRemaining).toEqual([]);
    // The assertion that matters: the old object is GONE from the bucket, not
    // merely absent from a list of things we asked to delete.
    expect([...objects.keys()]).toEqual(["u1/avatar.png"]);
  });

  it("sweeps EVERY legacy key, not just the one extension it happens to know", async () => {
    const { client, objects } = fakeStorage({
      "u1/avatar.jpg": "image/jpeg",
      "u1/avatar.jpeg": "image/jpeg",
      "u1/avatar.undefined": "image/jpeg",
      "u1/portfolio/work-1.jpg": "image/jpeg",
    });

    const res = await replaceAvatarObject(client, "u1", file("image/png"), "image/png");

    expect(res.removed.sort()).toEqual([
      "u1/avatar.jpeg",
      "u1/avatar.jpg",
      "u1/avatar.undefined",
    ]);
    // Portfolio images live in a SUB-FOLDER of the same bucket and must never
    // be in range of an avatar replace.
    expect(objects.has("u1/portfolio/work-1.jpg")).toBe(true);
  });

  it("is a no-op sweep when the format is unchanged (same key, upserted)", async () => {
    const { client, objects, removeCalls } = fakeStorage({ "u1/avatar.png": "image/png" });

    const res = await replaceAvatarObject(client, "u1", file("image/png"), "image/png");

    expect(removeCalls).toEqual([]);
    expect(res.staleRemaining).toEqual([]);
    expect([...objects.keys()]).toEqual(["u1/avatar.png"]);
    // Cache-busted, because a same-key replace is now the COMMON case and the
    // browser would otherwise keep painting the photo being retracted.
    expect(res.publicUrl).toMatch(/\/u1\/avatar\.png\?t=\d+$/);
  });

  it("reports a delete that reported success and did NOTHING", async () => {
    // `{ data: [], error: null }` is what an RLS-filtered remove returns. If
    // this module believed it, a member would be told their licence was gone.
    const { client, objects } = fakeStorage(
      { "u1/avatar.jpg": "image/jpeg" },
      { removeBehaviour: "silent-noop" },
    );

    const res = await replaceAvatarObject(client, "u1", file("image/png"), "image/png");

    expect(res.removed).toEqual([]);
    expect(res.staleRemaining).toEqual(["u1/avatar.jpg"]);
    expect(objects.has("u1/avatar.jpg")).toBe(true);
    // And it is loud from INSIDE the module, so a call site that reads only
    // `publicUrl` cannot make the exposure silent.
    expect(report).toHaveBeenCalledTimes(1);
    expect(vi.mocked(report).mock.calls[0][0]).toBeInstanceOf(Error);
    expect((vi.mocked(report).mock.calls[0][0] as Error).message).toContain("still public");
  });

  it("treats an unreadable folder as still-exposed, never as clean", async () => {
    const { client } = fakeStorage({ "u1/avatar.jpg": "image/jpeg" }, { listFails: true });

    const res = await replaceAvatarObject(client, "u1", file("image/png"), "image/png");

    expect(res.staleRemaining).toEqual(["u1/<unreadable folder>"]);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("throws on a failed upload and changes nothing", async () => {
    const { client, objects } = fakeStorage(
      { "u1/avatar.jpg": "image/jpeg" },
      { uploadError: { message: "network" } },
    );

    await expect(
      replaceAvatarObject(client, "u1", file("image/png"), "image/png"),
    ).rejects.toMatchObject({ message: "network" });
    // The old object is deliberately still here: a failed upload must not
    // leave the profile with no photo at all.
    expect([...objects.keys()]).toEqual(["u1/avatar.jpg"]);
  });
});
