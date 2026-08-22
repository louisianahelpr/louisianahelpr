// Pins the ONE source of truth for job categories. Every consumer that
// renders a category label or a category list must resolve the same label
// for the same value, in the same order — this file is the tripwire that
// stops the four copies from drifting apart again (they had: different
// order, "Storm prep" vs "Storm", and a filter-only "Events").
import { describe, it, expect } from "vitest";
import { Constants } from "@/integrations/supabase/types";
import {
  JOB_CATEGORIES,
  JOB_CATEGORY_LABELS,
  JOB_CATEGORY_VALUES,
  jobCategoryLabel,
} from "@/lib/jobCategories";
import {
  categoryLabels as activityLabels,
  categories as activityCategories,
} from "@/components/activity/activityConstants";
import { categoryLabels as mapLabels } from "@/components/browseMap/config";
import { categoryLabels as adminLabels } from "@/components/admin/adminJobs/types";
import { categories as postJobCategories } from "@/components/postjob/detailsSection/detailsSectionConstants";
import { categoryLabels as filterLabels } from "@/components/dashboard/JobFilters";
import { ALL_CATEGORIES } from "@/pages/jobs/jobsConstants";

const LABEL_CONSUMERS: Record<string, Record<string, string>> = {
  "activityConstants (feed cards, job detail, saved searches)": activityLabels,
  "browseMap/config (pin popup)": mapLabels,
  "adminJobs/types (admin job list)": adminLabels,
  "dashboard/JobFilters (browse filter chips)": filterLabels,
};

describe("job categories — single source of truth", () => {
  it("covers exactly the job_category DB enum", () => {
    expect([...JOB_CATEGORY_VALUES].sort()).toEqual(
      [...Constants.public.Enums.job_category].sort(),
    );
  });

  it("every label consumer resolves the same label for the same value", () => {
    for (const [name, table] of Object.entries(LABEL_CONSUMERS)) {
      for (const value of JOB_CATEGORY_VALUES) {
        expect(table[value], `${name} is missing a label for "${value}"`).toBe(
          JOB_CATEGORY_LABELS[value],
        );
      }
      expect(Object.keys(table).sort(), `${name} has extra categories`).toEqual(
        [...JOB_CATEGORY_VALUES].sort(),
      );
    }
  });

  it("storm_prep resolves to ONE string everywhere", () => {
    const seen = new Set(Object.values(LABEL_CONSUMERS).map((t) => t.storm_prep));
    expect([...seen]).toEqual(["Storm prep"]);
  });

  it("post-a-job offers exactly the categories the browse filter offers", () => {
    expect(postJobCategories.map((c) => c.value)).toEqual([...JOB_CATEGORY_VALUES]);
    expect(Object.keys(filterLabels)).toEqual([...JOB_CATEGORY_VALUES]);
  });

  it("every list consumer uses the canonical display order", () => {
    const canonical = [...JOB_CATEGORY_VALUES];
    expect(JOB_CATEGORIES.map((c) => c.value)).toEqual(canonical);
    expect(postJobCategories.map((c) => c.value)).toEqual(canonical);
    expect(activityCategories.map((c) => c.value)).toEqual(canonical);
    expect(Object.keys(activityLabels)).toEqual(canonical);
    expect(Object.keys(mapLabels)).toEqual(canonical);
    expect(ALL_CATEGORIES).toEqual(canonical);
    expect(canonical[canonical.length - 1]).toBe("other");
  });

  it("jobCategoryLabel falls back to the raw value for unknown input", () => {
    expect(jobCategoryLabel("storm_prep")).toBe("Storm prep");
    expect(jobCategoryLabel("not_a_category")).toBe("not_a_category");
  });
});
