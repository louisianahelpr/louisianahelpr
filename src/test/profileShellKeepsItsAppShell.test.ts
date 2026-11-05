/**
 * ui-sweep #3491 (11-05): React #185 (maximum update depth) on the Profile LANDING in CI's empty-state sweep,
 * from 4ed18b97b7 on (the first sha with the Q806 Profile split de1fe3419e; last green 347cd6e7f2).
 *
 * Before the split, Profile's skeleton frame was inline JSX: the skeleton and the loaded page both returned
 * <AppShell> at the root, so React reconciled ONE AppShell across the swap. The split returned
 * <ProfileLoadingShell />, a different component type at the root, so the moment the landing settled React
 * unmounted the whole shell (header, nav, scroller) and mounted a new one. Profile now CALLS the shell
 * (ProfileLoadingShell has no hooks, so that is exactly the old inline JSX), which keeps the root an AppShell.
 *
 * @mutate src/pages/profile/Profile.tsx |     return ProfileLoadingShell({ tab, backFromTab }); |     return <ProfileLoadingShell tab={tab} backFromTab={backFromTab} />;
 * @mutate src/pages/profile/ProfileLoadingShell.tsx | export function ProfileLoadingShell({ tab, backFromTab }: { tab: Tab; backFromTab: () => void }) { | export function ProfileLoadingShell({ tab, backFromTab }: { tab: Tab; backFromTab: () => void }) { useScreenfulBelow();
 * @mutate src/pages/profile/ProfileLoadingShell.tsx |   return (\n    <AppShell | return (\n    <><AppShell
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "..", p), "utf8"));

describe("#3491: Profile keeps one AppShell across the skeleton -> page swap", () => {
  const profile = read("pages/profile/Profile.tsx");
  const shell = read("pages/profile/ProfileLoadingShell.tsx");

  it("Profile calls the loading shell; it never mounts it as its own component", () => {
    expect(profile).toMatch(/if \(showSkeleton\) \{\s*return ProfileLoadingShell\(\{ tab, backFromTab \}\);/);
    expect(profile).not.toMatch(/<ProfileLoadingShell\b/);
  });

  it("the shell has no hooks (calling it must equal inline JSX) and its root is AppShell, as the page's is", () => {
    const fn = shell.slice(shell.indexOf("export function ProfileLoadingShell"));
    expect(fn.length).toBeGreaterThan(200);
    expect(fn).not.toMatch(/\buse[A-Z]\w*\s*\(/);
    expect(fn).toMatch(/return \(\s*<AppShell\b/);
    // The loaded page's first root child is AppShell too (inside a keyless fragment, which React unwraps), so React
    // keeps the same AppShell across the swap, as it did before the split.
    const loaded = profile.slice(profile.indexOf("if (showSkeleton)"));
    expect(loaded).toMatch(/return \(\s*<>\s*<AppShell\b/);
  });
});
