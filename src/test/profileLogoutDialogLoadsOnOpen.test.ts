/**
 * speed7 (Builder 2): /profile's first download carried the Log out dialog. SignOutConfirmDialog pulls
 * BrandConfirmDialog, the dialog primitives and Radix's dialog stack (focus scope, scroll lock, dismissable layer).
 * Measured 2026-11-15 on built dists of main 8f98966a2f with and without (zlib gzip of each file Profile.js reaches by
 * static import): Profile's static chunk closure 325.7 KB gz with it, 309.6 KB gz and 9 fewer files without it. Those
 * bytes shared the phone link with the You landing's own chunks. cwv-lab 2026-11-15 (Slow 4G, 4x CPU, 375, helper
 * persona, 3 runs) /profile LCP: 4556 / 4480 / 4588 ms with the dialog lazy, against main's 4772 / 4888 / 4688,
 * 4692 / 4808 / 4696 and 4764 / 4580 / 4652.
 *
 * Held here (comments blanked): Profile.tsx imports the dialog only through lazy(), never statically, and mounts it
 * only once Log out has been pressed (then it stays mounted, so closing animates and a sign-out in flight keeps it).
 */
// @mutate src/pages/profile/Profile.tsx | const LogOutConfirmDialog = lazy(() => import("@/components/auth/SignOutConfirmDialog").then(m => ({ default: m.LogOutConfirmDialog }))); | import { LogOutConfirmDialog } from "@/components/auth/SignOutConfirmDialog";
// @mutate src/pages/profile/Profile.tsx |     {logoutDialogUsed && <Suspense fallback={null}> |     {<Suspense fallback={null}>
// @mutate src/pages/profile/Profile.tsx |   if (showLogoutDialog && !logoutDialogUsed) setLogoutDialogUsed(true); |
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const profile = blankComments(readFileSync(resolve(__dirname, "../pages/profile/Profile.tsx"), "utf8"));

describe("/profile loads the Log out dialog only when it is opened", () => {
  it("no static import of the dialog; one lazy() import", () => {
    expect(profile).not.toMatch(/^import [^;]*from "@\/components\/auth\/SignOutConfirmDialog";/m);
    const lazies = profile.match(/lazy\(\(\) => import\("@\/components\/auth\/SignOutConfirmDialog"\)/g) ?? [];
    expect(lazies.length).toBeGreaterThan(0);
    expect(lazies).toHaveLength(1);
  });

  it("mounted only once Log out has been pressed, and kept from then on", () => {
    // Design audit area 09 H1/L6: Profile draws the shared LogOutConfirmDialog (the same file, in the member's language).
    const at = profile.indexOf("<LogOutConfirmDialog");
    expect(at).toBeGreaterThan(0);
    expect(profile.slice(Math.max(0, at - 80), at)).toMatch(/\{logoutDialogUsed && <Suspense fallback=\{null\}>\s*$/);
    expect(profile).toMatch(/if \(showLogoutDialog && !logoutDialogUsed\) setLogoutDialogUsed\(true\);/);
    expect(profile).toMatch(/<LogOutConfirmDialog open=\{showLogoutDialog\} onOpenChange=\{setShowLogoutDialog\}/);
  });
});
