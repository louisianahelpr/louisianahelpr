/**
 * ONE TAB-TITLE PATTERN: "<Page> — Helpr" (owner UI audit 11-09, F137: /helprs' tab said only "Find a Helpr").
 * Every string literal a screen hands usePageTitle ends with " — Helpr". AppPage and SectionScreen already add it
 * from their `title`; a page that also calls usePageTitle with a bare literal runs AFTER them (a parent's effect runs
 * after its child's) and wins, which is how /helprs lost the suffix. Computed titles (template strings, helpers) are
 * read where they are built and are out of this check.
 *
 * The public heads (the HTML <title> served before the app runs) follow the same pattern: every PUBLIC_PAGE_META,
 * LEGAL_PAGE_META and NOINDEX_PAGE_META entry and every /hire/<service>/<town> page (F064: they said
 * "| Louisiana Helpr"). The landing page keeps its locked brand title.
 *
 * @mutate src/pages/helprs/FindHelprs.tsx | export default function FindHelprs() {\n | export default function FindHelprs() {\n  usePageTitle("Find a Helpr");\n
 * @mutate src/lib/townPages.mjs | , LA — Helpr`; | , LA \| Louisiana Helpr`;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";
import { LEGAL_PAGE_META, NOINDEX_PAGE_META, PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { TOWN_PAGE_SERVICES, TOWN_PAGE_TOWNS, townPageMeta } from "@/lib/townPages.mjs";

const ROOT = join(__dirname, "..", "..");
const screens = trackedFiles("src").filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("src/test/"));

/** Every `usePageTitle("literal")` call outside the tests, with its file. */
function literalTitles(): Array<{ file: string; title: string }> {
  const out: Array<{ file: string; title: string }> = [];
  for (const file of screens) {
    const src = blankComments(readFileSync(join(ROOT, file), "utf8"));
    for (const m of src.matchAll(/usePageTitle\(\s*"([^"]*)"\s*\)/g)) out.push({ file, title: m[1] });
  }
  return out;
}

describe("tab titles read '<Page> — Helpr' (F137)", () => {
  it("the inventory is real: many screens, some literal titles", () => {
    expect(screens.length).toBeGreaterThan(500);
    expect(literalTitles().length).toBeGreaterThan(5);
  });

  it("every literal usePageTitle ends with ' — Helpr'", () => {
    expect(literalTitles().filter((t) => !t.title.endsWith(" — Helpr"))).toEqual([]);
  });

  it("/helprs names its tab through AppPage: 'Find a Helpr — Helpr'", () => {
    const page = blankComments(readFileSync(join(ROOT, "src/pages/helprs/FindHelprs.tsx"), "utf8"));
    expect(page).toContain('<AppPage title="Find a Helpr"');
    expect(page).not.toMatch(/usePageTitle\(/);
    expect(blankComments(readFileSync(join(ROOT, "src/components/AppPage.tsx"), "utf8"))).toContain("usePageTitle(`${title} — Helpr`);");
  });

  it("every public head and every /hire town page reads '<Page> — Helpr' (F064)", () => {
    const heads: Array<[string, string]> = [
      ...Object.entries(PUBLIC_PAGE_META).map(([k, m]) => [k, (m as { title: string }).title] as [string, string]),
      ...Object.entries(LEGAL_PAGE_META).map(([k, m]) => [k, (m as { title: string }).title] as [string, string]),
      ...Object.entries(NOINDEX_PAGE_META).map(([k, m]) => [k, (m as { title: string }).title] as [string, string]),
      ...TOWN_PAGE_SERVICES.flatMap((s) => TOWN_PAGE_TOWNS.map((t) => [`/hire/${s.slug}/${t.slug}`, townPageMeta(s, t).title] as [string, string])),
    ];
    expect(heads.length).toBeGreaterThan(30);
    expect(heads.filter(([, title]) => !title.endsWith(" — Helpr"))).toEqual([]);
    expect(townPageMeta(TOWN_PAGE_SERVICES[0], TOWN_PAGE_TOWNS[0]).ogTitle).toMatch(/, LA — Helpr$/);
  });
});
