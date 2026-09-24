/**
 * AL-009 / Q262 class: a counterparty who deleted their account leaves
 * customer_id / helper_id / otherUserId NULL, and an unguarded deep link then
 * navigates to `/messages?...&userId=null`, a dead thread. Every
 * `/messages?...userId=${x}` link in src must test `x` first (a ternary, a
 * `=== null` branch, or an `if (x)`) on its line or the three before it.
 * Inventory: every non-test .ts/.tsx file under src.
 *
 * @mutate src/pages/posts/postedJobCard/steps/InProgressStep.tsx | navigate(job.helper_id ? `/messages?jobId=${job.id}&userId=${job.helper_id}` : "/messages") | navigate(`/messages?jobId=${job.id}&userId=${job.helper_id}`)
 * @mutate src/pages/jobs/appliedJobCard/DisputedSection.tsx | navigate(job.customer_id ? `/messages?jobId=${app.job_id}&userId=${job.customer_id}` : "/messages") | navigate(`/messages?jobId=${app.job_id}&userId=${job.customer_id}`)
 * @mutate src/pages/posts/postedJobCard/steps/CompletedStep.tsx | !!job.helper_id && | true &&
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const links: { where: string; guarded: boolean }[] = [];
for (const f of walk("src")) {
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/\/messages\?[^`]*userId=\$\{([^}]+)\}/g)) {
      const x = escape(m[1].trim());
      const ctx = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
      const guarded = new RegExp(`${x}\\s*\\?|${x}\\s*[!=]==?\\s*null|if\\s*\\(\\s*!?${x}\\s*\\)`).test(ctx);
      links.push({ where: `${f}:${i + 1}`, guarded });
    }
  });
}

describe("message deep links never carry a NULL counterparty (AL-009)", () => {
  it("the inventory is real", () => {
    expect(links.length).toBeGreaterThanOrEqual(8);
  });

  it("every userId link is guarded", () => {
    expect(links.filter((l) => !l.guarded).map((l) => l.where)).toEqual([]);
  });

  it("the poster's Review chip needs a helper to review", () => {
    const src = readFileSync("src/pages/posts/postedJobCard/steps/CompletedStep.tsx", "utf8");
    expect(src).toMatch(/const canReview =\s*!!job\.helper_id &&/);
  });
});
