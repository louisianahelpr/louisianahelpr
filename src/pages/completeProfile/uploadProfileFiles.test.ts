/**
 * `uploadProfileFiles` — the /complete-profile path saves the ROW IN THE MIDDLE.
 *
 * THE BUG THESE PIN (prod, 2026-09-15). This function used to hand a public URL
 * back to `CompleteProfile.tsx` with the previous `avatar.*` object ALREADY
 * deleted, and the page wrote `profiles.avatar_url` afterwards. Everything that
 * can make that write fail is ordinary on this exact screen:
 *
 *   • the bio trips the contact-leak check constraint (23514) — the page's own
 *     most common rejection,
 *   • the save times out,
 *   • the UPDATE matches zero rows and answers `{ data: [], error: null }`.
 *
 * In all three the member was left with `avatar_url` naming an object that no
 * longer existed, and every screen rendering them fired a 400.
 *
 * `saveRow` now runs as `replaceAvatarObject`'s row-writer: after the upload,
 * before any delete. So the property under test is not "the happy path still
 * works" — it is that each of those failures deletes NOTHING and leaves the row
 * on the object the bucket still holds.
 *
 * The storage double is backed by a real key set, so "did the old object
 * survive?" is answered by the same `list()` the module makes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const CDN = "https://cdn.test/storage/v1/object/public";
const USER = "u1";

/** Live objects, keyed `<bucket>/<path>`. Mutated by the double below. */
let objects = new Set<string>();
let removeCalls: string[][] = [];
let uploadError: { message: string } | null = null;
/** The RLS-filtered delete verbatim: `{ data: [], error: null }`, nothing gone. */
let silentRemove = false;
/** `profiles.avatar_url` as the row double holds it. */
let rowAvatarUrl: string | null = null;

const bucketApi = (bucket: string) => ({
  upload: async (path: string) => {
    if (uploadError) return { error: uploadError };
    objects.add(`${bucket}/${path}`);
    return { error: null };
  },
  getPublicUrl: (path: string) => ({ data: { publicUrl: `${CDN}/${bucket}/${path}` } }),
  list: async (prefix: string) => {
    const seen = new Set<string>();
    const entries: Array<{ name: string; id: string | null }> = [];
    for (const key of objects) {
      if (!key.startsWith(`${bucket}/${prefix}/`)) continue;
      const rest = key.slice(`${bucket}/${prefix}/`.length);
      const slash = rest.indexOf("/");
      const name = slash === -1 ? rest : rest.slice(0, slash);
      if (seen.has(name)) continue;
      seen.add(name);
      entries.push({ name, id: slash === -1 ? "obj" : null });
    }
    return { data: entries, error: null };
  },
  remove: async (paths: string[]) => {
    removeCalls.push(paths);
    // Both branches answer `error: null` — that is the whole point.
    if (!silentRemove) for (const p of paths) objects.delete(`${bucket}/${p}`);
    return { data: [], error: null };
  },
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: (bucket: string) => bucketApi(bucket) } },
}));

// The `read` half of the row. Mocked at the module boundary so the row's value
// is a real stored thing rather than a second PostgREST double.
vi.mock("@/lib/readProfileAvatarUrl", () => ({
  readProfileAvatarUrl: vi.fn(async () => rowAvatarUrl),
}));

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { uploadProfileFiles } from "./uploadProfileFiles";

const file = (type: string, size = 1024) => ({ type, size, name: "photo.heic" }) as unknown as File;
const avatarUrlFor = (name: string) => `${CDN}/avatars/${USER}/${name}`;

beforeEach(() => {
  objects = new Set<string>();
  removeCalls = [];
  uploadError = null;
  silentRemove = false;
  rowAvatarUrl = null;
});

describe("uploadProfileFiles — the profile row is saved before anything is deleted", () => {
  it("replaces the photo, saves the row, THEN retires the old object", async () => {
    objects.add(`avatars/${USER}/avatar.jpg`);
    rowAvatarUrl = avatarUrlFor("avatar.jpg");
    const order: string[] = [];

    const res = await uploadProfileFiles(USER, file("image/png"), null, async ({ avatarUrl }) => {
      order.push("saveRow");
      rowAvatarUrl = avatarUrl;
      return { id: "row-1" };
    });

    expect(res.saved).toEqual({ id: "row-1" });
    expect(res.staleAvatarObjects).toEqual([]);
    expect(order).toEqual(["saveRow"]);
    // The old object is gone and the row names the one that is left.
    expect([...objects]).toEqual([`avatars/${USER}/avatar.png`]);
    expect(rowAvatarUrl).toMatch(/\/u1\/avatar\.png\?t=\d+$/);
  });

  it("a REJECTED save (23514 contact-leak bio) deletes nothing", async () => {
    objects.add(`avatars/${USER}/avatar.jpg`);
    rowAvatarUrl = avatarUrlFor("avatar.jpg");

    await expect(
      uploadProfileFiles(USER, file("image/png"), null, async () => {
        throw Object.assign(new Error("violates check constraint"), { code: "23514" });
      }),
    ).rejects.toMatchObject({ code: "23514" });

    expect(removeCalls, "a failed save must delete NOTHING").toEqual([]);
    // The row still names avatar.jpg, and avatar.jpg is still in the bucket.
    expect(rowAvatarUrl).toBe(avatarUrlFor("avatar.jpg"));
    expect(objects.has(`avatars/${USER}/avatar.jpg`)).toBe(true);
  });

  it("a ZERO-ROW save deletes nothing — the caller's error reaches the caller", async () => {
    // `unwrapMutationRow` on `{ data: [], error: null }`: the save that looked
    // like a success and wrote nothing. If it resolved instead of throwing,
    // this is the delete that would orphan the row.
    objects.add(`avatars/${USER}/avatar.jpg`);
    rowAvatarUrl = avatarUrlFor("avatar.jpg");

    await expect(
      uploadProfileFiles(USER, file("image/png"), null, async () => {
        throw new Error("We couldn't save your profile — nothing was saved.");
      }),
    ).rejects.toThrow(/nothing was saved/);

    expect(removeCalls).toEqual([]);
    expect(rowAvatarUrl).toBe(avatarUrlFor("avatar.jpg"));
    expect(objects.has(`avatars/${USER}/avatar.jpg`)).toBe(true);
  });

  it("keeps whatever the row names when another writer won the race", async () => {
    // This call uploads avatar.png; by the time the sweep reads the row, a
    // second replacement has pointed it at avatar.webp. Deleting avatar.webp
    // here would orphan that row.
    objects.add(`avatars/${USER}/avatar.jpg`);
    objects.add(`avatars/${USER}/avatar.webp`);
    rowAvatarUrl = avatarUrlFor("avatar.jpg");

    await uploadProfileFiles(USER, file("image/png"), null, async () => {
      rowAvatarUrl = avatarUrlFor("avatar.webp");
      return { id: "row-1" };
    });

    expect(removeCalls).toEqual([[`${USER}/avatar.jpg`]]);
    expect([...objects].sort()).toEqual([
      `avatars/${USER}/avatar.png`,
      `avatars/${USER}/avatar.webp`,
    ]);
  });

  it("a failed upload never reaches the save at all", async () => {
    objects.add(`avatars/${USER}/avatar.jpg`);
    rowAvatarUrl = avatarUrlFor("avatar.jpg");
    uploadError = { message: "network" };
    const saveRow = vi.fn(async () => ({ id: "row-1" }));

    await expect(
      uploadProfileFiles(USER, file("image/png"), null, saveRow),
    ).rejects.toMatchObject({ message: "network" });

    expect(saveRow).not.toHaveBeenCalled();
    expect(removeCalls).toEqual([]);
    expect(objects.has(`avatars/${USER}/avatar.jpg`)).toBe(true);
  });

  it("rejects a file the bucket would refuse BEFORE any network call", async () => {
    // image/heic is what an iPhone hands over by default and is not in the
    // bucket's allowed_mime_types. The old code found out at the server.
    const saveRow = vi.fn(async () => ({ id: "row-1" }));

    await expect(
      uploadProfileFiles(USER, file("image/heic"), null, saveRow),
    ).rejects.toThrow(/JPG, PNG, WebP or GIF/);

    expect(saveRow).not.toHaveBeenCalled();
    expect(objects.size).toBe(0);
  });

  it("saves the row with a null avatar when no photo was picked", async () => {
    const res = await uploadProfileFiles(USER, null, null, async ({ avatarUrl, idDocumentPath }) => {
      expect(avatarUrl).toBeNull();
      expect(idDocumentPath).toBeNull();
      return { id: "row-1" };
    });

    expect(res).toEqual({ saved: { id: "row-1" }, staleAvatarObjects: [] });
    expect(removeCalls, "no photo was picked — nothing may be swept").toEqual([]);
  });

  it("hands back a superseded object that survived, instead of certifying the delete", async () => {
    // `{ data: [], error: null }` with nothing removed is what RLS answers.
    // CompleteProfile.tsx toasts on a non-empty `staleAvatarObjects`, which on
    // this screen may be the licence the member is trying to retract — so the
    // value has to come back, not merely be logged.
    objects.add(`avatars/${USER}/avatar.jpg`);
    rowAvatarUrl = avatarUrlFor("avatar.jpg");
    silentRemove = true;

    const res = await uploadProfileFiles(USER, file("image/png"), null, async ({ avatarUrl }) => {
      rowAvatarUrl = avatarUrl;
      return { id: "row-1" };
    });

    expect(res.staleAvatarObjects).toEqual([`${USER}/avatar.jpg`]);
    expect(objects.has(`avatars/${USER}/avatar.jpg`)).toBe(true);
  });
});

/*
 * THE ID-DOCUMENT KEY IS BUILT FROM THE FILE NAME, and nothing here tested the
 * only thing standing between that name and the bucket.
 *
 * `uploadProfileFiles.ts` builds `${userId}/id-document-${Date.now()}.
 * ${sanitizeExt(idFile.name)}`. `sanitizeExt` lowercases, then strips every
 * character that is not a-z0-9, then truncates to 5. Removing that strip —
 * leaving `name.split(".").pop()?.toLowerCase()` — left all 8 tests in this
 * file GREEN (measured 2026-09-21), and a browser will happily hand over a
 * File whose `name` a user chose.
 *
 * This is the client half of the family that produced the real incident:
 * `complete-signup` interpolated a caller-supplied extension into five storage
 * keys under the SERVICE ROLE, and a `png/../../<victim>/avatar.png` overwrote
 * another member's public photo (reproduced against prod 2026-09-01, see
 * supabase/functions/_shared/storageKeys.ts). The server half is guarded. This
 * half was not.
 *
 * Asserted on the KEY THAT REACHES THE BUCKET rather than on sanitizeExt in
 * isolation, because the property that matters is a path with no second
 * segment under the user's folder — not the return value of a helper.
 */
describe("the id-document key never inherits anything from the file name", () => {
  it("strips every non-alphanumeric character out of the extension", async () => {
    await uploadProfileFiles(
      USER,
      null,
      { type: "image/png", size: 1024, name: "scan.p/n g!" } as unknown as File,
      vi.fn(async () => ({ id: "row-1" })),
    );

    const keys = [...objects].filter((o) => o.startsWith("id-documents/"));
    expect(keys, "the id document was not uploaded — this test is not exercising the path").toHaveLength(1);
    const path = keys[0].replace("id-documents/", "");

    // Exactly two segments: the user's folder, then the object. A slash that
    // survived the scrub would make a third.
    expect(path.split("/"), `key escaped the user folder: ${path}`).toHaveLength(2);
    expect(path.startsWith(`${USER}/`)).toBe(true);
    expect(path, "a traversal segment reached the key").not.toContain("..");
    expect(path.split(".").pop(), "the extension kept characters the scrub must remove").toMatch(/^[a-z0-9]{0,5}$/);
  });

  it("falls back to a safe extension when the name has nothing usable", async () => {
    await uploadProfileFiles(
      USER,
      null,
      { type: "image/png", size: 1024, name: "no-extension-at-all" } as unknown as File,
      vi.fn(async () => ({ id: "row-1" })),
    );
    const path = [...objects].find((o) => o.startsWith("id-documents/"))!.replace("id-documents/", "");
    expect(path.split("/")).toHaveLength(2);
    expect(path.split(".").pop()).toMatch(/^[a-z0-9]{1,5}$/);
  });
});

// PROVEN RED 2026-09-21. Removing the character scrub from `sanitizeExt` — so
// the browser-supplied File.name reaches the storage key — produces
// `u1/id-document-1790011062213.p/n g`: a SLASH in the key, a third path
// segment, an object written somewhere nobody intended inside the private
// `id-documents` bucket.
//
// That exact mutation left this file 8/8 GREEN before the two cases above
// existed. It is the client half of the family behind the real incident:
// `complete-signup` interpolated a caller-supplied extension into five keys
// under the SERVICE ROLE and `png/../../<victim>/avatar.png` overwrote another
// member's public photo (reproduced against prod 2026-09-01; see
// supabase/functions/_shared/storageKeys.ts). The server half was guarded and
// this half was not.
//
// SOURCE-TEXT PIN: Storage is a fake here. It proves the KEY this code builds;
// it proves nothing about the bucket's RLS, its MIME allow-list, or its size
// cap — those are storageBucketLimits.test.ts's job.
// @mutate src/pages/completeProfile/constants.ts | const ext = name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") \|\| "bin"; | const ext = name.split(".").pop()?.toLowerCase() \|\| "bin";
