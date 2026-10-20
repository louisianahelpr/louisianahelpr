/**
 * RATING STARS ARE NEVER RUST (lead 2026-10-20: "Stars are not money. Rust =
 * money only."; spec v2 §1.1). The filled colour comes from one source,
 * src/lib/starColor.ts (--primary, the action olive).
 *
 * CLASS: every `<Star …>` element in tracked source is read, and its tag may
 * not carry a rust token (--accent / fill-accent / text-accent / --accent-ink /
 * --burnt-sienna / --sienna-ink / --money). JOBS_OWNED lists the stars that sit
 * in Builder 2e's Jobs files, reported to the lead rather than edited here;
 * exact and two-way, so it can only shrink.
 *
 * @mutate src/lib/starColor.ts | export const STAR_ON_CLS = "fill-primary text-primary"; | export const STAR_ON_CLS = "fill-accent text-accent";
 * @mutate src/components/PersonTile.tsx | <Star className={`w-3.5 h-3.5 ${STAR_ON_CLS}`} /> | <Star className="w-3.5 h-3.5 fill-accent text-accent" />
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { trackedFiles } from "./helpers/trackedFiles";
import { blankComments } from "./helpers/blankNonCode";
import { STAR_ON, STAR_ON_CLS } from "@/lib/starColor";

const ROOT = path.resolve(__dirname, "../..");
const RUST = /\b(?:fill|text)-accent\b|--accent\b|--accent-ink|--burnt-sienna|--sienna-ink|--money\b/;
const JOBS_OWNED = [
  "src/components/dashboard/CompactJobCard.tsx",
  "src/components/dashboard/JobCard.tsx",
  "src/components/dashboard/JobDetailDialog.tsx",
  "src/pages/posts/postedJobs/ApplicantsPanel.tsx",
];

describe("rating stars are olive, never rust", () => {
  it("the one source is the action olive", () => {
    expect(STAR_ON).toBe("hsl(var(--primary))");
    expect(STAR_ON_CLS).toBe("fill-primary text-primary");
  });

  it("no <Star> tag outside JOBS_OWNED carries rust; JOBS_OWNED is exact", () => {
    const files = trackedFiles("src").filter((f) => /^src\/.*\.tsx$/.test(f) && !f.startsWith("src/test/"));
    let stars = 0;
    const rusty = new Set<string>();
    for (const f of files) {
      const src = blankComments(fs.readFileSync(path.join(ROOT, f), "utf8"));
      for (const m of src.matchAll(/<Star\b[\s\S]*?\/>/g)) {
        stars++;
        if (RUST.test(m[0])) rusty.add(f);
      }
    }
    expect(stars).toBeGreaterThan(15);
    expect([...rusty].sort()).toEqual([...JOBS_OWNED].sort());
  });
});
