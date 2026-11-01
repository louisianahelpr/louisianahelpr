/**
 * JA-41 (owner pick, 2026-11-01): Post a job opens on the GROUP GRID ("What do you need done?": Home, Yard,
 * Moving & errands, Trades, ...). "Use a template", "Hire a saved Helpr" and "Describe it with AI" are small
 * links on that same screen, not cards. Before: "How do you want to start?" (4 cards) -> "Start from scratch" ->
 * the groups: one tap more before the first field.
 *
 * @mutate src/pages/post-job/EntryChoice.tsx |       {groupGrid}\n\n      {/* The other ways to start | \n      {/* The other ways to start
 * @mutate src/pages/post-job/EntryChoice.tsx |         form.startFresh();\n        form.setFormPage(1);\n        form.setCategoryGroup(g); |         form.setCategoryGroup(g);
 * @mutate src/pages/post-job/EntryChoice.tsx |         if (atOpenJobLimit) return;\n        form.startFresh();\n        form.setFormPage(2); |         form.startFresh();\n        form.setFormPage(2);
 * @mutate src/pages/post-job/usePostJobForm.ts |         if (!hasKind && !skipEntry) { |         if (false) {
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ComponentProps } from "react";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/hooks/useSpendableGiftCards", () => ({ useSpendableGiftCards: () => ({ userId: "u1", ids: [], settled: true }) }));
vi.mock("@/hooks/useRecentPostedJobs", () => ({ useRecentPostedJobs: () => [], usePostedBefore: () => false }));
vi.mock("./useDraftCheckoutState", () => ({ useDraftCheckout: () => ({ state: null, settled: true }) }));
vi.mock("./OfferToSavedHelpr", () => ({
  useSavedHelpersLite: () => ({ data: [], fetchStatus: "idle", status: "success" }),
  OfferToSavedHelpr: () => null,
}));
vi.mock("@/components/postjob/AiJobBuilder", () => ({ AiJobBuilder: () => null }));
vi.mock("@/components/SuggestCategory", () => ({ SuggestCategory: () => null }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { EntryChoice } from "./EntryChoice";

type Form = ComponentProps<typeof EntryChoice>["form"];
const make = (over: Record<string, unknown> = {}) =>
  ({
    draftLoaded: true,
    hasDraft: false,
    openJobCount: 0,
    entryPanel: null,
    category: "",
    setCategory: vi.fn(),
    setCategoryGroup: vi.fn(),
    setFormPage: vi.fn(),
    setEntryPanel: vi.fn(),
    startFresh: vi.fn(),
    setStep: vi.fn(),
    useTemplate: vi.fn(),
    applyAiJob: vi.fn(),
    applyTemplateFields: vi.fn(),
    loadDraftAndContinue: vi.fn(),
    ...over,
  }) as unknown as Form & Record<string, ReturnType<typeof vi.fn>>;

const mount = (form: Form) =>
  render(
    <MemoryRouter initialEntries={["/post-job"]}>
      <EntryChoice form={form} />
    </MemoryRouter>,
  );

beforeEach(() => cleanup());

describe("JA-41: Post a job opens on the group grid", () => {
  it("the first screen asks What do you need done? with the 8 groups; no Start from scratch, no 'How do you want to start?'", () => {
    mount(make());
    expect(screen.getByRole("heading", { name: "What do you need done?" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Category groups" }).querySelectorAll("[data-group-tile]").length).toBe(8);
    expect(screen.queryByText("How do you want to start?")).toBeNull();
    expect(screen.queryByRole("button", { name: /Start from scratch/ })).toBeNull();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toBe("Step 1 of 6");
  });

  it("template, saved Helpr and AI are small links under the grid, each opening its panel", () => {
    const form = make();
    mount(form);
    const links = screen.getByRole("navigation", { name: "Other ways to start" });
    const grid = screen.getByRole("region", { name: "Category groups" });
    expect(grid.compareDocumentPosition(links) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const names = [...links.querySelectorAll("button")].map((b) =>
      [...b.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join("").trim(),
    );
    expect(names).toEqual(["Use a template", "Hire a saved Helpr", "Describe it with AI"]);
    // Small links, not the 104px choice cards.
    for (const b of links.querySelectorAll("button")) expect(b.className).toMatch(/min-h-\[44px\]/);
    fireEvent.click(screen.getByRole("button", { name: /Use a template/ }));
    fireEvent.click(screen.getByRole("button", { name: /Hire a saved Helpr/ }));
    fireEvent.click(screen.getByRole("button", { name: /Describe it with AI/ }));
    expect(vi.mocked(form.setEntryPanel).mock.calls.map((c) => c[0])).toEqual(["templates", "offer", "ai"]);
  });

  it("a group tap goes straight to its kinds; a one-category group goes straight to Details", () => {
    const form = make();
    mount(form);
    fireEvent.click(screen.getByRole("button", { name: /^Home/ }));
    expect(form.startFresh).toHaveBeenCalledTimes(1);
    expect(form.setFormPage).toHaveBeenLastCalledWith(1);
    expect(form.setCategoryGroup).toHaveBeenLastCalledWith("home");
    fireEvent.click(screen.getByRole("button", { name: /^Something else/ }));
    expect(form.setCategory).toHaveBeenLastCalledWith("other");
    expect(form.startFresh).toHaveBeenCalledTimes(2);
    expect(form.setFormPage).toHaveBeenLastCalledWith(2);
  });

  it("at the 5-open-job cap a tap does not start the form (the notice sits above)", () => {
    const form = make({ openJobCount: 5 });
    mount(form);
    fireEvent.click(screen.getByRole("button", { name: /^Home/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Something else/ }));
    expect(form.startFresh).not.toHaveBeenCalled();
  });

  it("back from Details of a one-category group returns to the grid (the entry screen), not the form's copy", () => {
    const src = blankComments(readFileSync("src/pages/post-job/usePostJobForm.ts", "utf8"));
    expect(src).toMatch(/if \(!hasKind && !skipEntry\) \{\s*setFormPage\(1\);\s*setStep\("entry"\);\s*return;/);
  });
});
