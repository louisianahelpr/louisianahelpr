/**
 * Cowork design audit 2026-10-20, H4: an empty Jobs filter said "Nothing under
 * scheduled — but you have 14 in Needs You, 2 in Waiting…" under status boxes
 * that read "Upcoming", and restated every count those boxes already show.
 *
 * The class: every bucket's empty state (both tabs) names the bucket with the
 * status box's own word, never lower-cased into a sentence, never lists the
 * other buckets' counts; the jump button uses the box's word too.
 *
 * @mutate src/components/job-card/embeddedActivity.tsx |   return filters.map((f) => ({ ...f, label: words[f.key] ?? f.label })); |   return [...filters];
 * @mutate src/components/job-card/ActivityEmptyState.tsx |         : `Nothing in ${activeLabel} right now.`; |         : `Nothing under ${activeLabel.toLowerCase()} right now.`;
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ gate: (_: string, fn: () => void) => fn, gatedProps: () => ({}) }) }));

import { ActivityEmptyState } from "./ActivityEmptyState";
import { BOX_BUCKETS, boxLabelledFilters } from "./embeddedActivity";
import { POSTED_STATUS_FILTERS, APPLIED_STATUS_FILTERS } from "./activityFilters";
import { POSTED_GROUP_LABEL, WORKING_GROUP_LABEL } from "./ActivityBucketGroups";

const COUNTS = { needs_you: 14, waiting: 2, scheduled: 0, done: 22, cancelled: 136 };

describe("H4: an empty bucket speaks the status boxes' words", () => {
  for (const tab of ["posted", "applied"] as const) {
    const words: Record<string, string> = tab === "posted" ? POSTED_GROUP_LABEL : WORKING_GROUP_LABEL;
    const filters = boxLabelledFilters(tab, tab === "posted" ? POSTED_STATUS_FILTERS : APPLIED_STATUS_FILTERS);
    it(`${tab}: the filter labels are the box labels`, () => {
      expect(BOX_BUCKETS.length).toBeGreaterThan(2);
      for (const k of BOX_BUCKETS) expect(filters.find((f) => f.key === k)?.label).toBe(words[k]);
    });
    for (const bucket of BOX_BUCKETS) {
      it(`${tab} / ${bucket}: one plain sentence in the box's word, no restated counts`, () => {
        const { unmount } = render(
          <ActivityEmptyState
            tab={tab} loadError={false} postedJobsCount={174} appliedAppsCount={174} statusFilter={bucket} hasSearch={false}
            statusCounts={{ ...COUNTS, [bucket]: 0 }} statusLabels={filters} onRetry={() => {}} onNavigate={() => {}} onSelectStatusFilter={() => {}}
          />,
        );
        const text = document.body.textContent ?? "";
        expect(text).toContain(`Nothing in ${words[bucket]} right now.`);
        expect(text).not.toMatch(/but you have|\d+ in [A-Z]/);
        for (const b of screen.queryAllByRole("button")) {
          const m = /^Show (.+?) \(\d+\)$/.exec(b.textContent ?? "");
          if (m) expect(Object.values(words)).toContain(m[1]);
        }
        unmount();
      });
    }
  }
});
