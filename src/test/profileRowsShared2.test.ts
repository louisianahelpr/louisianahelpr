/**
 * CLASS GUARD (Q2709, 2026-11-05 night; owner 10-31 "Nothing hand-made"): six more profile controls that were
 * hand-made <button>s are the shared ones (src/components/ui), each keeping its size:
 * - "Try again" on a profile section that failed to load, and in Helpr Wrapped's "didn't load" sentence ->
 *   InlineTextButton (text-sized, the shared 44px touch overlay; the section one drops its own opacity press).
 * - Short-term rentals' "Add a calendar" toggle row -> flush ListRow (the card clips it; 44px floor, px-4 py-3.5).
 * - You menu rows, the profile Settings group rows and the Settings tab rows -> flush ListRow (each keeps its own
 *   floor and padding: 56px / py-3; the group rows drop their hand-made secondary hover for the shared tint).
 * Each file's hand-made button count fell by one in the same commit (docs/audit/hand-made-controls-baseline.json).
 *
 * @mutate src/components/profile/ProfileSectionError.tsx | <InlineTextButton\n        onClick={onRetry} | <button type="button"\n        onClick={onRetry}
 * @mutate src/pages/profile/HelprWrapped.tsx | <InlineTextButton\n                      onClick={() => void refetch()} | <button type="button"\n                      onClick={() => void refetch()}
 * @mutate src/pages/profile/StrSettings.tsx | className="min-h-11 justify-between" | className="justify-between"
 * @mutate src/components/profile/profileLanding/YouMenu.tsx | <ListRow\n            variant="flush"\n            key={row.key} | <ListRow\n            key={row.key}
 * @mutate src/components/profile/profileLanding/SettingsSection.tsx | <ListRow\n            variant="flush"\n            key={item.label} | <ListRow\n            key={item.label}
 * @mutate src/components/profile/SettingsTab.tsx | <ListRow variant="flush" data-settings-row={testId} | <ListRow data-settings-row={testId}
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const read = (f: string) => blankComments(readFileSync(resolve(__dirname, "..", "..", f), "utf8"));

describe("more profile rows and links are the shared controls (Q2709)", () => {
  it("the two Try again actions are InlineTextButtons", () => {
    const sec = read("src/components/profile/ProfileSectionError.tsx");
    expect(sec).toMatch(/<InlineTextButton\s+onClick=\{onRetry\}\s+className="shrink-0 inline-flex items-center gap-1 text-ds-11 font-semibold"/);
    expect(sec).not.toMatch(/<button\b/);
    const wr = read("src/pages/profile/HelprWrapped.tsx");
    expect(wr).toMatch(/<InlineTextButton\s+onClick=\{\(\) => void refetch\(\)\}\s+disabled=\{isFetching\}/);
    expect(wr).not.toMatch(/<button\b/);
  });

  it("Add a calendar is a flush ListRow at its old 44px floor", () => {
    const src = read("src/pages/profile/StrSettings.tsx");
    expect(src).toMatch(/<ListRow\s+variant="flush"\s+className="min-h-11 justify-between"\s+onClick=\{\(\) => setAddOpen/);
    expect(src).not.toMatch(/<button\b/);
  });

  it("You menu, Settings group and Settings tab rows are flush ListRows with their own floor", () => {
    const you = read("src/components/profile/profileLanding/YouMenu.tsx");
    expect(you).toMatch(/<ListRow\s+variant="flush"\s+key=\{row\.key\}[\s\S]{0,300}?className="glass-press relative min-h-\[56px\] gap-3\.5 py-3/);
    expect(you).not.toMatch(/<button\b/);
    const grp = read("src/components/profile/profileLanding/SettingsSection.tsx");
    expect(grp).toMatch(/<ListRow\s+variant="flush"\s+key=\{item\.label\}[\s\S]{0,300}?className="glass-press group\/row justify-between gap-4 pl-4 pr-3\.5 py-3/);
    expect(grp).not.toMatch(/<button\b|hover:bg-secondary/);
    const tab = read("src/components/profile/SettingsTab.tsx");
    expect(tab).toMatch(/<ListRow variant="flush" data-settings-row=\{testId\}/);
    expect(tab).toMatch(/const cls = "w-full min-h-\[56px\] flex items-center gap-3 px-4 py-3 text-left";/);
    expect(tab).not.toMatch(/<button\b/);
  });
});
