/**
 * The job cards and the job page in Spanish (UX-8 phase 1; Auditor 3 A3-3 part 3, 11-01): a member whose language
 * is Spanish reads the Browse card's chips (Recommended, Urgent, Boosted, Today) and the job page's headings, states
 * and links in Spanish. English is the old copy word for word. Money and next-step sentences stay English (enJobs.ts).
 *
 * @mutate src/components/dashboard/JobCard.tsx | font-semibold whitespace-nowrap">{t("jobCard.recommended")}</span> | font-semibold whitespace-nowrap">Recommended</span>
 * @mutate src/components/dashboard/JobCard.tsx |                 {t("jobCard.urgent")}\n |                 Urgent\n
 * @mutate src/components/job-card/JobTodayChip.tsx |       {t("jobCard.today")}\n |       Today\n
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | className="text-ds-16 font-semibold">{t("jobPage.details")}</h2> | className="text-ds-16 font-semibold">Details</h2>
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | {detailsOpen ? t("jobPage.showLess") : t("jobPage.showMore")} | {detailsOpen ? "Show less" : "Show more"}
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | title={t("jobPage.unavailable")} | title="This job isn't available."
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { es } from "@/lib/i18n/es";
import { enJobs } from "@/lib/i18n/enJobs";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 0, useFirstPayoutFeeCents: () => 0 }));
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "idle" }));
vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn() }));

import JobCard from "@/components/dashboard/JobCard";
import { JobTodayChip } from "@/components/job-card/JobTodayChip";
import type { EnrichedJob } from "@/components/dashboard/types";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

function job(overrides: Partial<EnrichedJob> = {}): EnrichedJob {
  return {
    id: "job-1", title: "Mow the front yard", description: "Front and back.", category: "yard_work", budget: 60,
    location: "Lafayette, LA", parish: "Lafayette", date_needed: jobLocalDateISO(5), start_time: null,
    created_at: new Date("2026-09-19T12:00:00Z").toISOString(), expires_at: new Date("2026-12-03T12:00:00Z").toISOString(),
    customer_id: "poster-1", is_urgent: true, urgent_fee: 0, is_group_job: false, helpers_needed: 1, is_recurring: false,
    ...overrides,
  } as unknown as EnrichedJob;
}
const card = (j: EnrichedJob) =>
  render(<JobCard job={j} effectiveFee={0.15} onApply={vi.fn()} onReport={vi.fn()} onSelect={vi.fn()} recommended />);

const page = () => blankComments(readFileSync("src/pages/jobs/jobPage/JobPage.tsx", "utf8"));

describe("the job cards and the job page in Spanish", () => {
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

    it("the Browse card's chips are Spanish", () => {
      card(job());
      expect(screen.getByText(es["jobCard.recommended"])).toBeTruthy();
      expect(screen.getByText(es["jobCard.urgent"])).toBeTruthy();
      expect(screen.queryByText("Recommended")).toBeNull();
      expect(screen.queryByText("Urgent")).toBeNull();
    });

    it("the Today chip is Spanish", () => {
      render(<JobTodayChip className="c" />);
      expect(screen.getByText(es["jobCard.today"])).toBeTruthy();
    });
  });

  it("English: the card's chips are the old words", () => {
    card(job());
    expect(screen.getByText("Recommended")).toBeTruthy();
    expect(screen.getByText("Urgent")).toBeTruthy();
    expect([enJobs["jobPage.details"], enJobs["jobPage.showMore"], enJobs["jobPage.title"]]).toEqual(["Details", "Show more", "Job"]);
  });

  it("the job page reads its headings, states and links through t(), every key in both languages", () => {
    const src = page();
    const keys = [...src.matchAll(/\bt\("(jobPage\.[a-zA-Z]+)"\)/g)].map((m) => m[1]);
    expect(new Set(keys).size).toBeGreaterThan(12);
    for (const k of keys) {
      expect(enJobs[k as keyof typeof enJobs], k).toBeTruthy();
      expect(es[k as keyof typeof es], k).toBeTruthy();
    }
    for (const lit of ['>Details</h2>', '"Show more"', '"This job isn\'t available."', 'title="Job"', '"Loading job"', '"Photos from the job"']) {
      expect(src, lit).not.toContain(lit);
    }
  });
});
