/**
 * Owner 2026-10-21 ("make sure each one is numbered correctly"): every Post a Job screen shows its
 * true position, from ONE ordered list (src/components/postjob/postJobScreens.ts).
 * Owner 2026-11-20 (ease batch, item 1): a short 3-step flow, What you need -> When -> Budget -> Post. The group grid,
 * a group's kinds and Details are step 1; When and where is step 2; Budget is step 3; Review is the Post screen (bar
 * full, "Ready to post"). Before: six numbered screens (groups, kind, details, price, where, review).
 * @mutate src/components/postjob/postJobScreens.ts |   { key: "where", step: 2 },\n  { key: "price", step: 3 }, |   { key: "price", step: 2 },\n  { key: "where", step: 3 },
 * @mutate src/pages/post-job/FormStep.tsx | <PostJobStepHeader screen="where" | <PostJobStepHeader screen="price"
 * @mutate src/pages/post-job/EntryChoice.tsx |                     form.setFormPage(2);\n                  }} |                   }}
 * @mutate src/components/postjob/PostJobStepHeader.tsx |   const rawStep = screenNumber(screen); |   const rawStep = 1;
 * @mutate src/pages/post-job/PostJob.tsx |   const header = { title: tr("jobs.postAJob") }; |   const header = { title: form.categoryGroup ? "Home" : tr("jobs.postAJob") };
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { POST_JOB_SCREENS, POST_JOB_SCREEN_COUNT, screenNumber, screenOfFormPage } from "@/components/postjob/postJobScreens";
import { PostJobStepHeader } from "@/components/postjob/PostJobStepHeader";
import { enPostJob } from "@/lib/i18n/enPostJob";

const read = (f: string) => readFileSync(f, "utf8");

/** Each header in the flow: the file, the screen key it passes, and the question it asks. */
const EXPECTED: [file: string, key: string, question: RegExp][] = [
  // A3-3 (Spanish): the questions are t() keys; their English is pinned in the test below.
  ["src/pages/post-job/EntryChoice.tsx", "groups", /question=\{t\("postJob\.groupsQ"\)\}/],
  ["src/pages/post-job/FormStep.tsx", "groups", /question=\{t\("postJob\.groupsQ"\)\}/],
  ["src/pages/post-job/FormStep.tsx", "kind", /question=\{groupQuestion\(/],
  ["src/pages/post-job/FormStep.tsx", "details", /question=\{t\("postJob\.detailsQ"\)\}/],
  ["src/pages/post-job/FormStep.tsx", "price", /question=\{t\("postJob\.priceQ"\)\}/],
  ["src/pages/post-job/FormStep.tsx", "where", /question=\{t\("postJob\.whereQ"\)\}/],
  ["src/pages/post-job/CheckoutStepView.tsx", "review", /question=\{tr\("postJob\.f\.lookGood"\)\}/],
];

describe("Post a Job steps (owner 2026-11-20: three steps, then Post)", () => {
  it("the questions' English is unchanged (A3-3 moved them into enPostJob.ts)", () => {
    expect([enPostJob["postJob.groupsQ"], enPostJob["postJob.detailsQ"], enPostJob["postJob.priceQ"], enPostJob["postJob.whereQ"]]).toEqual([
      "What do you need done?", "Tell us about it", "What will you pay?", "When and where?",
    ]);
    expect([enPostJob["postJob.rail.what"], enPostJob["postJob.rail.when"], enPostJob["postJob.rail.budget"], enPostJob["postJob.rail.post"]]).toEqual([
      "What you need", "When", "Budget", "Post",
    ]);
  });

  it("the one list: What you need (groups, kind, details) -> When -> Budget -> Post; three numbered steps", () => {
    expect(POST_JOB_SCREENS.map((s) => `${s.key}:${s.step}`)).toEqual(["groups:1", "kind:1", "details:1", "where:2", "price:3", "review:4"]);
    expect(POST_JOB_SCREEN_COUNT).toBe(3);
  });

  it("every screen's header passes its own key, next to its own question", () => {
    for (const [file, key, q] of EXPECTED) {
      const src = read(file);
      const at = src.search(new RegExp(`<PostJobStepHeader\\s+screen="${key}"\\s+${q.source}`));
      expect(at, `${file}: screen "${key}" with its question`).toBeGreaterThan(-1);
    }
    // No header anywhere still passes a bare number.
    for (const f of ["src/pages/post-job/EntryChoice.tsx", "src/pages/post-job/FormStep.tsx", "src/pages/post-job/CheckoutStepView.tsx"]) {
      expect(read(f)).not.toMatch(/<PostJobStepHeader\s+step=/);
    }
  });

  it("each form screen shows 'Step n of 3' with n segments filled; Post shows the bar full and 'Ready to post'", () => {
    const want: Record<string, string> = { groups: "Step 1 of 3", kind: "Step 1 of 3", details: "Step 1 of 3", where: "Step 2 of 3", price: "Step 3 of 3", review: "Ready to post" };
    POST_JOB_SCREENS.forEach(({ key }) => {
      const { unmount } = render(<PostJobStepHeader screen={key} question="q" helper="h" />);
      const bar = screen.getByRole("progressbar");
      expect(bar.getAttribute("aria-valuetext")).toBe(want[key]);
      expect(bar.querySelectorAll("[data-done]").length).toBe(Math.min(screenNumber(key), 3));
      expect(bar.children.length).toBe(3);
      unmount();
    });
  });

  it("the top bar reads 'Post a job' on every screen (owner 2026-10-21)", () => {
    const page = read("src/pages/post-job/PostJob.tsx");
    // Design audit r2 #32: the same words, in the member's language (jobs.postAJob is "Post a job" in English).
    expect(page).toContain('const header = { title: tr("jobs.postAJob") };');
    expect(page).toMatch(/<AppPage title=\{header\.title\}/);
    expect(page).not.toMatch(/title:\s*[^"\n]*\?/);
  });

  it("form pages map to their screens (When before Budget); templates and AI land on Details", () => {
    expect(screenOfFormPage(1, false)).toBe("groups");
    expect(screenOfFormPage(1, true)).toBe("kind");
    expect([2, 3, 4].map((p) => screenOfFormPage(p, false))).toEqual(["details", "where", "price"]);
    const form = read("src/pages/post-job/FormStep.tsx");
    expect(form.indexOf('<div data-form-page="3"')).toBeLessThan(form.indexOf('<div data-form-page="4"'));
    expect(form.slice(form.indexOf('<div data-form-page="3"'), form.indexOf('<div data-form-page="4"'))).toContain('screen="where"');
    const entry = read("src/pages/post-job/EntryChoice.tsx");
    expect(entry).toMatch(/form\.applyTemplateFields\(sample\)\);\s*form\.setFormPage\(2\);/);
    expect(entry).toMatch(/form\.setStep\("form"\);\s*\/\/[^\n]*\n\s*form\.setFormPage\(2\);/);
  });
});
