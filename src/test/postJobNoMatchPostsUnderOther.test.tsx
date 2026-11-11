/**
 * F301 (whole-app audit 11-10, Post a job step 1 search): a search with no category match was a dead end ("No category
 * matches"). It now offers "Post it under Something else": a tap picks Other, starts the title as what was typed (cut
 * to TITLE_MAX) and goes on to Details. Both mounts (the entry screen and the form's screen 1) pass the form's setTitle.
 *
 * @mutate src/components/postjob/JobCategoryGroups.tsx |                       setTitle?.(typed); |
 * @mutate src/components/postjob/JobCategoryGroups.tsx |                       pick("other"); |
 * @mutate src/pages/post-job/EntryChoice.tsx |       setTitle={form.setTitle}\n      group={null} |       group={null}
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, fireEvent } from "@testing-library/react";
import { JobCategoryGroups } from "@/components/postjob/JobCategoryGroups";
import { TITLE_MAX } from "@/components/postjob/detailsSection/detailsSectionConstants";

vi.mock("@/components/SuggestCategory", () => ({ SuggestCategory: () => null }));

const setup = () => {
  const props = { category: "", setCategory: vi.fn(), group: null, setGroup: vi.fn(), onPicked: vi.fn(), setTitle: vi.fn() };
  render(<JobCategoryGroups {...props} />);
  return props;
};
const search = (q: string) => fireEvent.change(screen.getByRole("searchbox"), { target: { value: q } });

describe("F301: no search match offers Post it under Something else", () => {
  it("picks Other, fills the title with what was typed, and goes on", () => {
    const p = setup();
    search("  zzqx my odd job  ");
    expect(screen.getByText(/No category matches/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Post it under Something else" }));
    expect(p.setCategory).toHaveBeenCalledWith("other");
    expect(p.onPicked).toHaveBeenCalledTimes(1);
    expect(p.setTitle).toHaveBeenCalledWith("zzqx my odd job");
  });

  it("a long query is cut to the title limit", () => {
    const p = setup();
    search("q".repeat(TITLE_MAX + 10));
    fireEvent.click(screen.getByRole("button", { name: "Post it under Something else" }));
    expect(p.setTitle).toHaveBeenCalledWith("q".repeat(TITLE_MAX));
  });

  it("a match shows no such button", () => {
    setup();
    search("shelves");
    expect(screen.queryByRole("button", { name: "Post it under Something else" })).toBeNull();
  });

  it("both mounts pass the form's setTitle", () => {
    const mounts = ["src/pages/post-job/EntryChoice.tsx", "src/pages/post-job/FormStep.tsx"]
      .map((f) => readFileSync(f, "utf8"))
      .map((s) => s.slice(s.indexOf("<JobCategoryGroups")))
      .filter((s) => s.slice(0, s.indexOf("/>")).includes("setTitle={form.setTitle}"));
    expect(mounts.length).toBeGreaterThan(1);
  });
});
