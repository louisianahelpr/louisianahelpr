/**
 * Q2786 (landing audit 11-09, L026): index.html's prerendered route shells each drew their own H1, so a crawler reading
 * the HTML before JavaScript saw six (the landing hero's, login, signup, jobs, messages, home). Every shell is copied
 * from its page through scopeShellIds (scripts/shell-ids.mjs), which now draws every shell's heading but the landing's as
 * a <div>, so the HTML outside scripts holds exactly one H1: the hero's. The per-shell "matches its page" guards
 * (authShellsMatchPages, jobsShellMatchesSkeleton, messagesDeclutterShellsMatchSkeletons, homeShellMatchesSkeleton,
 * landingShellMatchesHero) keep index.html equal to that transform, so a shell rewritten from its page cannot bring an
 * H1 back without this going red.
 *
 * @mutate scripts/shell-ids.mjs |   if (HEADING_KEEPS_H1.has(shell)) return html; |   return html;
 * @mutate index.html | <div class="sr-only">Jobs</div> | <h1 class="sr-only">Jobs</h1>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scopeShellIds } from "../../scripts/shell-ids.mjs";

const ROOT = join(__dirname, "..", "..");
const html = readFileSync(join(ROOT, "index.html"), "utf8");
/**
 * Cut every `open ... close` span out of `s`, matching case-insensitively, and repeat until none is left. The close tag
 * may carry attributes or spaces before its `>` (`</script >`). A span with no close runs to the end of the string.
 * This uses indexOf, not a regex replace: CodeQL (js/bad-tag-filter, js/incomplete-multi-character-sanitization)
 * flags a single-pass regex tag filter.
 */
function cutSpans(s: string, open: string, close: string, closeEndsAt: string): string {
  let out = s;
  for (;;) {
    const lower = out.toLowerCase();
    const start = lower.indexOf(open);
    if (start < 0) return out;
    const closeAt = lower.indexOf(close, start + open.length);
    const end = closeAt < 0 ? -1 : lower.indexOf(closeEndsAt, closeAt + close.length - closeEndsAt.length);
    out = out.slice(0, start) + (end < 0 ? "" : out.slice(end + closeEndsAt.length));
  }
}
/** The HTML a crawler reads as markup: scripts and comments blanked (an H1 inside a script string is not a heading). */
const markup = cutSpans(cutSpans(html, "<script", "</script", ">"), "<!--", "-->", "-->");

describe("Q2786: the pre-JS HTML carries exactly one H1, the landing hero's", () => {
  it("index.html has one <h1> outside scripts, and it is the hero's", () => {
    const h1s = [...markup.matchAll(/<h1[\s>][\s\S]*?<\/h1>/g)].map((m) => m[0]);
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toContain("landing-h1");
    // The shells are all still there (inventory floor: the check read the real file, not an empty one).
    const shells = markup.match(/<div id="lh-[a-z]+-shell"/g) ?? [];
    expect(shells.length).toBeGreaterThan(5);
  });

  it("scopeShellIds keeps the landing's H1 and draws every other shell's heading as a div with the same classes", () => {
    const page = '<main><h1 class="text-page-title text-foreground">Log in</h1><h2>x</h2></main>';
    expect(scopeShellIds(page, "landing")).toContain('<h1 class="text-page-title text-foreground">Log in</h1>');
    for (const shell of ["login", "signup", "jobs", "messages", "declutter", "home"]) {
      const out = scopeShellIds(page, shell);
      expect(out, shell).toContain('<div class="text-page-title text-foreground">Log in</div>');
      expect(out, shell).not.toMatch(/<h1[\s>]/);
      expect(out, shell).toContain("<h2>x</h2>");
    }
  });
});
