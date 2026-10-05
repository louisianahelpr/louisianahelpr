/**
 * CLASS GUARD (Q1313): every "Notify Me When Work Lands" button is PUSH ONLY and
 * every one goes the same place.
 *
 * Owner, 2026-10-05: the button is push only, no email list. Signed in it saves
 * the job-match push preference and asks the device for permission; signed out
 * it goes to quick sign-up with a reason the page words. Before this, the
 * signed-in button on the feed just opened the Notifications settings tab (it
 * did not turn anything on) and both guest buttons went to a bare /signup that
 * never said why the visitor was there.
 *
 * THE CLASS, from the source tree: every non-test src file whose CODE (comments
 * blanked) carries one of the Notify button labels. Each label's handler must
 * be the shared one (useNotifyWhenWorkLands, or NOTIFY_SIGNUP_URL for the
 * guest-only surfaces), never an inline navigate to a bare /signup or to the
 * settings tab.
 *
 * @mutate src/components/dashboard/BrowseTasksFeed.tsx | onClick={notifyWhenWorkLands} | onClick={() => navigate("/signup")}
 * @mutate src/pages/home/DashboardGuest.tsx | onNotify={() => navigate(NOTIFY_SIGNUP_URL)} | onNotify={() => navigate("/signup")}
 * @mutate src/pages/home/DashboardGuest.tsx | onClick: () => navigate(NOTIFY_SIGNUP_URL), | onClick: () => navigate("/signup"),
 * @mutate src/lib/notifyWhenWorkLands.ts | export const NOTIFY_PREF_PATCH = { push_enabled: true, job_matches: true } as const; | export const NOTIFY_PREF_PATCH = { push_enabled: false, job_matches: true } as const;
 * @mutate src/lib/notifyWhenWorkLands.ts | .select("user_id"); | ;
 * @mutate src/pages/auth/Signup.tsx | isNotifySignupReason(searchParams.get("reason")) ? | false ?
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";
import {
  NOTIFY_PREF_PATCH,
  NOTIFY_SIGNUP_URL,
  NOTIFY_SIGNUP_SUBTITLE,
  isNotifySignupReason,
} from "@/lib/notifyWhenWorkLands";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const LABEL = /Notify Me When (?:Work|One) Lands|Get pinged when a job lands/;
const SHARED_HANDLER = /NOTIFY_SIGNUP_URL|notifyWhenWorkLands/;

function sourceFiles(): string[] {
  return trackedFiles("src").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.includes("/test/"));
}

/** Files whose code (comments blanked) carries a Notify button label. */
function labelFiles(): string[] {
  return sourceFiles().filter((f) => LABEL.test(blankComments(read(f))));
}

describe("Notify Me When Work Lands is push only (Q1313)", () => {
  it("inventory: the three button surfaces are found (floor, so the scan cannot go empty)", () => {
    const files = labelFiles().map((f) => f.replace(/^.*src\//, "src/")).sort();
    expect(files).toEqual([
      "src/components/dashboard/BrowseTasksFeed.tsx",
      "src/components/dashboard/GuestEmptyStateActions.tsx",
      "src/pages/home/DashboardGuest.tsx",
    ]);
  });

  it("every Button carrying a Notify label uses the shared handler or the passed-in onNotify", () => {
    let checked = 0;
    for (const f of labelFiles()) {
      const code = blankComments(read(f));
      const m = LABEL.exec(code);
      if (!m) continue;
      const before = code.slice(0, m.index);
      const start = Math.max(before.lastIndexOf("<Button"), before.lastIndexOf("<button"));
      if (start === -1 || before.slice(start).includes("emptyStateCta")) continue; // object-literal CTA: checked below
      const opening = code.slice(start, m.index);
      expect(opening, `${f}: Notify button handler`).toMatch(/onClick=\{(?:notifyWhenWorkLands|onNotify)\}/);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(2);
  });

  it("every onNotify={...} in the app is NOTIFY_SIGNUP_URL (guest) or the shared hook", () => {
    let seen = 0;
    for (const f of sourceFiles()) {
      for (const m of blankComments(read(f)).matchAll(/onNotify=\{([^\n]*)\}\s*$/gm)) {
        seen++;
        expect(m[1], `${f}: onNotify handler`).toMatch(SHARED_HANDLER);
      }
    }
    expect(seen).toBeGreaterThanOrEqual(1);
  });

  it("the guest map's emptyStateCta goes to the notify sign-up, not a bare /signup", () => {
    const code = blankComments(read("src/pages/home/DashboardGuest.tsx"));
    const cta = /emptyStateCta=\{\{[\s\S]*?\}\}/.exec(code);
    expect(cta, "emptyStateCta block").not.toBeNull();
    expect(cta![0]).toMatch(/NOTIFY_SIGNUP_URL/);
    expect(cta![0]).not.toMatch(/["']\/signup["']/);
  });

  it("nothing in the Notify code path reaches the settings tab or an email list", () => {
    for (const rel of ["src/hooks/useNotifyWhenWorkLands.ts", "src/lib/notifyWhenWorkLands.ts"]) {
      const code = blankComments(read(rel));
      expect(code, rel).not.toMatch(/tab=notifications/);
      expect(code, rel).not.toMatch(/email_list|mailing_list|waitlist|newsletter/i);
    }
    const lib = blankComments(read("src/lib/notifyWhenWorkLands.ts"));
    const tables = [...lib.matchAll(/\.from\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
    expect(tables).toEqual(["notification_preferences"]);
  });

  it("the signed-in save turns BOTH push switches on and proves a row was written", () => {
    expect(NOTIFY_PREF_PATCH).toEqual({ push_enabled: true, job_matches: true });
    const lib = blankComments(read("src/lib/notifyWhenWorkLands.ts"));
    expect(lib).toMatch(/onConflict:\s*"user_id"/);
    expect(lib).toMatch(/\.select\(\s*"user_id"\s*\)/);
    expect(lib).toMatch(/if \(error\) throw error/);
  });

  it("signed out: quick sign-up, back to the feed, with a reason the page words", () => {
    const u = new URL(NOTIFY_SIGNUP_URL, "https://x.test");
    expect(u.pathname).toBe("/signup");
    expect(u.searchParams.get("reason")).toBe("notify");
    expect(u.searchParams.get("redirect")).toBe("/jobs");
    expect(isNotifySignupReason(u.searchParams.get("reason"))).toBe(true);
    expect(isNotifySignupReason(null)).toBe(false);
    expect(isNotifySignupReason("other")).toBe(false);
    const signup = blankComments(read("src/pages/auth/Signup.tsx"));
    expect(signup).toMatch(/isNotifySignupReason\(searchParams\.get\("reason"\)\) \?/);
    expect(signup).toMatch(/subtitle: NOTIFY_SIGNUP_SUBTITLE/);
    expect(NOTIFY_SIGNUP_SUBTITLE).toMatch(/notified/i);
  });
});
