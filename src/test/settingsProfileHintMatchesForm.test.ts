/**
 * App audit 2026-10-29 (A3-C4): You > Settings > "Edit profile" promised
 * "Photo, name, about you", but Edit profile shows the name without a field to
 * change it. The hint under the row may name only what the form can edit.
 *
 * Inventory from source: each part of the row's `sub` (comma list) must map to
 * a field the edit form really renders (ProfileEditForm.tsx and its
 * profileEditForm/ sections, comments blanked). An unknown part fails, so a new
 * word in the hint needs a field behind it.
 */
// @mutate src/components/profile/SettingsTab.tsx | sub="Photo, about you, what you help with" | sub="Photo, name, about you"
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { readSource, walkSource } from "./helpers/walkSource";

const settings = blankComments(readSource("src/components/profile/SettingsTab.tsx") ?? "");
const form = ["src/components/profile/ProfileEditForm.tsx", ...walkSource(["src/components/profile/profileEditForm"])]
  .filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f))
  .map((f) => blankComments(readSource(f) ?? ""))
  .join("\n");

/** Each word the hint may use, and the field in the edit form that makes it true. */
const FIELD_FOR: Record<string, RegExp> = {
  photo: /type="file"[^>]*accept="image/,
  name: /<Input[^>]*\bid="(?:firstName|lastName|fullName|full_name)"/,
  "about you": /<Label htmlFor="bio"[^>]*>About you</,
  "what you help with": /<Label htmlFor="skills"[^>]*>I can help with</,
  area: /<Label htmlFor="location"[^>]*>Area</,
  phone: /<Label htmlFor="phone"[^>]*>Phone</,
};

describe("Settings' Edit profile hint names only what the form can edit (A3-C4)", () => {
  const sub = settings.match(/<Row testId="profile"[^>]*\bsub="([^"]+)"/)?.[1] ?? "";
  const parts = sub.split(/,\s*|\s+and\s+/).map((p) => p.trim().toLowerCase()).filter(Boolean);

  it("reads the row and the form (floor)", () => {
    expect(parts.length).toBeGreaterThan(1);
    expect(form.length).toBeGreaterThan(5000);
    // The photo and bio fields are found, so the matchers read real code.
    expect(FIELD_FOR.photo.test(form)).toBe(true);
    expect(FIELD_FOR["about you"].test(form)).toBe(true);
  });

  it("every part of the hint is a field the form renders", () => {
    const untrue = parts.filter((p) => !(p in FIELD_FOR) || !FIELD_FOR[p].test(form));
    expect(untrue, `hint "${sub}"`).toEqual([]);
  });
});
