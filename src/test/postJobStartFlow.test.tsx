/**
 * Post a Job start, new look (owner 2026-10-21, mock-up ~/Desktop/helpr-postjob-flow-mockup.png):
 *   step 0 "How do you want to start?": four cards;
 *   step 1 "What do you need done?": search, then exactly the 8 groups, no category panel;
 *   step 1b "<Group>": that group's categories; a tap is the choice and goes on to Details;
 *   no floating Continue on screen 1; no dock or "+" anywhere in the flow.
 * @mutate src/components/postjob/JobCategoryGroups.tsx |     setCategory(value);\n    onPicked(); |     setCategory(value);
 * @mutate src/components/postjob/JobCategoryGroups.tsx | () => (g.items.length === 1 ? pick(g.items[0].value) : setGroup(g.id)), | () => setGroup(g.id),
 * @mutate src/pages/post-job/FormStep.tsx |         {page !== 1 && ( |         {true && (
 * @mutate src/components/mobileNav/mobileNavHelpers.ts | "/admin", "/post-job"]; | "/admin"];
 * @mutate src/pages/post-job/usePostJobForm.ts |     if (step === "entry" && entryPanel) { |     if (false) {
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, fireEvent } from "@testing-library/react";
import { JobCategoryGroups } from "@/components/postjob/JobCategoryGroups";
import { noNavPages } from "@/components/mobileNav/mobileNavHelpers";

vi.mock("@/components/SuggestCategory", () => ({ SuggestCategory: () => null }));

const read = (f: string) => readFileSync(f, "utf8");
const setup = (group: Parameters<typeof JobCategoryGroups>[0]["group"] = null) => {
  const props = { category: "", setCategory: vi.fn(), group, setGroup: vi.fn(), onPicked: vi.fn() };
  render(<JobCategoryGroups {...props} />);
  return props;
};

describe("Post a Job start (owner 2026-10-21)", () => {
  it("step 1 shows exactly the 8 groups and no category list", () => {
    setup();
    const groups = screen.getByRole("region", { name: "Category groups" });
    const names = [...groups.querySelectorAll("button")].map((b) => b.querySelector("span.block")?.textContent);
    expect(names).toEqual(["Home", "Yard", "Moving and errands", "Auto", "Pets", "Events", "Trades", "Something else"]);
    expect(screen.queryByRole("button", { name: "Cleaning", exact: true } as never)).toBeNull();
  });

  it("a group opens its categories (1b); a one-category group is that category and goes straight on", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: /^Home/ }));
    expect(p.setGroup).toHaveBeenCalledWith("home");
    expect(p.onPicked).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^Something else/ }));
    expect(p.setCategory).toHaveBeenCalledWith("other");
    expect(p.onPicked).toHaveBeenCalledTimes(1);
  });

  it("1b: a category tap is the choice and goes on", () => {
    const p = setup("home");
    expect(screen.queryByRole("region", { name: "Category groups" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Cleaning/ }));
    expect(p.setCategory).toHaveBeenCalledWith("cleaning");
    expect(p.onPicked).toHaveBeenCalledTimes(1);
  });

  it("search jumps to a matching category, and its tap goes on", () => {
    const p = setup();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "wash my driveway" } });
    fireEvent.click(screen.getByRole("button", { name: /^Pressure washing/ }));
    expect(p.setCategory).toHaveBeenCalledWith("pressure_washing");
    expect(p.onPicked).toHaveBeenCalledTimes(1);
  });

  it("step 0 is four sentence-case cards; screen 1 has no floating button; the flow has no dock", () => {
    const entry = read("src/pages/post-job/EntryChoice.tsx");
    for (const t of ['"Start from scratch"', '"Use a template"', '"Offer to a saved Helpr"', '"Get help from AI"']) expect(entry).toContain(t);
    expect(entry).toContain('question="How do you want to start?"');
    const step = read("src/pages/post-job/FormStep.tsx");
    expect(step).toContain("{page !== 1 && (");
    expect(step).toContain('question="What do you need done?"');
    expect(noNavPages).toContain("/post-job");
    // Back from a way to start returns to the cards; back from 1b returns to the groups.
    const form = read("src/pages/post-job/usePostJobForm.ts");
    expect(form).toMatch(/if \(step === "entry" && entryPanel\) \{\s*\/\/[^\n]*\n\s*setEntryPanel\(null\);/);
    expect(form).toMatch(/else if \(step === "form" && formPage === 1 && categoryGroup\) \{\s*\/\/[^\n]*\n\s*setCategoryGroup\(null\);/);
  });
});
