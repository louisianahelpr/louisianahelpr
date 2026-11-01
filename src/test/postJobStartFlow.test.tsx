/**
 * Post a Job start, new look (owner 2026-10-21, mock-up ~/Desktop/helpr-postjob-flow-mockup.png):
 *   step 1 "What do you need done?": search, then exactly the 8 groups, no category panel (JA-41, owner
 *   pick 2026-11-01: this is the FIRST screen; template / saved Helpr / AI are small links under it);
 *   step 1b "<Group>": that group's categories; a tap is the choice and goes on to Details;
 *   no floating Continue on screen 1; no dock or "+" anywhere in the flow.
 * @mutate src/components/postjob/JobCategoryGroups.tsx |     setCategory(value);\n    onPicked(); |     setCategory(value);
 * @mutate src/components/postjob/JobCategoryGroups.tsx | onClick={() => (g.items.length === 1 ? pick(g.items[0].value) : setGroup(g.id))} | onClick={() => setGroup(g.id)}
 * @mutate src/pages/post-job/FormStep.tsx |         {page !== 1 && ( |         {true && (
 * @mutate src/components/mobileNav/mobileNavHelpers.ts | "/post-job", "/declutter/sell"]; | "/post-job"];
 * @mutate src/components/mobileNav/mobileNavHelpers.ts | "/admin", "/post-job", "/declutter/sell"]; | "/admin", "/declutter/sell"];
 * @mutate src/pages/post-job/usePostJobForm.ts |     if (step === "entry" && entryPanel) { |     if (false) {
 * @mutate src/components/postjob/JobCategoryGroups.tsx | tile(it.value, categoryEmoji(it.value), it.label, | tile(it.value, "", it.label,
 * @mutate src/lib/i18n/enPostJob.ts |   "postJob.group.moving_errands": "Moving & errands", |   "postJob.group.moving_errands": "Moving and errands",
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, fireEvent } from "@testing-library/react";
import { JobCategoryGroups } from "@/components/postjob/JobCategoryGroups";
import { noNavPages } from "@/components/mobileNav/mobileNavHelpers";
import { CATEGORY_EMOJI, GROUP_EMOJI } from "@/lib/categoryEmoji";
import { JOB_CATEGORY_LABELS } from "@/lib/jobCategories";
import { enPostJob } from "@/lib/i18n/enPostJob";

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
    expect(names).toEqual(["Home", "Yard", "Moving & errands", "Auto", "Pets", "Events", "Trades", "Something else"]);
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

  it("the first screen is the groups with three small start links; screen 1 has no floating button; the flow has no dock", () => {
    const entry = read("src/pages/post-job/EntryChoice.tsx");
    // A3-3 (Spanish): the links read t(); their English is unchanged (enPostJob.ts).
    for (const k of ["useTemplate", "hireSaved", "describeAi"]) expect(entry).toContain(`t("postJob.${k}")`);
    expect([enPostJob["postJob.useTemplate"], enPostJob["postJob.hireSaved"], enPostJob["postJob.describeAi"]]).toEqual(["Use a template", "Hire a saved Helpr", "Describe it with AI"]);
    expect(entry).not.toContain('"Start from scratch"');
    expect(entry).toContain('question={t("postJob.groupsQ")}');
    expect(enPostJob["postJob.groupsQ"]).toBe("What do you need done?");
    const step = read("src/pages/post-job/FormStep.tsx");
    expect(step).toContain("{page !== 1 && (");
    expect(step).toContain('question={t("postJob.groupsQ")}');
    expect(noNavPages).toContain("/post-job");
    // Owner: no bottom bar in flows; selling an item is a flow too (audit #45).
    expect(noNavPages).toContain("/declutter/sell");
    // Back from a way to start returns to the cards; back from 1b returns to the groups.
    const form = read("src/pages/post-job/usePostJobForm.ts");
    expect(form).toMatch(/if \(step === "entry" && entryPanel\) \{\s*\/\/[^\n]*\n\s*setEntryPanel\(null\);/);
    expect(form).toMatch(/else if \(step === "form" && formPage === 1 && categoryGroup\) \{\s*\/\/[^\n]*\n\s*setCategoryGroup\(null\);\s*if \(!skipEntry\) setStep\("entry"\);/);
  });

  it("emoji (owner 2026-10-21): one per category from one map, decorative and aria-hidden", () => {
    expect(Object.keys(CATEGORY_EMOJI).sort()).toEqual(Object.keys(JOB_CATEGORY_LABELS).sort());
    setup("home");
    const cleaning = screen.getByRole("button", { name: "Cleaning" });
    const glyph = cleaning.querySelector("[aria-hidden]");
    expect(glyph?.textContent).toBe(CATEGORY_EMOJI.cleaning);
  });

  it("group tiles carry the group emoji, and Moving reads 'Moving & errands' on its tile", () => {
    setup();
    const moving = screen.getByRole("button", { name: /^Moving & errands/ });
    expect(moving.querySelector("[aria-hidden]")?.textContent).toBe(GROUP_EMOJI.moving_errands);
    const entry = read("src/pages/post-job/EntryChoice.tsx");
    for (const k of ["templates", "offer", "ai"]) expect(entry).toContain(`START_EMOJI.${k}`);
  });
});
