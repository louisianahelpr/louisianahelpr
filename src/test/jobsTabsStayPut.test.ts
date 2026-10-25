import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Jobs tabs never move (owner 2026-10-25: Browse, Posted and Working
 * screenshots, the tabs sliding sideways). On the desktop website Browse puts
 * the explore header at the panel's corner with no inset; Posted and Working
 * (JobListPage) wrapped it in `px-5 py-1`, so the tabs jumped 21px right and
 * 5px down when you left Browse (measured 272,76 vs 293,81 at 1440; equal at
 * 390). The desktop header wrapper, and the skeleton that stands in for it,
 * carry no left/top inset, only -1px over the panel's border.
 */
const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");

function desktopHeaderWrapperClass(src: string): string {
  const at = src.indexOf("{isWebDesktop && (");
  expect(at, "desktop header wrapper").toBeGreaterThan(-1);
  return src.slice(at).match(/className="([^"]*)"/)?.[1] ?? "";
}

describe("Jobs tabs stay put between Browse, Posted and Working", () => {
  for (const file of ["components/job-card/JobListPage.tsx", "components/JobsSectionSkeleton.tsx"]) {
    it(`${file}: the desktop header has no left or top inset`, () => {
      const cls = desktopHeaderWrapperClass(read(file)).split(/\s+/);
      expect(cls.filter((c) => /^(p|px|pl|py|pt)-/.test(c)), cls.join(" ")).toEqual([]);
      expect(cls).toContain("-ml-px");
      expect(cls).toContain("-mt-px");
    });
  }
});
