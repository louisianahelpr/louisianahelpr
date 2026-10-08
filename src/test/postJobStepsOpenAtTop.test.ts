/**
 * Owner, 2026-10-08: "order summary page needs to open at the top of the
 * page, rn it opens at the bottom." Post a Job's steps share one route, so
 * ScrollToTop never runs between them and AppShell's scroller kept the form's
 * offset. PostJob resets every scroller when the step changes.
 *
 * @mutate src/pages/post-job/PostJob.tsx |       el.scrollTop = 0; |       void el;
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(join(process.cwd(), "src/pages/post-job/PostJob.tsx"), "utf8");

describe("Post a Job: every step opens at its top", () => {
  it("a step change resets the shell's scroller (keyed on form.step)", () => {
    const effect = SRC.slice(SRC.indexOf("const lastStep = useRef(form.step)"), SRC.indexOf("}, [form.step]);"));
    expect(effect.length).toBeGreaterThan(0);
    expect(effect).toMatch(/querySelectorAll<HTMLElement>\("\.app-shell-scroll"\)/);
    expect(effect).toMatch(/el\.scrollTop = 0;/);
  });
});
