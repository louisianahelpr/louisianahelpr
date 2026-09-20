/**
 * A PERSON'S NAME IS NOT THE THING THAT BREAKS.
 *
 * ─── THE DEFECT (owner-facing, /profile?tab=reviews at 375) ────────────────
 *
 * Each review's footer read `By Hallie H. · <job title>` as THREE flex
 * children on one non-wrapping row with no `min-w-0`:
 *
 *     <div className="flex items-center gap-2 …">
 *       <span>By <b>{reviewerName}</b></span>
 *       <span>·</span>
 *       <span>{jobTitle}</span>
 *     </div>
 *
 * With no `flex-wrap`, the row cannot take a second LINE, so it takes a second
 * COLUMN instead: the two text children shrink to their min-content widths and
 * the LONGER one wins the space. At 375 a real job title squeezed
 * "By Hallie H." into a narrow column that broke across three lines —
 * "By" / "Hallie" / "H." — beside a two-line title, with the "·" stranded
 * alone on its own line between them.
 *
 * ─── THE RULE THIS TEST HOLDS ──────────────────────────────────────────────
 *
 * Two independent properties, because either one alone still rags:
 *
 *   1. THE ROW MAY WRAP. `flex-wrap` + a row gap, so overflow becomes a second
 *      line rather than a narrower column.
 *   2. WHICH CHILD ABSORBS THE SQUEEZE IS DECLARED. The name is
 *      `whitespace-nowrap` (a person's name is never broken); the title is
 *      `min-w-0` and may wrap. Left to min-content, the browser picks, and it
 *      picked wrong.
 *
 * And one structural property that makes the orphan impossible rather than
 * unlikely: THE SEPARATOR IS NOT A FLEX CHILD. It lives inside the title, so
 * wherever the title goes its dot leads it. A row with three children can
 * always put the middle one alone on a line; a row with two cannot.
 *
 * Asserted on the RENDERED DOM, not on the source string, so moving the markup
 * around does not quietly retire the guard.
 */
import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ReviewsTab } from "./ReviewsTab";

afterEach(cleanup);

/** The real shape of the squeeze: a long title beside a short name. */
const LONG_TITLE = "Deep clean the upstairs bathroom and replace the shower caddy";

function renderTab(over: Partial<{ reviewerName: string; jobTitle: string }> = {}) {
  return render(
    // ProfileTabHeader renders a BackButton, which calls useNavigate().
    <MemoryRouter>
    <ReviewsTab
      reviews={[
        {
          rating: 5,
          feedback: "Great work.",
          created_at: "2026-09-07T12:00:00.000Z",
          reviewerName: over.reviewerName ?? "Hallie H.",
          jobTitle: over.jobTitle ?? LONG_TITLE,
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

/** The attribution row: the element that carries "By <name>". */
function attributionRow(): HTMLElement {
  const byText = screen.getByText(/^By$|^By\s/);
  const row = byText.closest("div");
  if (!row) throw new Error("the attribution line is not inside a row at all");
  return row as HTMLElement;
}

describe("the review attribution line does not squeeze the reviewer's name", () => {
  it("renders the line at all — the floor under every assertion below", () => {
    renderTab();
    const row = attributionRow();
    expect(row.textContent).toContain("Hallie H.");
    expect(row.textContent).toContain(LONG_TITLE);
    expect(row.textContent).toContain("·");
  });

  it("may take a second LINE rather than a second column", () => {
    renderTab();
    expect(
      attributionRow().className,
      "without flex-wrap the row narrows its children instead of wrapping",
    ).toMatch(/\bflex-wrap\b/);
  });

  it("declares which child absorbs the squeeze: the name never breaks, the title may", () => {
    renderTab();
    const row = attributionRow();
    const [name, title] = Array.from(row.children) as HTMLElement[];
    expect(name.textContent, "first child is not the name").toContain("Hallie H.");
    expect(
      name.className,
      "a person's name must not be broken across lines — whitespace-nowrap",
    ).toMatch(/\bwhitespace-nowrap\b/);
    expect(title.textContent, "second child is not the job title").toContain(LONG_TITLE);
    expect(
      title.className,
      "the title is the child that may wrap — min-w-0 lets it shrink and break",
    ).toMatch(/\bmin-w-0\b/);
  });

  it("the separator cannot be orphaned, because it is not a flex child", () => {
    renderTab();
    const row = attributionRow();
    // Exactly two children: name, then title-with-its-own-dot. A third child
    // is a middle element, and a middle element can be stranded on a line.
    expect(
      Array.from(row.children).length,
      "the '·' is its own flex child again — it can land on a line by itself",
    ).toBe(2);
    const title = row.children[1] as HTMLElement;
    expect(title.textContent?.trim().startsWith("·"), "the dot no longer leads the title").toBe(true);
    // Decorative: a screen reader reads "By Hallie H. <title>", not "middle dot".
    expect(title.querySelector('[aria-hidden="true"]')?.textContent).toBe("·");
  });

  it("holds for a long NAME too, not only a long title", () => {
    renderTab({ reviewerName: "Maximilian Featherstonehaugh III" });
    const [name] = Array.from(attributionRow().children) as HTMLElement[];
    expect(name.className).toMatch(/\bwhitespace-nowrap\b/);
  });
});

/**
 * The shared star row, adopted here at the same time: this tab hand-rolled its
 * own `Array.from({ length: 5 })` loop, which is the second thing
 * `reviewCard.tsx` exists to prevent (reviewCardOneDesign.test.tsx). It also
 * announced nothing — five unnamed images — where the shared row is a single
 * labelled `role="img"`.
 */
describe("the per-review stars come from the shared review card", () => {
  it("announces one rating rather than five unnamed glyphs", () => {
    renderTab();
    expect(screen.getByRole("img", { name: "5 of 5 stars" })).toBeInTheDocument();
  });
});
