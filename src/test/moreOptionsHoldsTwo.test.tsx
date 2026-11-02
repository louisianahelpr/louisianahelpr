/**
 * "IF MORE OPTIONS DOESN'T ACTUALLY HAVE MORE OPTIONS, IT'S NOT NEEDED" (owner 2026-11-01).
 * The job page's row (JobPageActionRow) draws "More options" ONLY when it holds 2 or more real items; exactly one is
 * its own visible button, none means no menu. Walked over every shape a stage can hand the row: a step or Message
 * leading or nothing leading, 0 to 4 page actions and 0 to 3 card actions. The menu is opened and its real items
 * counted. The cards' own More is walked over every stage fixture in src/components/job-card/jobStepOneRow.test.tsx
 * (counted from what the opened menu draws).
 *
 * @mutate src/pages/jobs/jobPage/JobPageActionRow.tsx |   const second = others === 0 |   const second = others === -1
 * @mutate src/pages/jobs/jobPage/JobPageActionRow.tsx |     : others === 1 |     : others === -1
 * @mutate src/pages/user/ReviewsSection.tsx |                   Report\n                </Button> |                   <MoreHorizontal aria-hidden />\n                </Button>
 *
 * The same rule off the job screens: a public review's ⋯ held ONE action (Report this review), so it is a visible
 * "Report" text button (lead 11-01, the owner's rule app-wide). It took the review's slot in iconCompactButton.test.ts.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JobPageActionRow, type RowAction } from "@/pages/jobs/jobPage/JobPageActionRow";
import { blankComments } from "@/test/helpers/blankNonCode";

const act = (k: string): RowAction => ({ key: k, label: `Action ${k}`, go: () => {} });

afterEach(cleanup);

describe("More options holds 2 or more, or is not drawn (owner 11-01)", () => {
  it("every stage shape: a menu only with 2+ items; one item is its own visible button", () => {
    let walked = 0;
    for (const lead of [null, { key: "step", label: "Approve and release", go: () => {} }]) {
      for (let pageN = 0; pageN <= 4; pageN++) {
        for (let cardN = 0; cardN <= 3; cardN++) {
          const extras = Array.from({ length: pageN }, (_, i) => act(String(i)));
          render(<JobPageActionRow tag="t" lead={lead} leadIsStep extras={extras} cardCount={cardN} />);
          // Without a lead the first action takes the lead's place, so it is not a menu item.
          const items = pageN + cardN - (lead ? 0 : Math.min(pageN, 1));
          const more = document.querySelector("[data-row-more]") as HTMLElement | null;
          const where = `lead=${!!lead} page=${pageN} card=${cardN}`;
          if (items >= 2) {
            expect(more, `${where}: ${items} items and no More options`).toBeTruthy();
            fireEvent.click(more!);
            const sheet = document.querySelector("[data-row-options]") as HTMLElement;
            const drawn = within(sheet).queryAllByRole("button", { name: /^Action / }).length;
            // The card's actions portal into the sheet from the hidden card (not mounted here): the page's own are counted.
            expect(drawn + cardN, `${where}: the menu draws ${drawn + cardN} items`).toBeGreaterThanOrEqual(2);
          } else {
            expect(more, `${where}: More options with ${items} item(s)`).toBeNull();
            if (items === 1 && pageN > (lead ? 0 : 1)) expect(screen.getByRole("button", { name: `Action ${pageN - 1}` })).toBeTruthy();
          }
          walked++;
          cleanup();
        }
      }
    }
    expect(walked).toBeGreaterThan(30);
  });

  it("a review's one action (Report) is a visible text button, never a ⋯ icon", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../pages/user/ReviewsSection.tsx"), "utf8"));
    const at = src.indexOf('aria-label="Report this review"');
    expect(at).toBeGreaterThan(-1);
    const button = src.slice(src.lastIndexOf("<Button", at), src.indexOf("</Button>", at));
    expect(button.length).toBeGreaterThan(40);
    expect(button).toMatch(/>\s*Report\s*$/);
    expect(src).not.toMatch(/MoreHorizontal|MoreVertical/);
  });
});
