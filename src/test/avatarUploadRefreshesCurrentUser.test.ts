/**
 * A new profile photo shows everywhere at once (Q1001). Seen on prod
 * 2026-10-12 at 375 (Eli, a test account, Supabase writes refused except the
 * upload and the row): after "Use Photo" in Edit Profile, the page's own card
 * showed the new photo but the dock's Profile tab still read "EH", because
 * Profile.tsx updated only its local state and every other avatar reads
 * useCurrentUser's cache.
 *
 * Class: every component that replaces the avatar (replaceAvatarObject, the
 * one upload path) also refreshes the current-user cache in the same file,
 * or is a helper whose caller does (listed with its caller, two-way).
 *
 * @mutate src/pages/profile/Profile.tsx |     void queryClient.invalidateQueries({ queryKey: queryKeys.currentUser.byId(userId) }); |     void 0;
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");
const rel = (f: string) => f.slice(ROOT.length + 1);

/** Helper modules that upload for a caller which owns the cache refresh: helper -> caller. */
const HELPER_CALLER: Record<string, string> = {
  "src/pages/auth/completeProfile/uploadProfileFiles.ts": "src/pages/auth/CompleteProfile.tsx",
};
/** Where the function is defined, not a caller. */
const DEFINITION = "src/lib/avatarStorage.ts";

const refreshesCurrentUser = (src: string) => /(invalidateQueries|setQueryData)\(\s*\{?\s*(queryKey:\s*)?queryKeys\.currentUser\.byId\(/.test(src);

describe("an avatar upload refreshes the signed-in user's cache", () => {
  const files = walkSource([join(ROOT, "src")]).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.|\/test\//.test(f));
  const callers = files.filter((f) => /\breplaceAvatarObject\(/.test(blankComments(readFileSync(f, "utf8")))).map(rel).filter((f) => f !== DEFINITION);

  it("finds the callers (floor)", () => {
    expect(files.length).toBeGreaterThan(500);
    // 2: Profile.tsx and uploadProfileFiles.ts (PhotoPrompt.tsx was the third
    // until the owner removed that prompt, 2026-10-14).
    expect(callers.length).toBeGreaterThanOrEqual(2);
  });

  it("every caller refreshes queryKeys.currentUser, itself or through its listed caller", () => {
    const missing = callers.filter((f) => {
      const owner = HELPER_CALLER[f] ?? f;
      return !refreshesCurrentUser(blankComments(readFileSync(join(ROOT, owner), "utf8")));
    });
    expect(missing).toEqual([]);
  });

  it("the helper list is exact (no stale entry)", () => {
    for (const helper of Object.keys(HELPER_CALLER)) expect(callers, helper).toContain(helper);
  });
});
