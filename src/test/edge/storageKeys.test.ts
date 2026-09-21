/**
 * `supabase/functions/_shared/storageKeys.ts` — no client string ever reaches a
 * storage key.
 *
 * The bug these pin: `complete-signup` built FIVE storage keys by interpolating
 * a caller-supplied file extension, under the SERVICE ROLE key, so no storage
 * RLS was evaluated. Reproduced against PROD on 2026-09-01, all HTTP 200:
 *
 *   • `avatarExt: "php"`     → public object at `avatars/<uid>/avatar.php`
 *   • a second call, `"jpg"` → `avatar.jpg` created BESIDE it, `.php` still 200
 *   • `avatarExt: "png/../../<victim>/avatar.png"` → OVERWROTE a different
 *     account's public profile photo (verified by SHA of the served bytes
 *     before and after) from an unauthenticated request
 *
 * Every case below is one of those inputs, or a neighbour of it.
 */
import { describe, it, expect } from "vitest";

import {
  AVATAR_MIME_EXT,
  avatarObjectKey,
  avatarObjectNameFromUrl,
  resolveAvatarContentType,
  safeDocumentExt,
  sweepSupersededAvatars,
  type AvatarSweepClient,
} from "../../../supabase/functions/_shared/storageKeys.ts";

describe("resolveAvatarContentType — the client's extension is not evidence", () => {
  it("takes the declared content type when the bucket accepts it", () => {
    expect(resolveAvatarContentType("image/png", "php")).toBe("image/png");
    expect(resolveAvatarContentType("IMAGE/JPEG", "exe")).toBe("image/jpeg");
    expect(resolveAvatarContentType(" image/webp ", null)).toBe("image/webp");
  });

  it("falls back to the extension ONLY through a fixed table", () => {
    // Keeps an already-shipped .ipa working when it omits the content type…
    expect(resolveAvatarContentType(undefined, "JPEG")).toBe("image/jpeg");
    expect(resolveAvatarContentType(undefined, ".jpe")).toBe("image/jpeg");
    expect(resolveAvatarContentType(null, "gif")).toBe("image/gif");
    // …without letting the value itself through.
    expect(resolveAvatarContentType(undefined, "php")).toBeNull();
    expect(resolveAvatarContentType(undefined, "png/../../victim/avatar.png")).toBeNull();
    expect(resolveAvatarContentType("image/heic", "heic")).toBeNull();
    expect(resolveAvatarContentType(undefined, undefined)).toBeNull();
  });

  it("never resolves a type outside the bucket's allowed_mime_types", () => {
    for (const t of ["application/pdf", "text/html", "image/svg+xml", "image/heic"]) {
      expect(AVATAR_MIME_EXT[t]).toBeUndefined();
      expect(resolveAvatarContentType(t, "jpg")).toBe("image/jpeg"); // via the ext table only
    }
  });
});

describe("avatarObjectKey — four reachable keys per user, and no more", () => {
  it("collapses every spelling of a format onto one key", () => {
    expect(avatarObjectKey("u1", "image/jpeg")).toBe("u1/avatar.jpg");
    expect(avatarObjectKey("u1", "image/png")).toBe("u1/avatar.png");
    expect(avatarObjectKey("u1", "image/webp")).toBe("u1/avatar.webp");
    expect(avatarObjectKey("u1", "image/gif")).toBe("u1/avatar.gif");
  });

  it("agrees with the client module, which writes the SAME object", () => {
    // If these ever drift, a signup and a later profile edit orphan each other.
    expect(avatarObjectKey("u1", "image/jpeg")).toBe("u1/avatar.jpg");
    expect(Object.entries(AVATAR_MIME_EXT)).toEqual([
      ["image/jpeg", "jpg"],
      ["image/png", "png"],
      ["image/webp", "webp"],
      ["image/gif", "gif"],
    ]);
  });

  it("throws rather than inventing a default for an unclassified type", () => {
    expect(() => avatarObjectKey("u1", "application/x-php")).toThrow();
    expect(() => avatarObjectKey("u1", "")).toThrow();
  });
});

describe("safeDocumentExt — lenient about the type, never about the text", () => {
  it("derives from the content type when it recognises one", () => {
    expect(safeDocumentExt("application/pdf", "exe")).toBe("pdf");
    expect(safeDocumentExt("image/heic", "png/../../x")).toBe("heic");
    expect(safeDocumentExt("IMAGE/JPEG", null)).toBe("jpg");
  });

  it("falls back to the extension only when it is on the allow-list", () => {
    expect(safeDocumentExt("application/octet-stream", "PDF")).toBe("pdf");
    expect(safeDocumentExt(undefined, ".heic")).toBe("heic");
    expect(safeDocumentExt(undefined, "tif")).toBe("tif");
  });

  it("discards anything else rather than sanitising it", () => {
    // The traversal, the double extension, the empty value, the odd one — all
    // land on the same closed-set answer instead of reaching the key.
    expect(safeDocumentExt(undefined, "png/../../victim/id-document.png")).toBe("bin");
    expect(safeDocumentExt(undefined, "php")).toBe("bin");
    expect(safeDocumentExt(undefined, "jpg.php")).toBe("bin");
    expect(safeDocumentExt(undefined, "")).toBe("bin");
    expect(safeDocumentExt(undefined, undefined)).toBe("bin");
    expect(safeDocumentExt(undefined, { toString: () => "jpg" })).toBe("bin");
  });

  it("can never emit a path separator or a traversal", () => {
    const inputs = [
      "a/b", "../x", "..%2Fx", "png\\..\\y", "jpg?x=1", "jpg#f", "jpg ", " jpg",
      "png/../../other/avatar.png", "\u0000jpg", "jpg\u0000",
    ];
    for (const i of inputs) {
      const ext = safeDocumentExt(undefined, i);
      expect(ext).toMatch(/^[a-z0-9]{1,8}$/);
    }
  });
});

/**
 * A storage double backed by a real key→object map, so "did the old object
 * survive?" is answered by the same read the module makes. `"silent-noop"` is
 * the RLS-filtered delete verbatim: nothing removed, `error: null`.
 */
function fakeStorage(
  initial: string[],
  opts: { removeBehaviour?: "delete" | "silent-noop"; listFails?: boolean } = {},
) {
  const objects = new Set(initial);
  const removeCalls: string[][] = [];
  const client: AvatarSweepClient = {
    storage: {
      from: () => ({
        list: (prefix: string) => {
          if (opts.listFails) {
            return Promise.resolve({ data: null, error: { message: "denied" } });
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
            entries.push({ name, id: slash === -1 ? "obj" : null });
          }
          return Promise.resolve({ data: entries, error: null });
        },
        remove: (paths: string[]) => {
          removeCalls.push(paths);
          if (opts.removeBehaviour !== "silent-noop") {
            for (const p of paths) objects.delete(p);
          }
          return Promise.resolve({ data: [], error: null });
        },
      }),
    },
  };
  return { client, objects, removeCalls };
}

describe("sweepSupersededAvatars", () => {
  it("deletes the sibling a format swap left behind", async () => {
    // Exactly the prod reproduction: `avatar.php` written first, `avatar.jpg`
    // second, and `.php` served 200 forever.
    const { client, objects } = fakeStorage(["u1/avatar.php", "u1/avatar.jpg"]);
    const res = await sweepSupersededAvatars(client, "u1", "avatar.jpg");
    expect(res.removed).toEqual(["u1/avatar.php"]);
    expect(res.staleRemaining).toEqual([]);
    expect(objects.has("u1/avatar.jpg")).toBe(true);
  });

  it("never touches the portfolio sub-folder", async () => {
    const { client, objects } = fakeStorage(["u1/avatar.jpg", "u1/portfolio/a.png"]);
    await sweepSupersededAvatars(client, "u1", "avatar.jpg");
    expect(objects.has("u1/portfolio/a.png")).toBe(true);
  });

  it("reports the survivor when remove() silently removes nothing", async () => {
    const { client } = fakeStorage(["u1/avatar.php", "u1/avatar.jpg"], {
      removeBehaviour: "silent-noop",
    });
    const res = await sweepSupersededAvatars(client, "u1", "avatar.jpg");
    expect(res.removed).toEqual([]);
    expect(res.staleRemaining).toEqual(["u1/avatar.php"]);
  });

  it("reports still-exposed when the folder cannot be read", async () => {
    const { client, removeCalls } = fakeStorage(["u1/avatar.php"], { listFails: true });
    const res = await sweepSupersededAvatars(client, "u1", "avatar.jpg");
    expect(removeCalls).toEqual([]);
    expect(res.staleRemaining).toEqual(["u1/<unreadable folder>"]);
  });

  /**
   * `keep` takes a LIST now, because the sweep runs after the row write and
   * has two objects to protect: the one this call just uploaded, and whatever
   * `profiles.avatar_url` names at the instant before the delete. They differ
   * whenever a second replacement lands in between — and deleting the row's
   * object is precisely the divergence this whole change exists to stop.
   */
  describe("keeps every named object, not just its own upload", () => {
    it("keeps the upload AND the object the row names", async () => {
      const { client, objects } = fakeStorage([
        "u1/avatar.jpg", // this call's upload
        "u1/avatar.webp", // what the row names right now (another writer won)
        "u1/avatar.php", // a legacy orphan, the only thing that should go
      ]);

      const res = await sweepSupersededAvatars(client, "u1", ["avatar.jpg", "avatar.webp"]);

      expect(res.removed).toEqual(["u1/avatar.php"]);
      expect(res.staleRemaining).toEqual([]);
      expect([...objects].sort()).toEqual(["u1/avatar.jpg", "u1/avatar.webp"]);
    });

    it("a one-element list behaves exactly like the bare string it replaced", async () => {
      const a = fakeStorage(["u1/avatar.php", "u1/avatar.jpg"]);
      const b = fakeStorage(["u1/avatar.php", "u1/avatar.jpg"]);

      expect(await sweepSupersededAvatars(a.client, "u1", "avatar.jpg")).toEqual(
        await sweepSupersededAvatars(b.client, "u1", ["avatar.jpg"]),
      );
      expect([...a.objects]).toEqual([...b.objects]);
    });

    it("keeps nothing when told to keep nothing", async () => {
      // `null` and `[]` are the account-has-no-avatar case, not a licence to
      // guess: everything `avatar.*` goes, the portfolio folder still does not.
      const { client, objects } = fakeStorage(["u1/avatar.jpg", "u1/avatar.php", "u1/portfolio/a.png"]);

      const res = await sweepSupersededAvatars(client, "u1", null);

      expect(res.removed.sort()).toEqual(["u1/avatar.jpg", "u1/avatar.php"]);
      expect([...objects]).toEqual(["u1/portfolio/a.png"]);
    });

    it("still refuses to certify a silent delete when two names are kept", async () => {
      const { client } = fakeStorage(["u1/avatar.jpg", "u1/avatar.webp", "u1/avatar.php"], {
        removeBehaviour: "silent-noop",
      });

      const res = await sweepSupersededAvatars(client, "u1", ["avatar.jpg", "avatar.webp"]);

      expect(res.removed).toEqual([]);
      expect(res.staleRemaining).toEqual(["u1/avatar.php"]);
    });
  });
});

/**
 * The edge twin of `avatarObjectNameFromUrl` in `src/lib/avatarStorage.ts`.
 *
 * `complete-signup` re-reads `profiles.avatar_url` after its own update and
 * feeds the result to the sweep's keep-list. If this ever resolved a name it
 * should not — another member's folder, a Google avatar, a portfolio image —
 * the sweep would keep the wrong object, or protect nothing at all.
 */
describe("avatarObjectNameFromUrl", () => {
  const CDN = "https://x.supabase.co/storage/v1/object/public/avatars";

  it("names this user's avatar object, ignoring the cache-buster", () => {
    expect(avatarObjectNameFromUrl(`${CDN}/u1/avatar.jpg`, "u1")).toBe("avatar.jpg");
    expect(avatarObjectNameFromUrl(`${CDN}/u1/avatar.png?t=1757894400000`, "u1")).toBe("avatar.png");
    expect(avatarObjectNameFromUrl(`${CDN}/u1/avatar.php`, "u1")).toBe("avatar.php");
  });

  it("names nothing for anything else", () => {
    expect(avatarObjectNameFromUrl(`${CDN}/u2/avatar.jpg`, "u1")).toBeNull();
    expect(avatarObjectNameFromUrl(`${CDN}/u1/portfolio/a.png`, "u1")).toBeNull();
    expect(avatarObjectNameFromUrl("https://lh3.googleusercontent.com/a/x", "u1")).toBeNull();
    expect(avatarObjectNameFromUrl(null, "u1")).toBeNull();
    expect(avatarObjectNameFromUrl(undefined, "u1")).toBeNull();
    expect(avatarObjectNameFromUrl("", "u1")).toBeNull();
  });

  it("agrees with the client twin, which keeps the same object", () => {
    // If these drift, a signup sweep and a profile-edit sweep protect
    // different objects and one of them deletes the other's row target.
    expect(avatarObjectNameFromUrl(`${CDN}/u1/${avatarObjectKey("u1", "image/jpeg").slice(3)}`, "u1")).toBe(
      "avatar.jpg",
    );
  });
});

// PROVEN RED 2026-09-21: deleting the closed-set check in `safeDocumentExt`
// (so the caller's own string is returned) fails 2 of 21 — which is exactly
// the original defect, a client-supplied extension reaching a storage key
// under the service role with no RLS evaluated.
// SOURCE-TEXT PIN: this exercises the repo's `_shared/storageKeys.ts` directly.
// It cannot see an edge function that builds a key WITHOUT calling this module
// — `sharedImports.test.ts` is what covers that shape.
// @mutate supabase/functions/_shared/storageKeys.ts | if (DOCUMENT_EXT_ALLOWED.has(e)) return e; | return e;
