/**
 * Post a job in Spanish (UX-8 phase 1; Auditor 3 A3-3 part 2, 11-01): a member whose language is Spanish reads the
 * step bar, the step rail, each screen's question, the group grid and the Continue button in Spanish. English is
 * the old copy word for word, and the group tiles' English stays one list with jobCategoryGroups (GROUP_TILE_LABEL,
 * GROUP_EXAMPLES), which Edit profile's skill headings also read.
 *
 * @mutate src/components/postjob/JobCategoryGroups.tsx | {t(`postJob.group.${g.id}` as MsgKey)}</span> | {g.label}</span>
 * @mutate src/lib/jobCategoryGroups.ts | const GROUP_TILE_LABEL: Partial<Record<JobCategoryGroupId, string>> = { moving_errands: "Moving & errands" }; | const GROUP_TILE_LABEL: Partial<Record<JobCategoryGroupId, string>> = {};
 * @mutate src/components/postjob/JobCategoryGroups.tsx | placeholder={t("postJob.searchPlaceholder")} | placeholder="e.g. wash my driveway"
 * @mutate src/components/postjob/PostJobStepHeader.tsx |           {t("postJob.stepOf", { step, count: POST_JOB_STEP_COUNT })}\n |           {step} of {POST_JOB_STEP_COUNT}\n
 * @mutate src/components/postjob/PostJobStepRail.tsx |           const label = t(`postJob.rail.${key}` as MsgKey); |           const label = POST_JOB_SCREENS[i].rail;
 * @mutate src/pages/post-job/FormStep.tsx |   return t(`postJob.kindQ.${id}` as MsgKey); |   return `What kind of ${id} job?`;
 * @mutate src/pages/post-job/FormStep.tsx | question={t("postJob.detailsQ")} helper={t("postJob.detailsH")} | question="Tell us about it" helper="A few words and a photo help Helprs say yes."
 * @mutate src/pages/post-job/EntryChoice.tsx | <nav aria-label={t("postJob.otherWays")} | <nav aria-label="Other ways to start"
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enPostJob } from "@/lib/i18n/enPostJob";
import { JobCategoryGroups } from "@/components/postjob/JobCategoryGroups";
import { PostJobStepHeader } from "@/components/postjob/PostJobStepHeader";
import { PostJobStepRail } from "@/components/postjob/PostJobStepRail";
import { POST_JOB_SCREENS } from "@/components/postjob/postJobScreens";
import { GROUP_EXAMPLES_MAX, JOB_CATEGORY_GROUPS, groupTileLabel } from "@/lib/jobCategoryGroups";
import { blankComments } from "./helpers/blankNonCode";

// The "suggest a category" link under the grid reads a feature switch (React Query); it is not under test here.
vi.mock("@/components/SuggestCategory", () => ({ SuggestCategory: () => null }));

const grid = () => render(<JobCategoryGroups category="" setCategory={() => {}} group={null} setGroup={() => {}} onPicked={() => {}} />);
const tileTitles = () => Array.from(document.querySelectorAll("[data-tile-title]")).map((n) => n.textContent);

describe("Post a job in Spanish", () => {
  afterEach(() => {
    cleanup();
    __resetLangForTests();
  });

  describe("a Spanish-speaking member", () => {
    beforeEach(async () => {
      __resetLangForTests();
      setLang("es");
      await ensureLangLoaded();
    });

    it("the group grid: tile titles, examples, search box", () => {
      grid();
      expect(JOB_CATEGORY_GROUPS.length).toBeGreaterThan(5);
      expect(tileTitles()).toEqual(JOB_CATEGORY_GROUPS.map((g) => es[`postJob.group.${g.id}` as keyof typeof es]));
      expect(tileTitles()).not.toContain("Home");
      expect(screen.getByPlaceholderText(es["postJob.searchPlaceholder"])).toBeTruthy();
      expect(screen.getByText(es["postJob.groupEx.yard"])).toBeTruthy();
    });

    it("the step bar and the step header", () => {
      render(<PostJobStepHeader screen="details" question="q" helper="h" />);
      expect(screen.getByText(es["postJob.stepOf"].replace("{step}", "3").replace("{count}", String(POST_JOB_SCREENS.length)))).toBeTruthy();
      expect(screen.getByRole("progressbar").getAttribute("aria-label")).toBe(es["postJob.progress"]);
    });

    it("the computer's step rail", () => {
      render(<PostJobStepRail screen="price" />);
      const rail = screen.getByRole("navigation");
      expect(rail.getAttribute("aria-label")).toBe(es["postJob.steps"]);
      for (const { key } of POST_JOB_SCREENS) expect(rail.textContent).toContain(es[`postJob.rail.${key}` as keyof typeof es]);
      expect(rail.textContent).not.toContain("Details");
    });

    it("the Spanish tile examples fit the tile as the English must (GROUP_EXAMPLES_MAX)", () => {
      for (const g of JOB_CATEGORY_GROUPS) expect(es[`postJob.groupEx.${g.id}` as keyof typeof es].length, g.id).toBeLessThanOrEqual(GROUP_EXAMPLES_MAX);
    });
  });

  describe("English stays the old copy", () => {
    it("the grid's tiles and examples are jobCategoryGroups' words, word for word", () => {
      grid();
      expect(tileTitles()).toEqual(JOB_CATEGORY_GROUPS.map((g) => groupTileLabel(g)));
      for (const g of JOB_CATEGORY_GROUPS) {
        expect(enPostJob[`postJob.groupEx.${g.id}` as keyof typeof enPostJob]).toBe(g.examples);
        expect(enPostJob[`postJob.group.${g.id}` as keyof typeof enPostJob]).toBe(groupTileLabel(g));
      }
    });

    it("the rail words are POST_JOB_SCREENS' and the questions are unchanged", () => {
      for (const s of POST_JOB_SCREENS) expect(enPostJob[`postJob.rail.${s.key}` as keyof typeof enPostJob]).toBe(s.rail);
      render(<PostJobStepHeader screen="details" question="q" helper="h" />);
      expect(screen.getByText(`3 of ${POST_JOB_SCREENS.length}`)).toBeTruthy();
      expect(enPostJob["postJob.groupsQ"]).toBe("What do you need done?");
      expect(enPostJob["postJob.kindQ.yard"]).toBe("What kind of yard job?");
      expect(enPostJob["postJob.kindQ.pets"]).toBe("What kind of pets job?");
    });
  });

  it("the screens read their words through t(), not English literals", () => {
    const form = blankComments(readFileSync("src/pages/post-job/FormStep.tsx", "utf8"));
    const entry = blankComments(readFileSync("src/pages/post-job/EntryChoice.tsx", "utf8"));
    for (const lit of ['"What do you need done?"', '"Tell us about it"', '"When and where?"', '"Set a budget to continue"']) {
      expect(form, lit).not.toContain(lit);
    }
    // Screen 1b's question (groupQuestion) reads its words from t(), one key per group, all in Spanish too.
    const gq = form.match(/function groupQuestion\([^)]*\)[^{]*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(gq).toContain("t(`postJob.kindQ.${id}` as MsgKey)");
    expect(gq).not.toMatch(/What kind/);
    for (const g of JOB_CATEGORY_GROUPS) expect(es[`postJob.kindQ.${g.id}` as keyof typeof es], g.id).toMatch(/^¿/);
    for (const lit of ['"Use a template"', '"Hire a saved Helpr"', '"Describe it with AI"', '"Other ways to start"']) {
      expect(entry, lit).not.toContain(lit);
    }
  });
});
