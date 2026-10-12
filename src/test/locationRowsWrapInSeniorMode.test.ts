/**
 * Every one-line "where + when" row wraps in Senior mode.
 *
 * Seen 2026-10-12 (prod-audit run 38181023758, senior-mode-no-silent-cut, and
 * re-measured on prod at 320 on guest /browse with the spec's own check): in
 * Senior mode the feed card's time ran off the card with no ellipsis ("12:0"
 * -40px, "6:0" -29px). Its meta row is `flex-nowrap overflow-hidden` with
 * shrink-0 date and time chips, and it lacked `job-meta-row`, the index.css
 * hook that lets such a row wrap in Senior mode only (the owner's one-line
 * rule still holds at the default scale). JobCardMetaRow had the hook; the
 * feed's JobCard and the schedule card did not.
 *
 * Class: every JSX className in src/ that is `flex-nowrap` + `overflow-hidden`
 * and whose row holds a map pin and a date/time chip carries `job-meta-row`,
 * and index.css still wraps `.job-meta-row` under html.senior-mode.
 *
 * @mutate src/components/dashboard/JobCard.tsx | <div className="job-meta-row flex items-center gap-x-2 flex-nowrap overflow-hidden"> | <div className="flex items-center gap-x-2 flex-nowrap overflow-hidden">
 * @mutate src/components/profile/ScheduleTab.tsx | className="job-meta-row flex flex-1 | className="flex flex-1
 * @mutate src/index.css | html.senior-mode .job-meta-row { | html.senior-mode .job-meta-row-x {
 */
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource } from "./helpers/walkSource";

const ROOT = resolve(__dirname, "../..");

interface Row { file: string; cls: string }

/** The source of the element whose className starts at `at`: from its `<tag` to its balanced `</tag>`. */
function elementBody(src: string, at: number): string {
  const open = src.lastIndexOf("<", at);
  const tag = /^<([a-z]+)/.exec(src.slice(open))?.[1];
  if (!tag) return "";
  const re = new RegExp(`<${tag}\\b|</${tag}>`, "g");
  re.lastIndex = open;
  let depth = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    depth += m[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return src.slice(open, m.index);
  }
  return src.slice(open);
}

function locationRows(): Row[] {
  const files = walkSource([join(ROOT, "src")], [".tsx"]).filter((f) => !/\.test\.tsx$/.test(f));
  const rows: Row[] = [];
  for (const f of files) {
    const src = blankComments(readFileSync(f, "utf8"));
    for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const cls = m[1] ?? m[2];
      if (!/\bflex-nowrap\b/.test(cls) || !/\boverflow-hidden\b/.test(cls)) continue;
      const body = elementBody(src, m.index!);
      if (!/<MapPin\b/.test(body)) continue;
      if (!/<(Calendar|Clock)\b|formatJobDate|whenLabel|timeLabel/.test(body)) continue;
      rows.push({ file: relative(ROOT, f), cls });
    }
  }
  return rows;
}

describe("location + when rows wrap in Senior mode", () => {
  const rows = locationRows();

  it("finds the rows (floor)", () => {
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.map((r) => r.file)).toEqual(expect.arrayContaining(["src/components/dashboard/JobCard.tsx", "src/components/job-card/JobCardMetaRow.tsx"]));
  });

  it("each carries the job-meta-row hook", () => {
    expect(rows.filter((r) => !/\bjob-meta-row\b/.test(r.cls)).map((r) => `${r.file}: ${r.cls.slice(0, 80)}`)).toEqual([]);
  });

  it("index.css wraps .job-meta-row under Senior mode", () => {
    const css = readFileSync(join(ROOT, "src/index.css"), "utf8");
    expect(css).toMatch(/html\.senior-mode \.job-meta-row \{\s*flex-wrap: wrap;/);
  });
});
