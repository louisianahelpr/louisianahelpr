/**
 * Design audit area 04 (Jobs, Helpr side), pass 2, 11-18 (~/.lh-shots/design-audit-areas/04-jobs-helpr/FINDINGS.md).
 * UI and copy only. One case per finding fixed here.
 *
 * @mutate src/components/dashboard/browseTasksToolbar/BrowseTasksActions.tsx | return Math.max(0, filters.activeFilterCount - (filters.searchQuery ? 1 : 0)); | return filters.activeFilterCount;
 * @mutate src/components/job-card/PaymentHeldDialog.tsx | state: confirmIsOpen(who?.dateNeeded) ? "now" : "later", | state: "now",
 * @mutate src/components/job-card/PaymentHeldDialog.tsx | return now.getTime() >= confirmOpensMs(dateNeeded); | return true;
 * @mutate src/lib/jobCategoryGroups.ts | moving_errands: "Moving & errands", | moving_errands: "Moving and errands",
 * @mutate src/pages/profile/types.ts |   credentials: "Licenses & insurance", |   credentials: "Licensed & Insured",
 * @mutate src/components/refund/RefundAnswerDialog.tsx | or our team decides. | or it goes to Helpr to decide.
 * @mutate src/pages/jobs/appliedJobCard/HelperPendingActions.tsx |                   tone="quiet" |                   tone="neutral"
 * @mutate src/components/browseMap/MapLayers.tsx |       Shaded areas show where jobs are waiting |       Shaded circles: parishes busy right now
 * @mutate src/pages/home/Dashboard.tsx |                     onShowList={() => setView("list")} | onShowList={undefined}
 * @mutate src/pages/profile/WorkRecord.tsx |             {idCheckOn && !data.identityVerified && ( |             {false && (
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "@/test/helpers/blankNonCode";
import { sheetFilterCount } from "@/components/dashboard/browseTasksToolbar/BrowseTasksActions";
import { confirmIsOpen } from "@/components/job-card/PaymentHeldDialog";
import { JOB_CATEGORY_GROUPS, groupTileLabel } from "@/lib/jobCategoryGroups";
import { TAB_TITLES } from "@/pages/profile/types";

const code = (rel: string) => blankComments(readFileSync(join(process.cwd(), rel), "utf8"));

describe("area 04 Jobs Helpr, pass 2", () => {
  it("#26: a typed search does not light a count on Filters; sheet filters still do", () => {
    expect(sheetFilterCount({ activeFilterCount: 1, searchQuery: "lawn" })).toBe(0);
    expect(sheetFilterCount({ activeFilterCount: 3, searchQuery: "lawn" })).toBe(2);
    expect(sheetFilterCount({ activeFilterCount: 2, searchQuery: "" })).toBe(2);
    expect(sheetFilterCount({ activeFilterCount: 0, searchQuery: null })).toBe(0);
    const src = code("src/components/dashboard/browseTasksToolbar/BrowseTasksActions.tsx");
    const button = src.slice(src.indexOf("export function BrowseFiltersButton"));
    expect(button).toContain("const count = sheetFilterCount(filters);");
    expect(button.slice(0, button.indexOf("</Button>"))).not.toContain("filters.activeFilterCount");
  });

  it("#29: the You're hired sheet says Now on Confirm only once the confirm is open", () => {
    // confirmOpensMs("2026-11-20") is Nov 19, 00:00 Central (06:00 UTC).
    expect(confirmIsOpen("2026-11-20", new Date("2026-11-17T18:00:00Z"))).toBe(false);
    expect(confirmIsOpen("2026-11-20", new Date("2026-11-19T06:00:00Z"))).toBe(true);
    expect(confirmIsOpen(null, new Date("2026-11-17T18:00:00Z"))).toBe(true);
    expect(code("src/components/job-card/PaymentHeldDialog.tsx")).toContain('state: confirmIsOpen(who?.dateNeeded) ? "now" : "later",');
  });

  it("#27: Moving & errands, one name with an ampersand", () => {
    const g = JOB_CATEGORY_GROUPS.find((x) => x.id === "moving_errands");
    expect(g).toBeTruthy();
    expect(g!.label).toBe("Moving & errands");
    expect(groupTileLabel(g!)).toContain("&");
  });

  it("#33: short page titles that fit one line at 390", () => {
    expect(TAB_TITLES.reviews).toBe("Reviews");
    expect(TAB_TITLES.credentials).toBe("Licenses & insurance");
  });

  it("#15 (UI part): the refund answer lines say our team decides, never 'goes to Helpr'", () => {
    for (const f of ["src/components/refund/RefundAnswerDialog.tsx", "src/components/refund/RefundRequestPanel.tsx"]) {
      const src = code(f);
      expect(src).not.toMatch(/goes\s+to\s+Helpr/);
      expect(src).toMatch(/our\s+team\s+decides/);
    }
  });

  it("#25: one control edits the application, and Edit wears Withdraw's outline style", () => {
    expect(code("src/pages/jobs/appliedJobCard/PendingApplicationSection.tsx")).not.toContain("Edit your message");
    const actions = code("src/pages/jobs/appliedJobCard/HelperPendingActions.tsx");
    const edit = actions.slice(actions.indexOf('label="Edit application"'));
    expect(edit.slice(0, 200)).toContain('tone="quiet"');
  });

  it("#9: the map key says what the shading means, and the map has its own way back to the list", () => {
    expect(code("src/components/browseMap/MapLayers.tsx")).toContain("Shaded areas show where jobs are waiting");
    const feed = code("src/components/dashboard/BrowseTasksFeed.tsx");
    // The pill moved to MapShowListPill.tsx in the 11-18 train (BrowseTasksFeed stays under the 600-line ratchet).
    expect(feed).toContain("{onShowList && <MapShowListPill onClick={onShowList} />}");
    const pill = code("src/components/dashboard/MapShowListPill.tsx");
    expect(pill).toContain('data-testid="browse-map-show-list"');
    expect(pill).toContain("onClick={onClick}");
    expect(code("src/pages/home/Dashboard.tsx")).toContain('onShowList={() => setView("list")}');
  });

  it("#13: Not verified says how it changes, on screen only, while the ID check is on", () => {
    const src = code("src/pages/profile/WorkRecord.tsx");
    const i = src.indexOf("{idCheckOn && !data.identityVerified && (");
    expect(i).toBeGreaterThan(0);
    const block = src.slice(i, i + 600);
    expect(block).toContain("data-print-hide");
    expect(block).toMatch(/first hired or at your first payout/);
    expect(src).toContain("const idCheckOn = useIdentityCheckOnStore();");
  });

  it("inventory floor: every case above reads a real file", () => {
    const files = [
      "src/components/dashboard/browseTasksToolbar/BrowseTasksActions.tsx",
      "src/components/job-card/PaymentHeldDialog.tsx",
      "src/pages/profile/WorkRecord.tsx",
      "src/components/dashboard/BrowseTasksFeed.tsx",
    ];
    expect(files.map((f) => code(f).length).filter((n) => n > 500).length).toBeGreaterThan(3);
  });
});
