/**
 * Design audit Area 04 (Jobs, Helpr side, 11-18): the Helpr's Jobs screens in Spanish and the Helpr-side copy fixes.
 *   #1 the job sheet's footer (Apply now, Applied, Licensed & insured only) reads the reader's language
 *   #2 the Filter jobs sheet's headings, rows, chips and footer button read the reader's language
 *   #3 Availability and Reviews read the reader's language
 *   #6 Reviews' empty state is true for a Helpr with jobs done ("People you work for can rate you after each job.")
 *   #7 before today's hours start, Availability says when they start (not "Ready until 5:00 PM")
 *   #11 the credential-gated Apply opens Licenses & insurance, in sentence case
 *
 * @mutate src/components/dashboard/filterSheet/jobFilterSections.tsx |       title: t("jh.f.sort"), |       title: "Sort",
 * @mutate src/components/dashboard/filterSheet/jobFilterSections.tsx |               label={t("jh.f.savedOnly")} |               label="Saved jobs only"
 * @mutate src/components/dashboard/filterSheet/FilterSheetFooter.tsx |     return wordInLang("jh.f.showN", `Show ${resultCount} jobs`, { n: resultCount }); |     return `Show ${resultCount} jobs`;
 * @mutate src/components/dashboard/JobFilters.tsx |         {wordInLang(`jh.f.sort.${opt.value}`, opt.label)} |         {opt.label}
 * @mutate src/components/dashboard/jobDetailDialog/JobDetailFooter.tsx | <span className="truncate">{wordInLang("jh.s.applyNow", "Apply now")}</span> | <span className="truncate">Apply now</span>
 * @mutate src/components/dashboard/jobDetailDialog/JobDetailFooter.tsx | onClick={() => navigate("/profile?tab=credentials")} | onClick={() => navigate("/profile")}
 * @mutate src/components/profile/ReviewsTab.tsx | body={wordInLang("jh.r.noneBody", "People you work for can rate you after each job.")} | body="Complete a job and your first review will show up here."
 * @mutate src/components/profile/AvailabilityTab.tsx |         return todaysHours.startLabel | return false
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enJobsHelpr } from "@/lib/i18n/enJobsHelpr";
import { esJobsHelpr } from "@/lib/i18n/esJobsHelpr";
import { buildJobFilterSections } from "@/components/dashboard/filterSheet/jobFilterSections";
import { FilterSheetFooter } from "@/components/dashboard/filterSheet/FilterSheetFooter";
import { SortContent } from "@/components/dashboard/JobFilters";
import { JobDetailFooter } from "@/components/dashboard/jobDetailDialog/JobDetailFooter";
import type { EnrichedJob } from "@/components/dashboard/types";
import { blankComments } from "./helpers/blankNonCode";

const noop = () => {};
const sections = () =>
  buildJobFilterSections({
    selectedCategory: null, setSelectedCategory: noop, sortBy: "smart", setSortBy: noop,
    setMinBudget: noop, setMaxBudget: noop, setJobWhen: noop, setLocationFilter: noop,
    boostedOnly: false, setBoostedOnly: noop, urgentOnly: false, setUrgentOnly: noop,
    onToggleSavedOnly: noop,
  } as unknown as Parameters<typeof buildJobFilterSections>[0]);

const job = (over: Record<string, unknown> = {}) =>
  ({ id: "job-1", title: "Fix the fence", budget: 100, customer_id: "poster", helper_id: null, offered_to_helper_id: null, credential_tier: 0, ...over }) as unknown as EnrichedJob;
const footer = (navigate = vi.fn(), j = job()) =>
  render(<JobDetailFooter job={j} guest={false} onApply={vi.fn()} navigate={navigate} viewerUserId="helpr" viewerAppPosition={null} viewerTier={0} onAskQuestion={vi.fn()} />);

const src = (p: string) => blankComments(readFileSync(p, "utf8"));

describe("Area 04: the Helpr's Jobs screens", () => {
  afterEach(() => {
    cleanup();
    __resetLangForTests();
  });

  it("every English word has its Spanish, and the dictionary is the size of the screens it serves", () => {
    const keys = Object.keys(enJobsHelpr);
    expect(keys.length).toBeGreaterThan(60); // inventory floor
    expect(Object.keys(esJobsHelpr).sort()).toEqual([...keys].sort());
    for (const k of keys) expect(es[k as keyof typeof es], k).toBeTruthy();
  });

  describe("in English (the old copy)", () => {
    it("the filter sheet's headings and footer read as before", () => {
      expect(sections().map((s) => s.title)).toEqual(["Sort", "Price", "Distance", "When", "Category", "Show only"]);
      render(<FilterSheetFooter activeFilterCount={1} onClearAll={noop} onDone={noop} resultCount={4} resultNoun={["job", "jobs"]} />);
      expect(screen.getByRole("button", { name: "Show 4 jobs" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Clear all" })).toBeTruthy();
    });

    it("#11: the credential gate is sentence case and opens Licenses & insurance", () => {
      const navigate = vi.fn();
      footer(navigate, job({ credential_tier: 1 }));
      fireEvent.click(screen.getByText("Licensed & insured only"));
      expect(navigate).toHaveBeenCalledWith("/profile?tab=credentials");
    });
  });

  describe("in Spanish", () => {
    beforeEach(async () => {
      __resetLangForTests();
      setLang("es");
      await ensureLangLoaded();
    });

    it("#2: the filter sheet's headings, chips and footer are Spanish", () => {
      expect(sections().map((s) => s.title)).toEqual(["Ordenar", "Precio", "Distancia", "Cuándo", "Categoría", "Mostrar solo"]);
      render(<SortContent sortBy="smart" setSortBy={noop} />);
      expect(screen.getByText(es["jh.f.sort.smart"])).toBeTruthy();
      cleanup();
      render(<FilterSheetFooter activeFilterCount={1} onClearAll={noop} onDone={noop} resultCount={4} resultNoun={["job", "jobs"]} />);
      expect(screen.getByRole("button", { name: "Ver 4 trabajos" })).toBeTruthy();
      expect(screen.getByRole("button", { name: es["jh.f.clearAll"] })).toBeTruthy();
    });

    it("#2: the Show only rows are Spanish", () => {
      const showOnly = sections().find((s) => s.key === "show-only")!;
      render(<>{showOnly.content}</>);
      expect(screen.getByText(es["jh.f.savedOnly"])).toBeTruthy();
      expect(screen.getByText(es["jh.f.boosted"])).toBeTruthy();
      expect(screen.getByText(es["jh.f.urgentHint"])).toBeTruthy();
    });

    it("#1: the job sheet's Apply button is Spanish", () => {
      footer();
      expect(screen.getByText(es["jh.s.applyNow"])).toBeTruthy();
      expect(screen.queryByText("Apply now")).toBeNull();
    });
  });

  it("#3/#6/#7: Availability and Reviews draw their words through the dictionary, with the fixed copy", () => {
    const reviews = src("src/components/profile/ReviewsTab.tsx");
    expect(reviews).toContain('body={wordInLang("jh.r.noneBody", "People you work for can rate you after each job.")}');
    expect(reviews).not.toContain("Complete a job and your first review");
    const avail = src("src/components/profile/AvailabilityTab.tsx");
    expect(avail).toContain("return todaysHours.startLabel");
    expect(avail).toContain('wordInLang("jh.a.startsAt", `Your hours today start at ${todaysHours.startLabel}`');
    expect(avail).not.toContain("your hours for today");
    expect(enJobsHelpr["jh.a.startsAt"]).toBe("Your hours today start at {time}");
  });
});
