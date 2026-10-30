/**
 * A PERSON'S NAME IS NOT THE THING THAT BREAKS (/profile?tab=reviews at 375).
 *
 * The old footer read `By Hallie H. · <job title>` as three flex children on
 * one non-wrapping row; at 375 a long title squeezed the name into a column
 * that broke across three lines ("By" / "Hallie" / "H."). Board 179 (second
 * slice) moved the reviewer to the TOP line: "<name> · <relation>" left, the
 * date right. The same rule holds there: the name is its own
 * `whitespace-nowrap` span (never broken), the who line is `min-w-0` (it
 * absorbs the squeeze, not the date), and the date is `shrink-0`. The job
 * title has a line of its own under the review, so it squeezes nothing.
 *
 * Asserted on the RENDERED DOM.
 *
 * @mutate src/components/profile/reviewsTab/reviewsAboutYou.tsx |           <span className="whitespace-nowrap">{row.name}</span> |           <span>{row.name}</span>
 * @mutate src/components/profile/reviewsTab/reviewsAboutYou.tsx |         <span className="shrink-0 font-sans text-ds-12" | <span className="font-sans text-ds-12"
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ReviewsTab } from "./ReviewsTab";

vi.mock("@/components/help/HelpEntry", () => ({ HelpEntry: () => null })); // Its top bar's Help needs the app's providers.
vi.mock("@/components/profile/reviewsTab/reviewsAboutYou", async (orig) => ({
  ...(await orig<object>()),
  useDeclutterReviewsAboutYou: () => ({ data: [], isLoading: false }),
}));

afterEach(cleanup);

const LONG_TITLE = "Deep clean the upstairs bathroom and replace the shower caddy";

function renderTab(over: Partial<{ reviewerName: string; jobTitle: string }> = {}) {
  return render(
    <MemoryRouter>
      <ReviewsTab
        reviews={[
          {
            rating: 5,
            feedback: "Great work.",
            created_at: "2026-09-07T12:00:00.000Z",
            reviewerName: over.reviewerName ?? "Hallie H.",
            jobTitle: over.jobTitle ?? LONG_TITLE,
            side: "helpr",
          },
        ]}
        loading={false}
        avgRating={5}
        reviewCount={1}
        onBack={() => {}}
      />
    </MemoryRouter>,
  );
}

const who = () => document.querySelector("[data-review-who]") as HTMLElement;

describe("the review's who line does not squeeze the reviewer's name", () => {
  it("names the reviewer and the side: Hallie H. · hired you", () => {
    renderTab();
    expect(who().textContent).toBe("Hallie H. · hired you");
  });

  it("the name is one unbreakable span, and the who line is what shrinks", () => {
    renderTab({ reviewerName: "Maximilian F." });
    const name = who().firstElementChild as HTMLElement;
    expect(name.textContent).toBe("Maximilian F.");
    expect(name.className).toMatch(/\bwhitespace-nowrap\b/);
    expect(who().className).toMatch(/\bmin-w-0\b/);
    const date = who().nextElementSibling as HTMLElement;
    expect(date.className).toMatch(/\bshrink-0\b/);
  });

  it("the job title sits on its own line, not beside the name", () => {
    renderTab();
    const title = screen.getByText(LONG_TITLE);
    expect(who().contains(title)).toBe(false);
  });
});

describe("the per-review stars come from the shared review card", () => {
  it("announces one rating rather than five unnamed glyphs", () => {
    renderTab();
    expect(screen.getByRole("img", { name: "5 of 5 stars" })).toBeInTheDocument();
  });
});
