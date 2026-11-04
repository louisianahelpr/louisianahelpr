/**
 * OWNER 11-02 (App Store 1.0.4, phone screenshots of Explore > Jobs > Browse and Explore > Declutter > Browse with
 * nothing to show): the two empty Browse screens did not match. Jobs had "+ Post a job" and a quiet bell link; Declutter
 * had "Sell something" (no +) and a big outlined pill, a two-line subline and a different headline shape.
 *
 * THE RULE. A section's nothing-at-all Browse draws its two ways out through ONE layout, EmptyStateActions: one green
 * pill with a leading "+", then one quiet text link with a leading icon. Headlines and sublines are parallel:
 * "No jobs near you yet." / "Nothing for sale near you yet."; "New jobs show up here as people post them." / "New
 * items show up here as people list them."
 *
 * Inventory: every file that draws a launched section's empty Browse (BrowseEmptyState in Jobs and Declutter Browse),
 * read from source; each one's nothing-at-all action goes through EmptyStateActions, and its action component holds no
 * hand-made pill or outlined button of its own.
 *
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |       <EmptyStateActions\n        primary={guest |       <BarkPillButtonList\n        primary={guest
 * @mutate src/components/ui/EmptyStateActions.tsx |   const plus = <Plus className="w-4 h-4 mr-1 shrink-0" aria-hidden />; |   const plus = null;
 * @mutate src/components/ui/EmptyStateActions.tsx |   const quiet = <SecondaryIcon className="w-4 h-4 mr-1 shrink-0" aria-hidden />; |   const quiet = null;
 * @mutate src/components/declutter/DeclutterBrowseView.tsx | : others.length === 0 ? "New items show up here as people list them." | : others.length === 0 ? "Be the first to sell something."
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Bell, Search } from "lucide-react";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ gate: (_k: string, fn: () => void) => fn, gatedProps: () => ({}) }) }));

import { EmptyStateActions } from "@/components/ui/EmptyStateActions";
import { EmptyFeedActions } from "@/components/dashboard/EmptyFeedActions";

const ROOT = resolve(__dirname, "../..");
const src = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));

/** The launched sections' Browse files and the component that draws each one's nothing-at-all actions. */
const SECTIONS: Record<string, { actions: string; file: string; title: string; body: string }> = {
  jobs: { file: "src/components/dashboard/BrowseTasksFeed.tsx", actions: "src/components/dashboard/EmptyFeedActions.tsx", title: "No jobs near you yet.", body: "New jobs show up here as people post them." },
  declutter: { file: "src/components/declutter/DeclutterBrowseView.tsx", actions: "src/components/declutter/DeclutterBrowseView.tsx", title: "Nothing for sale near you yet.", body: "New items show up here as people list them." },
};

/** The body of the function that draws the actions (EmptyFeedActions / NothingForSaleActions). */
function actionsBody(file: string): string {
  const s = src(file);
  const start = s.search(/function (EmptyFeedActions|NothingForSaleActions)\(/);
  expect(start, `${file}: its empty-state actions component`).toBeGreaterThan(-1);
  const next = s.indexOf("\nfunction ", start + 10);
  const nextExport = s.indexOf("\nexport ", start + 10);
  const end = Math.min(...[next, nextExport, s.length].filter((n) => n > start));
  return s.slice(start, end);
}

describe("the empty Browse screens share one layout (owner 11-02)", () => {
  it("reads both sections (floor)", () => {
    expect(Object.keys(SECTIONS).length).toBeGreaterThan(1);
    for (const { file } of Object.values(SECTIONS)) expect(src(file)).toMatch(/<BrowseEmptyState\b/);
  });

  it("each section's actions go through EmptyStateActions, with no pill or outlined button of their own", () => {
    for (const [name, { actions }] of Object.entries(SECTIONS)) {
      const body = actionsBody(actions);
      expect(body, name).toMatch(/<EmptyStateActions\b/);
      expect(body, name).not.toMatch(/<BarkPillButton\b|<Button\b/);
    }
  });

  it("parallel headline and one-line subline", () => {
    for (const [name, { file, title, body }] of Object.entries(SECTIONS)) {
      const s = src(file);
      expect(s, name).toContain(`"${title}"`);
      expect(s, name).toContain(`"${body}"`);
    }
  });

  it("the layout: one green pill with a leading +, then one quiet text link with a leading icon", () => {
    render(
      <MemoryRouter>
        <EmptyStateActions primary={{ label: "Sell something", to: "/declutter/sell?mode=choose" }}
          secondary={{ label: "Post what you're looking for", to: "/declutter?tab=wanted" }} secondaryIcon={Search} />
      </MemoryRouter>,
    );
    const primary = screen.getByRole("link", { name: "Sell something" });
    const secondary = screen.getByRole("link", { name: "Post what you're looking for" });
    // A leading icon in each, before the words.
    expect(primary.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    expect(secondary.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    // The pill is the primary (solid olive, btn-grad-primary); the link is not.
    expect(primary.className).toMatch(/btn-grad-primary|bg-primary/);
    expect(secondary.className).not.toMatch(/btn-grad-primary|bg-primary|border-input|\bborder\b/);
    // Pill first, link under it.
    expect(primary.compareDocumentPosition(secondary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("Jobs' actions draw the same layout: + Post a job, then the bell link", () => {
    render(<MemoryRouter><EmptyFeedActions onNotify={() => {}} /></MemoryRouter>);
    const post = screen.getByRole("button", { name: "Post a job" });
    const notify = screen.getByRole("button", { name: "Notify me when one lands" });
    expect(post.closest("[data-empty-actions]")).not.toBeNull();
    expect(notify.closest("[data-empty-actions]")).toBe(post.closest("[data-empty-actions]"));
    expect(post.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    expect(notify.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    void Bell;
  });
});
