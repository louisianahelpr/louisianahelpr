/**
 * CLASS GUARD (Q2709, 11-05; owner 10-31 "Nothing hand-made"): three profile chips that were hand-drawn <button>s
 * with inline colours are the shared Button:
 * - Earnings' 1099-K banner "Download tax statement" -> the small primary pill (44px, the olive primary surface).
 * - Two-step setup's copy-the-setup-key chip -> the outline Button that wraps (wrapSm), the key in mono, named for
 *   a screen reader ("Copy the setup key" / "Setup key copied").
 * - A rental calendar's "Remove calendar connection" trash -> the outline Button beside its "Sync now" twin, sienna ink.
 * - Edit profile's "I can help with" skill chips (11px words, hand-drawn) -> the shared ToggleChip (13px, aria-pressed).
 * - A pet's species (one of six) -> ChoicePill radios in a radiogroup named by "Species" (was aria-pressed toggles).
 * The per-file count in noNewHandMadeControls keeps hand-made ones from coming back; this pins which control.
 *
 * @mutate src/components/profile/earningsTab/ThresholdBanner.tsx | <Button type="button" variant="primary" size="sm" onClick={onOpenExport} | <Button type="button" onClick={onOpenExport}
 * @mutate src/components/profile/TwoFactorCard.tsx | aria-label={copied ? "Setup key copied" : "Copy the setup key"} | aria-label="key"
 * @mutate src/components/profile/TwoFactorCard.tsx | size="wrapSm"\n | size="sm"\n
 * @mutate src/pages/profile/strSettings/ConnectionCard.tsx | <Button\n          type="button"\n          size="sm"\n          variant="outline"\n          aria-label="Remove calendar connection" | <button\n          type="button"\n          aria-label="Remove calendar connection"
 * @mutate src/components/profile/ProfileEditForm.tsx | <ToggleChip\n                          key={value}\n                          pressed={active} | <ToggleChip\n                          key={value}\n                          pressed={false}
 * @mutate src/pages/profile/petProfiles/PetForm.tsx | <div role="radiogroup" aria-labelledby="pet-species-label" | <div
 * @mutate src/pages/profile/petProfiles/PetForm.tsx | selected={active}\n                    onClick={() => set("species", s.value)} | selected={false}\n                    onClick={() => set("species", s.value)}
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (f: string) => readFileSync(resolve(__dirname, "..", "..", f), "utf8");

describe("profile chips are the shared Button (Q2709)", () => {
  it("the 1099-K banner's download is the small primary Button", () => {
    expect(read("src/components/profile/earningsTab/ThresholdBanner.tsx")).toMatch(
      /<Button type="button" variant="primary" size="sm" onClick=\{onOpenExport\}[^>]*>\s*<FileText[^>]*\/>\s*Download tax statement\s*<\/Button>/,
    );
  });

  it("the setup-key copy chip is a wrapping outline Button with a name", () => {
    const src = read("src/components/profile/TwoFactorCard.tsx");
    expect(src).toMatch(/<Button\s+type="button"\s+variant="outline"\s+size="wrapSm"\s+aria-label=\{copied \? "Setup key copied" : "Copy the setup key"\}/);
    expect(src).not.toMatch(/<button\b/);
  });

  it("the calendar trash is the outline Button, like Sync now", () => {
    const src = read("src/pages/profile/strSettings/ConnectionCard.tsx");
    expect(src).toMatch(/<Button\s+type="button"\s+size="sm"\s+variant="outline"\s+aria-label="Remove calendar connection"/);
    expect(src).not.toMatch(/<button\b/);
  });

  it("Edit profile's skill chips are ToggleChip, pressed when picked", () => {
    const src = read("src/components/profile/ProfileEditForm.tsx");
    expect(src).toMatch(/<ToggleChip\s+key=\{value\}\s+pressed=\{active\}\s+onClick=\{\(\) => toggleSkillPreset\(label\)\}/);
    expect(src).not.toMatch(/<button\b/);
  });

  it("a pet's species is one ChoicePill radio of a named radiogroup", () => {
    const src = read("src/pages/profile/petProfiles/PetForm.tsx");
    expect(src).toMatch(/<p id="pet-species-label"[^>]*>Species<\/p>/);
    expect(src).toMatch(/<div role="radiogroup" aria-labelledby="pet-species-label"/);
    expect(src).toMatch(/<ChoicePill\s+key=\{s\.value\}\s+selected=\{active\}\s+onClick=\{\(\) => set\("species", s\.value\)\}/);
    expect(src).not.toMatch(/aria-pressed/);
  });
});
