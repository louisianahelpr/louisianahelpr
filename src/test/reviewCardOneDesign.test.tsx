/**
 * CLASS CHECK: this app has ONE review-card design.
 *
 * THE OWNER'S BUG (2026-09-19, looking at `/user/:id`): "the reviews should
 * show the persons name who posted it above the 5 stars. or like one word or
 * something they said in the review for the thing. then the review. this
 * review needs to be organized better. it should also be the category chip"
 *
 * THE CLASS BEHIND IT: two components rendered a public review, and they had
 * drifted into two different designs for the same three facts.
 * `components/profile/PublicReviewWall` drew the job category as a
 * rounded-full chip; `pages/userProfile/ReviewsSection` — the one actually
 * mounted on `/user/:id` — printed the very same value as
 * `For: {jobTitle}` in plain muted text with the reviewer's name jammed in
 * beside the stars. Nothing could have caught that, because no check had ever
 * been asked whether the two cards agreed.
 *
 * So this guard is not "ReviewsSection has a chip". It DERIVES the set of
 * review-card renderers from source and asserts every one of them gets its
 * chip and its star row from `components/profile/reviewCard.tsx`. A third
 * renderer that hand-rolls either one turns this red the day it is written.
 *
 * Verified live before any of it was believed (prod fncmgoasalhdgfwzhsqa,
 * 2026-09-19): `job_category` is populated for 17 of 17 reviews, so the chip
 * has something to render. The earlier note in PublicReviewWall about a
 * category lookup returning ZERO rows was about the client-side
 * `from("jobs")` fallback, not about the RPC the page actually uses.
 *
 * NOT COVERED, deliberately, and reported instead: `components/profile/
 * ReviewsTab.tsx` (the signed-in member's OWN reviews tab) renders no
 * category at all and uses a different star treatment. The owner named
 * `/user/:id`; widening to a screen they did not name would be guessing.
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { ReviewsSection } from "@/pages/userProfile/ReviewsSection";
import { splitReviewTags } from "@/components/profile/reviewCard";
import type { ProfileReview } from "@/pages/userProfile/types";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

afterEach(cleanup);

const REPO = join(__dirname, "..", "..");
const SRC = join(REPO, "src");
/** The one file allowed to define the shared parts. */
const SHARED = "src/components/profile/reviewCard.tsx";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

const ALL_TSX = walk(SRC).map((p) => ({
  file: relative(REPO, p).split("\\").join("/"),
  src: readFileSync(p, "utf8"),
}));

/**
 * THE INVENTORY, derived from the world rather than hand-listed: every
 * component that DISPLAYS one existing review — it reads the category off a
 * review object (`.jobCategory`, not a bare `jobCategory` prop, which is how
 * the review FORMs receive a job's category) and it paints that review's
 * stored `feedback`. Both PublicReviewWall and ReviewsSection qualify; a
 * future third one qualifies automatically, which is the whole point.
 *
 * `components/CompletionPrompts.tsx` is correctly excluded — it takes a
 * `jobCategory` prop and COLLECTS a review rather than rendering one. It does
 * hand-roll its own five-star input instead of using `reviewPanel/StarRow`;
 * that is a separate finding, reported, not swept into this guard.
 */
const RENDERERS = ALL_TSX.filter(
  (f) =>
    f.file !== SHARED &&
    /\.jobCategory\b/.test(f.src) &&
    /\.feedback\b/.test(f.src),
);

describe("ONE review-card design (owner, 2026-09-19)", () => {
  it("finds the review-card renderers by reading source, and there is more than one", () => {
    // FLOOR. An inventory that quietly became empty would make every
    // assertion below vacuously true — the exact failure this repo's
    // vacuity gate exists to refuse.
    expect(
      RENDERERS.map((f) => f.file).sort(),
      "no review-card renderers found — the detector, not the app, is broken",
    ).toEqual(
      ["src/components/profile/PublicReviewWall.tsx", "src/pages/userProfile/ReviewsSection.tsx"],
    );
    expect(RENDERERS.length).toBeGreaterThan(1);
  });

  it("every renderer takes its category chip and star row from the shared file", () => {
    for (const f of RENDERERS) {
      expect(f.src, `${f.file} must import the shared review-card parts`).toMatch(
        /from ["'](@\/components\/profile\/reviewCard|\.\/reviewCard)["']/,
      );
      expect(f.src, `${f.file} renders the category chip itself`).toContain("<ReviewCategoryChip");
      expect(f.src, `${f.file} renders the shared star row`).toContain("<ReviewStars");
    }
  });

  it("no renderer re-draws the chip or the star loop for itself", () => {
    // Scoped to the review cards. A JOB card's own category pill
    // (dashboard/JobDetailDialog) is a different object on a different
    // surface; conscripting it here would make this guard about pills rather
    // than about review cards, which is not the class the owner hit.
    for (const f of RENDERERS) {
      // The chip's signature: a rounded-full uppercase pill built out of
      // formatCategory. This is precisely the second copy ReviewsSection
      // would otherwise have grown.
      const hasChipStyling = /rounded-full[^"']*uppercase|uppercase[^"']*rounded-full/.test(f.src);
      expect(
        hasChipStyling && /formatCategory\(/.test(f.src),
        `${f.file} hand-rolls a category chip — import ReviewCategoryChip instead`,
      ).toBe(false);
      expect(
        /\[1, ?2, ?3, ?4, ?5\]\.map|Array\.from\(\{ ?length: ?5 ?\}\)/.test(f.src),
        `${f.file} hand-rolls a 5-star loop — import ReviewStars instead`,
      ).toBe(false);
    }
  });
});

/* ── The layout the owner asked for, rendered ─────────────────────────────── */

const review = (over: Partial<ProfileReview> = {}): ProfileReview => ({
  id: "rev-1",
  rating: 5,
  // Shaped exactly like a prod row: a one-tap tag comma-jammed onto the end
  // of the sentence by ReviewForm.toggleQuickOption.
  feedback: "Quick, careful, and came back for the pollen without fuss., On time",
  created_at: "2026-09-07T12:00:00.000Z",
  reviewerName: "Audit W.",
  // What useUserProfileData actually puts here on the live RPC path:
  // formatCategory(job_category). Not a job title.
  jobTitle: "Cleaning",
  jobCategory: "cleaning",
  response_text: null,
  response_at: null,
  ...over,
});

function renderSection(reviews: ProfileReview[]) {
  const noop = () => {};
  return render(
    <ReviewsSection
      reviews={reviews}
      isOwnProfile={false}
      profileFullName="Hallie H."
      reviewCategoryFilter={null}
      reviewRatingFilter="all"
      reviewVisibleCount={5}
      onSetReviewCategoryFilter={noop}
      onSetReviewRatingFilter={noop}
      onSetReviewVisibleCount={noop}
      onResetVisibleCount={noop}
      respondingToReview={null}
      responseText=""
      onSetResponseText={noop}
      onStartResponding={noop}
      onCancelResponding={noop}
      onSaveResponse={noop}
      savingResponse={false}
      reviewsHasMore={false}
      reviewsTotalCount={reviews.length}
      trueReviewCount={reviews.length}
      canReadReviewText
      loadMoreReviews={noop}
      loadingMoreReviews={false}
    />,
  );
}

/**
 * Find the review card WITHOUT depending on a testid this change introduced —
 * otherwise reverting the change makes these tests fail with "no such testid"
 * instead of with the layout complaint they exist to make, and a red that does
 * not name the defect is barely a guard at all.
 */
function reviewCard(): HTMLElement {
  const byTestId = screen.queryByTestId("profile-review-card");
  if (byTestId) return byTestId;
  const el = document.querySelector<HTMLElement>(".rounded-2xl.liquid-glass.p-5");
  if (!el) throw new Error("no review card rendered at all");
  return el;
}

describe("the /user/:id review card, top-down", () => {
  it("puts the reviewer's NAME above the stars, not beside them", () => {
    renderSection([review()]);
    const card = reviewCard();
    const kids = Array.from(card.children);
    const nameRow = kids.findIndex((el) => el.textContent?.includes("Audit W."));
    const starRow = kids.findIndex((el) => !!el.querySelector('[role="img"]'));
    expect(nameRow, "no row containing the reviewer's name").toBeGreaterThanOrEqual(0);
    expect(starRow, "no row containing the star rating").toBeGreaterThanOrEqual(0);
    expect(nameRow).toBeLessThan(starRow);
  });

  it("shows the category as the shared CHIP, never as 'For: …' prose", () => {
    renderSection([review()]);
    // The prose form goes first: it is the thing the owner pointed at, and it
    // must be what turns this red if the old markup ever comes back.
    expect(screen.queryByText(/^For: /), "the category is still plain 'For: …' prose").toBeNull();
    const chip = screen.getByTestId("public-review-category");
    expect(chip).toHaveTextContent("Cleaning");
    expect(chip.className).toContain("rounded-full");
  });

  it("lifts the one-tap tag out of the comment and shows it as the highlight", () => {
    renderSection([review()]);
    // Comma-jammed form first, for the same reason.
    expect(screen.queryByText(/, On time/), "the tag is still jammed into the comment").toBeNull();
    const chips = screen.getByTestId("review-tag-chips");
    expect(within(chips).getByText("On time")).toBeInTheDocument();
    // The prose keeps its own full stop and loses the jammed-on tag.
    expect(
      screen.getByText("Quick, careful, and came back for the pollen without fuss."),
    ).toBeInTheDocument();
  });

  it("orders name → stars+chip → highlight → review → date", () => {
    renderSection([review()]);
    const card = reviewCard();
    const rows = Array.from(card.children);
    const text = rows.map((el) => el.textContent ?? "");
    const at = (probe: string) => text.findIndex((t) => t.includes(probe));
    // `matches` as well as `querySelector`: the tag-chip row IS a direct child
    // of the card, and querySelector never matches the element it is called on.
    const rowWith = (sel: string) => rows.findIndex((el) => el.matches(sel) || !!el.querySelector(sel));
    const name = at("Audit W.");
    const chip = rowWith('[data-testid="public-review-category"]');
    const tag = rowWith('[data-testid="review-tag-chips"]');
    const prose = at("came back for the pollen");
    const date = at("Sep 7");
    expect([name, chip, tag, prose, date].every((n) => n >= 0), `missing row in ${text}`).toBe(true);
    expect(name).toBeLessThan(chip);
    expect(chip).toBeLessThan(tag);
    expect(tag).toBeLessThan(prose);
    expect(prose).toBeLessThan(date);
  });

  it("renders nothing extra when there is no category and no tag", () => {
    renderSection([review({ jobCategory: null, feedback: "Great work." })]);
    expect(screen.queryByTestId("public-review-category")).toBeNull();
    expect(screen.queryByTestId("review-tag-chips")).toBeNull();
    expect(screen.getByText("Great work.")).toBeInTheDocument();
  });
});

/* ── The wiring, so the card above is the card a visitor gets ─────────────── */

describe("the card is actually mounted on /user/:id with a category", () => {
  const page = readFileSync(join(SRC, "pages", "UserProfile.tsx"), "utf8");
  const hook = readFileSync(join(SRC, "pages", "userProfile", "useUserProfileData.ts"), "utf8");

  it("UserProfile mounts ReviewsSection and feeds it the hook's reviews", () => {
    expect(page).toMatch(/<ReviewsSection\b/);
    expect(page).toMatch(/reviews=\{[^}]*reviews[^}]*\}/);
  });

  it("the live RPC path populates jobCategory from job_category", () => {
    // Without this the chip renders for nobody, which is exactly how the
    // last attempt at a category chip died silently.
    expect(hook).toMatch(/jobCategory:\s*r\.job_category\s*\?\?\s*null/);
    expect(hook).toMatch(/get_public_profile_reviews/);
  });
});

/* ── splitReviewTags, the pure half ───────────────────────────────────────── */

describe("splitReviewTags", () => {
  it("peels a trailing known tag and returns the prose byte-identical", () => {
    expect(splitReviewTags("Great job., On time")).toEqual({
      prose: "Great job.",
      tags: ["On time"],
    });
  });

  it("peels several, in the order they were stored", () => {
    expect(splitReviewTags("Nice., On time, Quality work")).toEqual({
      prose: "Nice.",
      tags: ["On time", "Quality work"],
    });
  });

  it("handles a review that is nothing but tags", () => {
    expect(splitReviewTags("On time, Highly recommend")).toEqual({
      prose: null,
      tags: ["On time", "Highly recommend"],
    });
  });

  it("restores prose that itself contains ', ' without damage", () => {
    const prose = "Quick, careful, and thorough.";
    expect(splitReviewTags(`${prose}, On time`)).toEqual({ prose, tags: ["On time"] });
    expect(splitReviewTags(prose)).toEqual({ prose, tags: [] });
  });

  it("only peels from the END — a tag phrase mid-sentence is prose", () => {
    expect(splitReviewTags("On time, but the gate was left open.")).toEqual({
      prose: "On time, but the gate was left open.",
      tags: [],
    });
  });

  it("does not invent anything for null or empty feedback", () => {
    expect(splitReviewTags(null)).toEqual({ prose: null, tags: [] });
    expect(splitReviewTags("")).toEqual({ prose: null, tags: [] });
  });
});

// @mutate src/pages/userProfile/ReviewsSection.tsx | <ReviewCategoryChip category={r.jobCategory} /> | <p className="text-muted-foreground text-ds-11">For: {r.jobTitle}</p>
// @mutate src/components/profile/reviewCard.tsx | while (cut > 0 && ALL_QUICK_TAGS.includes(parts[cut - 1])) cut -= 1; |
