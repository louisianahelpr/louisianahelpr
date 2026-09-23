/*
 * CLASS GUARD: never treat a not-yet-resolved auth state as "signed out".
 *
 * `supabase.auth.getUser()` resolves asynchronously — it goes to the network
 * whenever the access token needs refreshing — so on a cold load it can answer
 * `null` for a user who IS signed in. An effect that samples it once, returns
 * early on `!user`, and has no dependency to re-run on is permanently wrong
 * for that user.
 *
 * This has now cost two distinct, visible defects:
 *
 *   useAppShellViewport  "ran on mount, read `null`, and REMOVED the
 *                        `desktop-rail` class" — the page painted full width
 *                        then jumped 248px when auth landed.
 *   NotificationPreferences  returned before `setLoaded(true)`, so every
 *                        switch stayed `disabled={!loaded}` FOREVER, with no
 *                        error and no spinner. Measured on prod by the press
 *                        sweep (run 35768341847, /profile?tab=notifications,
 *                        customer): 38 controls found, 26 failed, each a
 *                        `<button disabled role="switch" data-disabled="">`
 *                        that never became clickable inside 16 seconds.
 *
 * `useAuthReady` is the fix for both: it exposes `isReady` so a caller can
 * tell "no user" from "not yet", and normalises the corrupt-session case once.
 *
 * WHAT THIS ASSERTS, and why it is source-shaped rather than a render test:
 * the defect is an effect that CANNOT re-run. A render test would have to
 * reproduce a token refresh mid-mount to see it, which is exactly why it went
 * unnoticed. The dependency array is the thing that is wrong, so read it.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const root = join(__dirname, "..", "..");
const SRC = join(root, "src");

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
};

const files = walk(SRC);

/** Strip comments — a comment naming getUser() is not a call to it. */
const codeOf = (src: string) => blankComments(src);

/**
 * Files that still sample auth once, each with the reason it is acceptable
 * THERE. An entry is a claim that the pending-auth window is unreachable on
 * that surface — not a way to silence the rule.
 *
 * Both entries were CONVERTED to `useAuthReady` and then reverted, because the
 * conversion broke real tests rather than because it was hard: these dialogs
 * deliberately mock the supabase auth client (`ActionsTab`'s own comment says
 * it avoids `useCurrentUser()` for the same reason — the tests mount no
 * providers), so reading a different source made them see no admin at all. One
 * of the tests it broke is "disables Suspend / Ban on the acting admin's OWN
 * row" — a safety assertion. Weakening that to satisfy this rule would trade a
 * proven guard for an unproven one.
 */
const ALLOWED: Record<string, string> = {
  "src/components/admin/userDetail/ActionsTab.tsx":
    "Admin-only dialog, opened from inside the admin panel — reaching it already " +
    "required a resolved session, so the token is warm and the pending-auth window " +
    "is not reachable here. Its tests mock supabase.auth directly.",
  "src/components/admin/AdminUserNotes.tsx":
    "Same surface and the same warm-token argument; currentAdminId only decides " +
    "which notes show an edit affordance.",
};

describe("auth is never sampled once and treated as final", () => {
  it("found a real inventory to check (cannot pass vacuously)", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("no component awaits supabase.auth.getUser() inside a useEffect with EMPTY deps", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const code = codeOf(readFileSync(file, "utf8"));
      if (!code.includes("auth.getUser()")) continue;

      // Every `useEffect(..., [])` block in the file, matched to its closing
      // dep array. Crude but sufficient: we only need to know whether a
      // getUser() call sits inside a block that ends `}, []);`.
      const re = /useEffect\(\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\}\s*,\s*\[\s*\]\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(code))) {
        if (m[1].includes("auth.getUser()")) {
          offenders.push(file.replace(root + "/", ""));
          break;
        }
      }
    }

    const unexplained = offenders.filter((f) => !(f in ALLOWED));

    expect(
      unexplained,
      "These effects sample auth ONCE and can never re-run. If getUser() answers " +
        "null while a token refresh is in flight, the early-return path is taken " +
        "permanently for a user who IS signed in — the NotificationPreferences bug, " +
        "where 26 switches stayed disabled forever. Use `useAuthReady()` and depend " +
        "on `isReady`/`user` instead:\n  " + offenders.join("\n  "),
    ).toEqual([]);

    // The allowlist may not rot: an entry that no longer matches is a stale
    // excuse, and the next reader would trust it.
    const stale = Object.keys(ALLOWED).filter((f) => !offenders.includes(f));
    expect(
      stale,
      "These files are allowlisted but no longer sample auth once — delete their " +
        "entries so the list keeps meaning what it says: " + stale.join(", "),
    ).toEqual([]);
  });

  it("NotificationPreferences specifically depends on the resolved auth state", () => {
    // The screen the owner's sweep caught. Pinned by name because its failure
    // is silent — disabled controls look like a design choice, not a bug.
    const code = codeOf(readFileSync(join(SRC, "components/NotificationPreferences.tsx"), "utf8"));
    expect(code, "must read the shared auth snapshot").toContain("useAuthReady()");
    expect(code, "must re-run when auth settles").toMatch(/\}, \[authReady, authUser\]\)/);
    // And it must still mark itself loaded on the genuinely-signed-out path,
    // or the tab presents itself as mid-load forever for a guest instead.
    expect(code).toMatch(/if \(!user\) \{[\s\S]*?setLoaded\(true\)/);
  });
});

// Proof this is able to fail — restores the exact shape that shipped.
// @mutate src/components/NotificationPreferences.tsx | }, [authReady, authUser]); | }, []);
