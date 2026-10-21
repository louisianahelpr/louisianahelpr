/**
 * Owner, 2026-10-08: "order summary page needs to open at the top of the
 * page, rn it opens at the bottom." Post a Job's steps share one route, so
 * ScrollToTop never runs between them and the page's scroller kept the form's
 * offset. PostJob resets every scroller when the step changes.
 *
 * The first fix reset the window and `.app-shell-scroll` only, and the owner's
 * phone still opened at the bottom: measured in WebKit at 390x844 on prod, the
 * scroller is AppPage's own column (`[data-app-page-scroll]`, scrollTop 536 of
 * 1200) while the window and .app-shell-scroll sat at 0. Both are reset now,
 * and AppPage must keep marking its column so the reset can find it.
 *
 * @mutate src/pages/post-job/PostJob.tsx |       el.scrollTop = 0; |       void el;
 * @mutate src/pages/post-job/PostJob.tsx | ".app-shell-scroll, [data-app-page-scroll]" | ".app-shell-scroll"
 * @mutate src/components/AppPage.tsx | <div data-app-page-scroll="" className="page-measure | <div className="page-measure
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const SRC = read("src/pages/post-job/PostJob.tsx");

describe("Post a Job: every step opens at its top", () => {
  it("a step change resets the shell's scroller AND AppPage's own column (keyed on form.step and form.formPage)", () => {
    // Keyed on the step AND the form's screen (formPage, boards 23/44/3/45):
    // the four form screens share the "form" step, so each must reset too; so do screen 1b (a group's
    // categories) and step 0's opened ways to start (owner 2026-10-21).
    const effect = SRC.slice(SRC.indexOf("const lastStep = useRef(`${form.step}:${form.formPage}:${form.categoryGroup}:${form.entryPanel}`)"), SRC.indexOf("}, [form.step, form.formPage, form.categoryGroup, form.entryPanel]);"));
    expect(effect.length).toBeGreaterThan(0);
    expect(effect).toMatch(/querySelectorAll<HTMLElement>\("\.app-shell-scroll, \[data-app-page-scroll\]"\)/);
    expect(effect).toMatch(/el\.scrollTop = 0;/);
  });
  it("AppPage's scrolling column carries the marker the reset looks for", () => {
    expect(read("src/components/AppPage.tsx")).toMatch(/<div data-app-page-scroll="" className="page-measure[^"]*overflow-y-auto/);
  });
});
