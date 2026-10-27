/**
 * EDIT PROFILE'S "I CAN HELP WITH" IS GROUPED UNDER POST A JOB'S CATEGORIES (owner, 2026-10-27: the flat
 * cloud of skill chips "should be the same top categories from the job posting").
 *
 * Before: 24 chips in one flat cloud (measured on prod as the poster test account: 10 rows at 375, 3 at 1440).
 * Now the chips sit under the SAME groups, in the same order, from the same list Post a job reads
 * (JOB_CATEGORY_GROUPS -> SKILL_GROUPS), each with a small heading; the free-text "Other (not listed above)"
 * sits under "Something else". The words on each chip are unchanged, because they are what profiles.skills
 * saves and what job matching reads.
 *
 * The CLASS, over the app's own category list (the generated job_category enum labels):
 *   - every skill belongs to exactly one group, and none is lost or added;
 *   - the groups are Post a job's groups, in its order, with its tile names;
 *   - every chip saves exactly the words it saved before (skillChipLabel).
 *
 * @mutate src/lib/jobCategoryGroups.ts |   skills: g.items.filter((it) => it.value !== "other").map | skills: g.items.filter((it) => it.value !== "other" && it.value !== "fencing").map
 * @mutate src/lib/jobCategoryGroups.ts |   skills: g.items.filter((it) => it.value !== "other").map((it) => ({ value: it.value, label: skillChipLabel(it.value) })), |   skills: g.items.filter((it) => it.value !== "other").map((it) => ({ value: it.value, label: it.label })),
 * @mutate src/lib/jobCategoryGroups.ts |   label: groupTileLabel(g), |   label: g.label,
 * @mutate src/components/profile/ProfileEditForm.tsx | {SKILL_GROUPS.map((g) => ( | {[{ id: "all", label: "Skills", skills: SKILL_PRESETS }].map((g) => (
 * @mutate src/components/profile/ProfileEditForm.tsx | {g.skills.length > 0 ? ( | {true ? (
 * @mutate src/components/profile/ProfileEditForm.tsx |                         onClick={() => toggleSkillPreset(label)} |                         onClick={() => toggleSkillPreset(value)}
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { JOB_CATEGORY_LABELS, JOB_CATEGORY_VALUES, skillChipLabel, type JobCategory } from "@/lib/jobCategories";
import { JOB_CATEGORY_GROUPS, SKILL_GROUPS, groupTileLabel } from "@/lib/jobCategoryGroups";

vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupPaused: () => false }));
vi.mock("@/hooks/useParishForZip", () => ({ useParishForZip: () => ({ parish: null, unknownZip: false }), UNKNOWN_ZIP_MESSAGE: "x" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/components/SuggestCategory", () => ({ SuggestCategory: () => null }));

import { ProfileEditForm } from "@/components/profile/ProfileEditForm";
import { JobCategoryGroups } from "@/components/postjob/JobCategoryGroups";
import type { Profile } from "@/components/profile/profileEditForm/types";

afterEach(cleanup);

/** Every skill a chip offers: every category but "other" (the free-text field). */
const SKILLS = JOB_CATEGORY_VALUES.filter((v) => v !== "other");

describe("every skill belongs to exactly one of Post a job's groups", () => {
  it("inventory: the app's own categories", () => {
    expect(SKILLS.length).toBeGreaterThan(20);
    expect(SKILLS.length).toBe(Object.keys(JOB_CATEGORY_LABELS).length - 1);
  });

  for (const v of SKILLS) {
    it(`${v} is in exactly one group`, () => {
      const homes = SKILL_GROUPS.filter((g) => g.skills.some((s) => s.value === v));
      expect(homes.map((g) => g.id)).toHaveLength(1);
    });
  }

  it("no skill is lost or added, and none is listed twice", () => {
    const listed = SKILL_GROUPS.flatMap((g) => g.skills.map((s) => s.value));
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...SKILLS].sort());
  });

  it("the groups are Post a job's groups, in its order, with the names its tiles print", () => {
    expect(SKILL_GROUPS.map((g) => g.id)).toEqual(JOB_CATEGORY_GROUPS.map((g) => g.id));
    render(<JobCategoryGroups category="" setCategory={vi.fn()} group={null} setGroup={vi.fn()} onPicked={vi.fn()} />);
    const tiles = [...screen.getByRole("region", { name: "Category groups" }).querySelectorAll("button")];
    expect(tiles.map((b) => b.querySelector("span.block")?.textContent)).toEqual(SKILL_GROUPS.map((g) => g.label));
    for (const g of JOB_CATEGORY_GROUPS) expect(SKILL_GROUPS.find((s) => s.id === g.id)?.label).toBe(groupTileLabel(g));
  });

  it("every chip saves the words it saved before (job matching reads them)", () => {
    for (const g of SKILL_GROUPS) for (const s of g.skills) expect(s.label, s.value).toBe(skillChipLabel(s.value as JobCategory));
    expect(SKILL_GROUPS.flatMap((g) => g.skills).find((s) => s.value === "moving")?.label).toBe("Moving help");
    expect(SKILL_GROUPS.flatMap((g) => g.skills).find((s) => s.value === "events")?.label).toBe("Event help");
  });
});

describe("the edit screen draws the groups", () => {
  const P = { user_id: "u-1", avatar_url: null, idv_status: null, stripe_payouts_enabled: false } as unknown as Profile;
  const props = (setSkills = vi.fn()) => ({
    profile: P,
    firstName: "Lexi", lastName: "Lombas",
    phone: "", setPhone: vi.fn(), location: "Delcambre", setLocation: vi.fn(), zipCode: "70528", setZipCode: vi.fn(),
    bio: "", setBio: vi.fn(), skills: "Cleaning", setSkills, initials: "LL",
    avatarUploading: false, saving: false, justSaved: false, onSave: vi.fn(), onAvatarUpload: vi.fn(), onBack: vi.fn(),
  });

  it("one headed group per category group, its chips under it, Other under Something else", () => {
    render(<MemoryRouter><ProfileEditForm {...props()} /></MemoryRouter>);
    const groups = SKILL_GROUPS.map((g) => screen.getByRole("group", { name: g.label }));
    expect(groups).toHaveLength(SKILL_GROUPS.length);
    groups.forEach((el, i) => {
      const g = SKILL_GROUPS[i];
      expect(el.querySelector("[data-skill-group-head]")?.textContent).toBe(g.label);
      const chips = within(el).queryAllByRole("button").map((b) => (b.textContent ?? "").trim());
      expect(chips, g.id).toEqual(g.skills.map((s) => s.label));
    });
    const other = screen.getByRole("group", { name: "Something else" });
    expect(within(other).getByLabelText("Other (not listed above)")).toBeTruthy();
    // Every chip on the screen is in a group.
    const all = screen.getAllByRole("button", { pressed: false }).concat(screen.getAllByRole("button", { pressed: true }));
    const inGroups = groups.flatMap((el) => within(el).queryAllByRole("button"));
    expect(all.filter((b) => b.hasAttribute("aria-pressed")).length).toBe(inGroups.length);
    expect(inGroups.length).toBe(SKILLS.length);
  });

  it("a tap saves the chip's own words, as before", () => {
    const setSkills = vi.fn();
    render(<MemoryRouter><ProfileEditForm {...props(setSkills)} /></MemoryRouter>);
    fireEvent.click(within(screen.getByRole("group", { name: "Moving & errands" })).getByRole("button", { name: "Moving help" }));
    expect(setSkills).toHaveBeenLastCalledWith("Cleaning, Moving help");
  });
});
