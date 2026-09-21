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
 *
 * The third, and the reason `replaceAvatarObject` now takes the ROW: the sweep
 * used to run BEFORE the caller wrote `profiles.avatar_url`. A row write that
 * then failed — a contact-leak bio rejected with 23514, a timeout, an UPDATE
 * that matched zero rows and answered `{ data: [], error: null }` — left the
 * row naming an object this code had just deleted, and every screen rendering
 * that member fired a 400 (22 of them on prod, 2026-09-15). So every test in
 * "the row moves first" below asserts the same pair of facts: the bucket still
 * holds the object the row names, and NOTHING was removed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  assertUploadableAvatar,
  avatarObjectKey,
  avatarObjectNameFromUrl,
  isAvatarObjectName,
  replaceAvatarObject,
  AvatarTooLargeError,
  UnsupportedAvatarError,
  type AvatarProfileRow,
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
    /** Shared ordered log — see `fakeRow`, which appends to the same array. */
    events?: string[];
  } = {},
) {
  const objects = new Map(Object.entries(initial));
  const removeCalls: string[][] = [];

  const client: AvatarStorageClient = {
    storage: {
      from: () => ({
        upload: (path: string, _body: unknown, o?: { contentType?: string }) => {
          opts.events?.push(`upload:${path}`);
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
          opts.events?.push(`remove:${paths.join(",")}`);
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

const CDN = "https://cdn.test/storage/v1/object/public/avatars";
/** What the app's row holds for one of this user's objects. */
const rowUrl = (name: string, userId = "u1") => `${CDN}/${userId}/${name}?t=1757894400000`;

/**
 * The `AvatarProfileRow` half of a replacement, backed by a real stored value
 * so "what does the row name NOW?" is answered by reading it back rather than
 * by a recorded call.
 *
 * `writeBehaviour` is the part that matters:
 *   "reject"   — Postgres refused the UPDATE (23514 on a contact-leak bio, a
 *                timeout). The caller's error must reach the caller unchanged.
 *   "zero-row" — the UPDATE matched NOTHING and answered
 *                `{ data: [], error: null }`. A null `error` is not a write, so
 *                the row-writer (`unwrapMutation`) throws instead of resolving.
 * Both are the case that used to leave the row on a deleted object, and both
 * must leave the bucket exactly as they found it.
 */
function fakeRow(
  initialName: string | null,
  opts: {
    writeBehaviour?: "store" | "reject" | "zero-row";
    readFails?: boolean;
    /** Value `read()` answers, whatever was written — a racing second tab. */
    readsAs?: string | null;
    userId?: string;
    events?: string[];
  } = {},
) {
  const userId = opts.userId ?? "u1";
  let value = initialName === null ? null : rowUrl(initialName, userId);
  const writes: string[] = [];

  const row: AvatarProfileRow = {
    write: async (publicUrl: string) => {
      opts.events?.push(`row.write:${publicUrl}`);
      writes.push(publicUrl);
      if (opts.writeBehaviour === "reject") {
        throw Object.assign(
          new Error('new row for relation "profiles" violates check constraint "bio_no_contact"'),
          { code: "23514" },
        );
      }
      if (opts.writeBehaviour === "zero-row") {
        // Verbatim shape of what `unwrapMutation` throws on `{ data: [] }`.
        throw new Error("Couldn't pin your new photo to your profile — nothing was saved.");
      }
      value = publicUrl;
    },
    read: async () => {
      opts.events?.push("row.read");
      if (opts.readFails) throw new Error("profile read failed");
      if (opts.readsAs !== undefined) {
        return opts.readsAs === null ? null : rowUrl(opts.readsAs, userId);
      }
      return value;
    },
  };

  return { row, writes, current: () => value };
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

describe("avatarObjectNameFromUrl — which object does a stored row name?", () => {
  it("reads this user's avatar object out of a stored URL, query string and all", () => {
    expect(avatarObjectNameFromUrl(`${CDN}/u1/avatar.jpg`, "u1")).toBe("avatar.jpg");
    expect(avatarObjectNameFromUrl(`${CDN}/u1/avatar.png?t=1757894400000`, "u1")).toBe("avatar.png");
    // The legacy key space the old scheme could produce is still recognised —
    // the sweep must be able to KEEP one, not only delete it.
    expect(avatarObjectNameFromUrl(`${CDN}/u1/avatar.undefined`, "u1")).toBe("avatar.undefined");
  });

  it("names nothing for a URL that is not this user's avatar object", () => {
    // Another member's folder: the sweep must never keep (or delete) on this.
    expect(avatarObjectNameFromUrl(`${CDN}/u2/avatar.jpg`, "u1")).toBeNull();
    expect(avatarObjectNameFromUrl(`${CDN}/u1/portfolio/work-1.jpg`, "u1")).toBeNull();
    expect(avatarObjectNameFromUrl("data:image/png;base64,AAAA", "u1")).toBeNull();
    expect(avatarObjectNameFromUrl("https://lh3.googleusercontent.com/a/x", "u1")).toBeNull();
    expect(avatarObjectNameFromUrl(null, "u1")).toBeNull();
    expect(avatarObjectNameFromUrl(undefined, "u1")).toBeNull();
  });
});

describe("replaceAvatarObject — the orphan bug", () => {
  it("REPLACES a .jpg with a .png instead of leaving both public", async () => {
    const { client, objects } = fakeStorage({ "u1/avatar.jpg": "image/jpeg" });
    const { row } = fakeRow("avatar.jpg");

    const res = await replaceAvatarObject(client, "u1", file("image/png"), "image/png", row);

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
    const { row } = fakeRow("avatar.jpg");

    const res = await replaceAvatarObject(client, "u1", file("image/png"), "image/png", row);

    expect(res.removed.sort()).toEqual([
      "u1/avatar.jpeg",
      "u1/avatar.jpg",
      "u1/avatar.undefined",
    ]);
    // Portfolio images live in a SUB-FOLDER of the same bucket and must never
    // be in range of an avatar replace.
    expect(objects.has("u1/portfolio/work-1.jpg")).toBe(true);
  });

  /**
   * THE SUB-FOLDER SKIP, ASSERTED SO IT CAN FAIL.
   *
   * The test above already says "a portfolio image is never in range", and it
   * is true — but it cannot fail: `listSupersededAvatars` drops that entry
   * twice over, once for `o.id !== null` (a folder lists with a NULL id) and
   * once for `isAvatarObjectName("portfolio")`. Deleting the id check left the
   * whole file green (probed 2026-09-21), because the NAME check was already
   * hiding the difference. Two independent gates on one assertion is one gate
   * nobody is guarding.
   *
   * So the case below names the folder something the NAME check accepts. A
   * bucket folder called `avatar.png` (a member's own upload path, or a
   * `.list()` of a prefix that has one) lists as `{ name: "avatar.png",
   * id: null }`, and deleting an object key that is really a folder prefix
   * would take the files under it. Only the id check stands in the way.
   */
  it("never sweeps a FOLDER whose name looks like an avatar object", async () => {
    const { client, objects, removeCalls } = fakeStorage({
      "u1/avatar.jpg": "image/jpeg",
      // A sub-folder, not an object: `.list()` answers one entry named
      // "avatar.png" with a NULL id.
      "u1/avatar.png/inner.jpg": "image/jpeg",
    });
    const { row } = fakeRow("avatar.jpg");

    const res = await replaceAvatarObject(client, "u1", file("image/webp"), "image/webp", row);

    expect(res.removed, "only the real object may be swept").toEqual(["u1/avatar.jpg"]);
    expect(removeCalls.flat(), "a folder prefix was handed to remove()").not.toContain(
      "u1/avatar.png",
    );
    expect(objects.has("u1/avatar.png/inner.jpg"), "the folder's contents survived").toBe(true);
  });

  /**
   * A FULL PAGE IS NOT A FOLDER LISTING.
   *
   * `.list()` is called with `{ limit: 100 }`, so exactly 100 entries means
   * "the first 100 of an unknown number" — and certifying the unread remainder
   * as swept is the same defect as reading a null `error` as success.
   * `listSupersededAvatars` answers `null` for a full page, which both callers
   * turn into still-exposed. Deleting that line left the whole file green
   * (probed 2026-09-21): nothing here had ever handed the module a full page.
   */
  it("treats a FULL page of 100 entries as unreadable, and removes nothing", async () => {
    const many: Record<string, string> = { "u1/avatar.jpg": "image/jpeg" };
    // 100 entries exactly — the cap `listSupersededAvatars` passes to .list().
    for (let i = 0; i < 99; i++) many[`u1/avatar.x${i}`] = "image/jpeg";
    const { client, objects, removeCalls } = fakeStorage(many);
    const { row } = fakeRow("avatar.jpg");

    const res = await replaceAvatarObject(client, "u1", file("image/png"), "image/png", row);

    expect(removeCalls, "an unread remainder may not be swept on a guess").toEqual([]);
    expect(res.removed).toEqual([]);
    expect(res.staleRemaining).toEqual(["u1/<unreadable folder>"]);
    expect(objects.has("u1/avatar.jpg"), "nothing was deleted").toBe(true);
    // And it is REPORTED — unknown is never silently clean.
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("is a no-op sweep when the format is unchanged (same key, upserted)", async () => {
    const { client, objects, removeCalls } = fakeStorage({ "u1/avatar.png": "image/png" });
    const { row } = fakeRow("avatar.png");

    const res = await replaceAvatarObject(client, "u1", file("image/png"), "image/png", row);

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
    const { row } = fakeRow("avatar.jpg");

    const res = await replaceAvatarObject(client, "u1", file("image/png"), "image/png", row);

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
    const { row } = fakeRow("avatar.jpg");

    const res = await replaceAvatarObject(client, "u1", file("image/png"), "image/png", row);

    expect(res.staleRemaining).toEqual(["u1/<unreadable folder>"]);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("throws on a failed upload and changes nothing — the row is never asked", async () => {
    const { client, objects } = fakeStorage(
      { "u1/avatar.jpg": "image/jpeg" },
      { uploadError: { message: "network" } },
    );
    const { row, writes } = fakeRow("avatar.jpg");

    await expect(
      replaceAvatarObject(client, "u1", file("image/png"), "image/png", row),
    ).rejects.toMatchObject({ message: "network" });
    // The old object is deliberately still here: a failed upload must not
    // leave the profile with no photo at all.
    expect([...objects.keys()]).toEqual(["u1/avatar.jpg"]);
    expect(writes, "an upload that failed must not move the row").toEqual([]);
  });
});

/**
 * THE ORDER. Upload → confirmed row write → sweep, and every failure before
 * the sweep leaves the bucket alone.
 *
 * This is the invariant `src/test/avatarRowObjectAgreement.test.ts` enforces
 * from source across every call site; these prove the same thing by running it.
 * Both client call sites go through this function — `Profile.tsx` hands over a
 * row-writer that is `unwrapMutation(update(...).select("id"))`, and
 * `CompleteProfile` hands over one via `uploadProfileFiles` — so the two
 * behaviours below are what each of those paths does.
 */
describe("replaceAvatarObject — the row moves first", () => {
  it("writes the row BEFORE it removes anything", async () => {
    const events: string[] = [];
    const { client } = fakeStorage({ "u1/avatar.jpg": "image/jpeg" }, { events });
    const { row } = fakeRow("avatar.jpg", { events });

    await replaceAvatarObject(client, "u1", file("image/png"), "image/png", row);

    const write = events.findIndex((e) => e.startsWith("row.write:"));
    const remove = events.findIndex((e) => e.startsWith("remove:"));
    expect(write, "the row was never written").toBeGreaterThan(-1);
    expect(remove, "the superseded object was never removed").toBeGreaterThan(-1);
    expect(events[0]).toBe("upload:u1/avatar.png");
    expect(write < remove, `row.write must precede remove — got ${events.join(" → ")}`).toBe(true);
  });

  it("hands the row the SAME cache-busted URL it returns", async () => {
    const { client } = fakeStorage({ "u1/avatar.jpg": "image/jpeg" });
    const { row, writes } = fakeRow("avatar.jpg");

    const res = await replaceAvatarObject(client, "u1", file("image/png"), "image/png", row);

    // A row pointed at the un-busted URL and a browser painting the photo being
    // retracted are the same defect from two sides.
    expect(writes).toEqual([res.publicUrl]);
    expect(res.publicUrl).toMatch(/\/u1\/avatar\.png\?t=\d+$/);
  });

  it("a REJECTED row write deletes nothing and re-throws the error unchanged", async () => {
    // 23514: the contact-leak bio constraint, the real rejection this hit on
    // /complete-profile. The caller branches on the code, so it must survive.
    const { client, objects, removeCalls } = fakeStorage({ "u1/avatar.jpg": "image/jpeg" });
    const { row, current } = fakeRow("avatar.jpg", { writeBehaviour: "reject" });

    await expect(
      replaceAvatarObject(client, "u1", file("image/png"), "image/png", row),
    ).rejects.toMatchObject({ code: "23514" });

    expect(removeCalls, "a failed row write must delete NOTHING").toEqual([]);
    // The row still names avatar.jpg, and avatar.jpg is still there. The new
    // upload sits beside it — a spare file, never a broken photo.
    expect(current()).toContain("/u1/avatar.jpg");
    expect(objects.has("u1/avatar.jpg")).toBe(true);
    expect(objects.has("u1/avatar.png")).toBe(true);
    expect(report, "nothing was exposed, so nothing is reported").not.toHaveBeenCalled();
  });

  it("a ZERO-ROW row write deletes nothing — a null error is not a write", async () => {
    // `.update()` matching no row answers `{ data: [], error: null }`. The
    // row-writer turns that into a throw (unwrapMutation); if it ever resolved
    // instead, THIS is the delete that would orphan the row.
    const { client, objects, removeCalls } = fakeStorage({ "u1/avatar.jpg": "image/jpeg" });
    const { row, current } = fakeRow("avatar.jpg", { writeBehaviour: "zero-row" });

    await expect(
      replaceAvatarObject(client, "u1", file("image/png"), "image/png", row),
    ).rejects.toThrow(/nothing was saved/);

    expect(removeCalls).toEqual([]);
    expect(current()).toContain("/u1/avatar.jpg");
    expect(objects.has("u1/avatar.jpg")).toBe(true);
  });

  it("KEEPS whatever the row names, even when that is not what it just uploaded", async () => {
    // Two tabs racing: this call uploaded avatar.png, but by the time the sweep
    // reads the row a second replacement has already pointed it at avatar.webp.
    // Deleting avatar.webp here would orphan the OTHER tab's row.
    const { client, objects } = fakeStorage({
      "u1/avatar.jpg": "image/jpeg",
      "u1/avatar.webp": "image/webp",
    });
    const { row } = fakeRow("avatar.jpg", { readsAs: "avatar.webp" });

    const res = await replaceAvatarObject(client, "u1", file("image/png"), "image/png", row);

    expect(res.removed).toEqual(["u1/avatar.jpg"]);
    expect(res.staleRemaining).toEqual([]);
    expect([...objects.keys()].sort()).toEqual(["u1/avatar.png", "u1/avatar.webp"]);
  });

  it("keeps the row's object when the row names something this call did not touch", async () => {
    // Same-format replace (png over png) while the row still names avatar.gif:
    // the kept set is the union, not "the one I uploaded".
    const { client, objects } = fakeStorage({
      "u1/avatar.png": "image/png",
      "u1/avatar.gif": "image/gif",
      "u1/avatar.undefined": "image/jpeg",
    });
    const { row } = fakeRow("avatar.gif", { readsAs: "avatar.gif" });

    const res = await replaceAvatarObject(client, "u1", file("image/png"), "image/png", row);

    expect(res.removed).toEqual(["u1/avatar.undefined"]);
    expect([...objects.keys()].sort()).toEqual(["u1/avatar.gif", "u1/avatar.png"]);
  });

  it("deletes NOTHING when the row cannot be re-read, and says so", async () => {
    // Unknown is never "clean": the same rule the folder-unreadable case gets.
    const { client, objects, removeCalls } = fakeStorage({ "u1/avatar.jpg": "image/jpeg" });
    const { row } = fakeRow("avatar.jpg", { readFails: true });

    const res = await replaceAvatarObject(client, "u1", file("image/png"), "image/png", row);

    expect(removeCalls).toEqual([]);
    expect(res.removed).toEqual([]);
    expect(res.staleRemaining).toEqual(["u1/<profile row unreadable — nothing removed>"]);
    expect(objects.has("u1/avatar.jpg")).toBe(true);
    // Loud from inside the module, like every other unverified outcome.
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("sweeps everything but its own upload when the row names no avatar object", async () => {
    // A Google-login avatar, or a row that was NULL: there is nothing extra to
    // keep, and the legacy objects must still go.
    const { client, objects } = fakeStorage({
      "u1/avatar.jpg": "image/jpeg",
      "u1/avatar.undefined": "image/jpeg",
    });
    const { row } = fakeRow(null, { readsAs: null });

    const res = await replaceAvatarObject(client, "u1", file("image/png"), "image/png", row);

    expect(res.removed.sort()).toEqual(["u1/avatar.jpg", "u1/avatar.undefined"]);
    expect([...objects.keys()]).toEqual(["u1/avatar.png"]);
  });
});
// THE line this module exists for: the storage key is derived from the MIME
// type the bucket allows, never from user-supplied text. The mutation puts the
// old filename-derived extension back, which is what left two identity
// documents publicly fetchable at superseded keys.
// @mutate src/lib/avatarStorage.ts | const ext = AVATAR_MIME_EXT[contentType.toLowerCase()]; | const ext = contentType.split("/").pop();
// ...the full-page guard: 100 entries back from a limit-100 list is "the first
// 100 of an unknown number", never a folder listing.
// @mutate src/lib/avatarStorage.ts | if (data.length >= LIMIT) return null; |

// ...and the sub-folder skip, which keeps a folder prefix out of remove().
// @mutate src/lib/avatarStorage.ts | o.id !== null && |
