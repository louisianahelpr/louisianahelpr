/**
 * Q2709 Home controls (owner pop-up answer 11-06 ~12:30 AM, ~/.lh-shots/b2-home-controls/README.txt):
 *   - Next up's "See all (n)" / "Hide" is the shared link Button (variant="link" size="sm"): 2px narrower at rest,
 *     an underline on desktop hover (it had no hover change).
 *   - FirstJobHome's "Jobs near you" rows are ListRow: identical at rest (the caller's padding wins, 67px), a rounded
 *     grey tint on hover (they had none).
 * The other three Home controls stay as they are (owner + lead: pager dots, Coming-up rows, checklist steps).
 *
 * @mutate src/pages/home/HomeDashboard.tsx | variant="link"\n                          size="sm"\n                          data-testid="next-up-see-all" | variant="ghost"\n                          size="sm"\n                          data-testid="next-up-see-all"
 * @mutate src/pages/home/homeDashboard/FirstJobHome.tsx | <ListRow key={j.id} title={j.title} | <button type="button" key={j.id} title={j.title}
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const read = (p: string) => blankComments(readFileSync(resolve(__dirname, "..", p), "utf8"));

/** The JSX element (opening tag through its close) that carries `marker`. */
function elementWith(src: string, marker: string, tag: string): string {
  const at = src.indexOf(marker);
  expect(at, marker).toBeGreaterThan(-1);
  const open = src.lastIndexOf(`<${tag}`, at);
  const close = src.indexOf(`</${tag}>`, at);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(at);
  return src.slice(open, close + tag.length + 3);
}

describe("Home's See all and Jobs near you rows use the shared controls (owner 11-06)", () => {
  it('"See all (n)" is the shared link Button', () => {
    const src = read("pages/home/HomeDashboard.tsx");
    const el = elementWith(src, 'data-testid="next-up-see-all"', "Button");
    expect(el).toMatch(/variant="link"/);
    expect(el).toMatch(/size="sm"/);
    expect(el).toContain('t("home.seeAll", { n: todoCount })');
    expect(src).toMatch(/import \{ Button \} from "@\/components\/ui\/button";/);
  });

  it('every "Jobs near you" row is a ListRow, with its own padding kept', () => {
    const src = read("pages/home/homeDashboard/FirstJobHome.tsx");
    const el = elementWith(src, "onClick={() => navigate(`/jobs/${j.id}`)}", "ListRow");
    expect(el.startsWith("<ListRow key={j.id} title={j.title}")).toBe(true);
    expect(el).toContain('className="min-h-11 flex items-center gap-3 px-card py-3 text-left"');
    expect(src).toMatch(/import \{ ListRow \} from "@\/components\/ui\/ListRow";/);
    // Inventory floor: the list is still drawn from the near jobs.
    expect((src.match(/jobs\.slice\(0, NEAR_SHOWN\)\.map/g) ?? []).length).toBeGreaterThan(0);
  });
});
