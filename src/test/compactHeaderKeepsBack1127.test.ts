/**
 * Polish audit 11-27 #113 (~/.lh-shots/polish-audit-1127/FINDINGS.md, jobs/combo-pavers.png): after scrolling, the
 * title-only compact bar (src/lib/largeTitles.ts) replaced the header, so Post a job and Applicants lost their back
 * arrow mid-page. Those pages now pin their own title row (AppPage `stickyHeader`, which also turns the compact bar
 * off for them: data-own-title-row), as Find a Helpr (audit 11-21 P23) and the Declutter item page already do.
 * Inventory: every AppPage call on the list below; the job page is not on it (its 2-3 line title would pin a tall
 * row; that waits on #35's header).
 *
 * @mutate src/pages/post-job/PostJob.tsx | onBack={form.handlePostJobBack} focusedFlow stickyHeader> | onBack={form.handlePostJobBack} focusedFlow>
 * @mutate src/pages/posts/postedJobs/ApplicantsPanel.tsx |           stickyHeader\n          onBack={() => setSelectedJob(null)} |           onBack={() => setSelectedJob(null)}
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

const PAGES = [
  "src/pages/post-job/PostJob.tsx",
  "src/pages/posts/postedJobs/ApplicantsPanel.tsx",
  "src/pages/helprs/FindHelprs.tsx",
  "src/components/declutter/DeclutterItemView.tsx",
];
const appPageCall = (src: string) => {
  const at = src.indexOf("<AppPage");
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
    else if (src[i] === ">" && depth === 0) return src.slice(at, i + 1);
  }
  return "";
};

describe("#113: long pages keep their back arrow while scrolling", () => {
  it("reads every page on the list (inventory floor)", () => {
    expect(PAGES.length).toBeGreaterThan(3);
  });
  it.each(PAGES)("%s pins its own title row", (f) => {
    const call = appPageCall(blankComments(readFileSync(resolve(__dirname, "../..", f), "utf8")));
    expect(call.length).toBeGreaterThan(10);
    expect(call).toMatch(/\bstickyHeader\b/);
  });
  it("a pinned title row turns the title-only compact bar off for that page", () => {
    const app = blankComments(readFileSync(resolve(__dirname, "../components/AppPage.tsx"), "utf8"));
    expect(app).toMatch(/data-own-title-row=\{stickyHeader \? "" : undefined\}/);
    const bar = blankComments(readFileSync(resolve(__dirname, "../lib/largeTitles.ts"), "utf8"));
    expect(bar).toMatch(/!ownRow/);
  });
});
