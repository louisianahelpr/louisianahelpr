// @mutate src/components/DisputeDialog.tsx | const ext = storageExtFor(file, "jpg"); | const ext = (file.name.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "jpg";
/**
 * docs/OPEN.md LIVE DEFECT #5 — a storage object key's extension must never
 * come from the client-supplied file NAME. `file.name.split(".").pop()`
 * lets a file named `x.php`, `x.html`, or `x` (no dot, so `.split(".").pop()`
 * returns the whole name) land with an attacker-chosen or garbage extension.
 *
 * The fix is one shared helper, `storageExtFor` (src/lib/storageExt.ts),
 * which derives the extension ONLY from `file.type` through a closed MIME
 * allowlist, with a caller-supplied fallback for an unrecognised type. This
 * guard scans every `src/**\/*.{ts,tsx}` file (comments blanked, so a file
 * merely describing the old bug in prose doesn't trip it) for the vulnerable
 * pattern and fails if it finds one outside the one documented exception.
 *
 * Exception: src/pages/auth/Signup.tsx sends `avatarExt` (read from
 * `file.name.split(".").pop()`) as a plain JSON field to the `complete-signup`
 * edge function — it does not build a storage key client-side. Server-side,
 * `resolveAvatarContentType()` (supabase/functions/_shared/storageKeys.ts)
 * only ever uses it to pick a MIME type from a tiny closed legacy-extension
 * allowlist (LEGACY_EXT_MIME); the actual object key is then built by
 * `avatarObjectKey()` from THAT resolved MIME type via its own closed
 * AVATAR_MIME_EXT map, never from caller text. No caller-supplied extension
 * text reaches a storage key through this path either way, so it is not an
 * instance of this defect class — but it's named here explicitly, not
 * silently excluded, so a future change that starts using it to build a key
 * trips this guard immediately.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");
const SRC = join(REPO, "src");

const PATTERN = /\.name\s*\.\s*split\s*\(\s*["'`]\.["'`]\s*\)\s*\.\s*pop\s*\(/;

// Exact, two-way: a file added here that no longer matches PATTERN (fixed, or
// deleted) must be removed in the same commit, or this list itself goes stale
// and silently widens the allowlist.
// @two-way src/test/storageKeyExtensionFromMime.test.ts:stale exception entry
const KNOWN_EXCEPTIONS = new Set(["src/pages/auth/Signup.tsx"]);

function allSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "test" || entry === "__mocks__") continue; // tests/fixtures scanned separately, not at all
      allSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("storage key extension always comes from MIME type, never file.name (docs/OPEN.md LIVE DEFECT #5)", () => {
  const files = allSourceFiles(SRC);

  it("scans a real inventory of source files", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("no file outside the documented exception uses file.name to derive a storage extension", () => {
    const offenders: string[] = [];
    for (const full of files) {
      const rel = relative(REPO, full).split("\\").join("/");
      if (KNOWN_EXCEPTIONS.has(rel)) continue;
      const code = blankComments(readFileSync(full, "utf8"));
      if (PATTERN.test(code)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("the documented exception still exists and still only matches because of avatarExt, not a storage key", () => {
    const full = join(REPO, "src", "pages", "auth", "Signup.tsx");
    const code = blankComments(readFileSync(full, "utf8"));
    expect(PATTERN.test(code)).toBe(true);
    // It must never build a Supabase Storage path — confirms the exception
    // wasn't papering over a real key-construction site.
    expect(code).not.toMatch(/\.storage\s*\.\s*from\s*\([^)]*\)\s*\.\s*upload\s*\(/);
  });

  it("the exception list has no stale entries (every listed path still exists)", () => {
    // This IS the stale exception entry check declared above the list: a
    // path removed from the repo without being removed here fails right
    // here, instead of silently widening the allowlist forever.
    for (const rel of KNOWN_EXCEPTIONS) {
      expect(() => statSync(join(REPO, rel)), rel).not.toThrow();
    }
  });
});
