/**
 * Owner 2026-10-21 ("make sure each one is numbered correctly"): every Post a Job screen shows its
 * true position, from ONE ordered list (src/components/postjob/postJobScreens.ts). JA-41 (owner pick
 * 2026-11-01): "How do you want to start?" is gone, the group grid is the first screen, so six:
 * 1 What do you need done? · 2 What kind of <group> job? · 3 Details · 4 Price · 5 When and where ·
 * 6 Review. "Something else" skips 2 (1 -> 3); nothing renumbers.
 * @mutate src/components/postjob/postJobScreens.ts |   { key: "kind", rail: "Kind of job" },\n  { key: "details", rail: "Details" }, |   { key: "details", rail: "Details" },\n  { key: "kind", rail: "Kind of job" },
 * @mutate src/pages/post-job/FormStep.tsx | <PostJobStepHeader screen="where" | <PostJobStepHeader screen="price"
 * @mutate src/pages/post-job/EntryChoice.tsx |                     form.setFormPage(2);\n                  }} |                   }}
 * @mutate src/components/postjob/PostJobStepHeader.tsx |   const step = screenNumber(screen); |   const step = 1;
 * @mutate src/pages/post-job/PostJob.tsx |   const header = { title: "Post a job" }; |   const header = { title: form.categoryGroup ? "Home" : "Post a job" };
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { POST_JOB_SCREENS, screenNumber, screenOfFormPage } from "@/components/postjob/postJobScreens";
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
  ["src/pages/post-job/CheckoutStepView.tsx", "review", /question="Look good\?"/],
];

describe("Post a Job screen numbers (owner 2026-10-21)", () => {
  it("the questions' English is unchanged (A3-3 moved them into enPostJob.ts)", () => {
    expect([enPostJob["postJob.groupsQ"], enPostJob["postJob.detailsQ"], enPostJob["postJob.priceQ"], enPostJob["postJob.whereQ"]]).toEqual([
      "What do you need done?", "Tell us about it", "What will you pay?", "When and where?",
    ]);
  });

  it("the one list is the six screens in order", () => {
    expect(POST_JOB_SCREENS.map((s) => s.key)).toEqual(["groups", "kind", "details", "price", "where", "review"]);
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

  it("each header shows 'n of 6' with n segments filled", () => {
    POST_JOB_SCREENS.forEach(({ key }, i) => {
      const { unmount } = render(<PostJobStepHeader screen={key} question="q" helper="h" />);
      const bar = screen.getByRole("progressbar");
      expect(bar.getAttribute("aria-valuetext")).toBe(`Step ${i + 1} of 6`);
      expect(bar.querySelectorAll("[data-done]").length).toBe(i + 1);
      expect(bar.children.length).toBe(6);
      unmount();
    });
  });

  it("the top bar reads 'Post a job' on every screen (owner 2026-10-21); screen 3's question names the group", () => {
    const page = read("src/pages/post-job/PostJob.tsx");
    expect(page).toContain('const header = { title: "Post a job" };');
    expect(page).toMatch(/<AppPage title=\{header\.title\}/);
    expect(page).not.toMatch(/title:\s*[^"\n]*\?/);
  });

  it("form pages map to their screens; templates and AI land on Details (3 of 6)", () => {
    expect(screenOfFormPage(1, false)).toBe("groups");
    expect(screenOfFormPage(1, true)).toBe("kind");
    expect([2, 3, 4].map((p) => screenNumber(screenOfFormPage(p, false)))).toEqual([3, 4, 5]);
    const entry = read("src/pages/post-job/EntryChoice.tsx");
    expect(entry).toMatch(/form\.applyTemplateFields\(sample\)\);\s*form\.setFormPage\(2\);/);
    expect(entry).toMatch(/form\.setStep\("form"\);\s*\/\/[^\n]*\n\s*form\.setFormPage\(2\);/);
  });
});
