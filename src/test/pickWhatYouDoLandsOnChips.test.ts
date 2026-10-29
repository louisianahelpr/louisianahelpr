/**
 * App audit 2026-10-29 (A3-C11): Home's "Pick what you do" opened Edit profile
 * at the top, with the "I can help with" chips below the fold (measured at
 * 375: the chips card's top at 710px of an 812px screen, under the bottom
 * bar). It now opens SKILLS_FOCUS_PATH, and Edit profile scrolls the chips card
 * into view on ?focus=skills (after: top at 16px).
 */
// @mutate src/pages/home/homeDashboard/FirstJobHome.tsx | done: !!skills, go: () => navigate(SKILLS_FOCUS_PATH) }, | done: !!skills, go: () => navigate("/profile?tab=profile") },
// @mutate src/components/profile/ProfileEditForm.tsx |     requestAnimationFrame(() => skillsCardRef.current?.scrollIntoView({ block: "start" })); |     void 0;
// @mutate src/components/profile/ProfileEditForm.tsx |         <div ref={skillsCardRef} data-skills-card | <div data-skills-card
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { readSource } from "./helpers/walkSource";
import { SKILLS_FOCUS_PATH } from "@/pages/home/homeDashboard/FirstJobHome";

const home = blankComments(readSource("src/pages/home/homeDashboard/FirstJobHome.tsx") ?? "");
const form = blankComments(readSource("src/components/profile/ProfileEditForm.tsx") ?? "");

describe('"Pick what you do" lands on the "I can help with" chips (A3-C11)', () => {
  it("the path opens Edit profile with focus=skills", () => {
    const u = new URL(SKILLS_FOCUS_PATH, "https://x.test");
    expect(u.pathname).toBe("/profile");
    expect(u.searchParams.get("tab")).toBe("profile");
    expect(u.searchParams.get("focus")).toBe("skills");
  });

  it("the Home checklist's skills step opens that path", () => {
    const step = home.match(/\{ key: "skills",[^\n]*\}/)?.[0] ?? "";
    expect(step.length).toBeGreaterThan(40);
    expect(step).toContain("go: () => navigate(SKILLS_FOCUS_PATH)");
  });

  it("Edit profile scrolls the card holding the I can help with chips into view on focus=skills", () => {
    expect(form).toMatch(/searchParams\.get\("focus"\) === "skills"/);
    expect(form).toMatch(/skillsCardRef\.current\?\.scrollIntoView\(/);
    // The ref sits on the card whose label is "I can help with" (the next few lines).
    const at = form.indexOf("ref={skillsCardRef}");
    expect(at).toBeGreaterThan(0);
    expect(form.slice(at, at + 400)).toMatch(/<Label htmlFor="skills"[^>]*>I can help with</);
  });
});
