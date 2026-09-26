// @vitest-environment jsdom
/**
 * #1582 (run 36069319716): /admin?view=people "J3 Jean-Baptiste 3. …" NOT
 * CLICKABLE at `… > div:nth-of-type(4) > div:nth-of-type(11) > div:nth-of-type(1)`.
 *
 * The admin People list is a VirtualList (src/components/AdminUsers.tsx →
 * src/components/VirtualList.tsx, @tanstack/react-virtual). A virtualizer
 * mounts only the rows in range, so the wrapper at nth-of-type(11) is row
 * `start + 10`, and `start` moves the moment the press scrolls the row into
 * view. A positional path therefore addresses a DIFFERENT row after the
 * scroll the press itself causes. The harness now addresses a virtualized row
 * by the `data-index` the virtualizer stamps on it.
 *
 * Class, from the app's own inventory: every file that calls a tanstack
 * virtualizer must stamp `data-index` on its rows, or its rows fall back to
 * positional addressing and the class returns.
 *
 * @mutate scripts/audit/press-every-control.mjs |       if (unique) { parts.unshift( |       if (false) { parts.unshift(
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const src = readFileSync(resolve(ROOT, "scripts/audit/press-every-control.mjs"), "utf8");
const body = src.match(/\nconst ENUMERATE = (\([\s\S]*?\n\});\n/)?.[1];
const constant = (name: string) => {
  const m = src.match(new RegExp(`\\n(?:export )?const ${name} =\\s*([\\s\\S]*?);\\n`));
  if (!m) throw new Error(`${name} not found in press-every-control.mjs`);
  return new Function(`return ${m[1]}`)() as string;
};
type Found = { label: string; path: string };
const enumerate = (): Found[] =>
  new Function(`return ${body}`)()({
    controlSel: constant("CONTROL_SEL"),
    overlaySel: constant("OPEN_OVERLAY"),
    scope: "page",
    base: "",
    transientSel: constant("TRANSIENT_REGION_SEL"),
  });

/** A window of a virtual list: rows [from, to] mounted, as VirtualList renders them. */
const renderWindow = (from: number, to: number) => {
  const rows = [];
  for (let i = from; i <= to; i++) rows.push(`<div data-index="${i}"><div role="button" aria-label="Row ${i}"></div></div>`);
  document.body.innerHTML = `<main><div><button aria-label="Filter"></button></div><div class="list">${rows.join("")}</div></main>`;
};

describe("press addresses a virtualized row by its index (#1582)", () => {
  it("finds ENUMERATE in the harness", () => {
    expect(body).toBeTruthy();
  });

  it("a row's path still names the same row after the virtualizer's window moves", () => {
    const rect = { x: 0, y: 0, top: 0, left: 0, right: 40, bottom: 40, width: 40, height: 40, toJSON() {} };
    Element.prototype.getBoundingClientRect = () => rect as DOMRect;
    renderWindow(0, 15);
    const row10 = enumerate().find((c) => c.label === "Row 10");
    expect(row10?.path).toContain('[data-index="10"]');
    // The press scrolls the row into view; the virtualizer drops rows 0-5.
    renderWindow(6, 21);
    const el = document.querySelector(`body > ${row10!.path}`);
    expect(el?.getAttribute("aria-label")).toBe("Row 10");
  });

  it("an element without a data-index keeps its positional path", () => {
    renderWindow(0, 2);
    const filter = enumerate().find((c) => c.label === "Filter");
    expect(filter?.path).toMatch(/nth-of-type/);
    expect(filter?.path).not.toContain("data-index");
  });

  it("every tanstack virtualizer call site in src/ stamps data-index on its rows", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) files.push(p);
      }
    };
    walk(resolve(ROOT, "src"));
    const sites = files.filter((f) => /\buse(Window)?Virtualizer\s*\(/.test(blankComments(readFileSync(f, "utf8"))));
    // Inventory floor, measured 2026-09-25: VirtualList.tsx, VirtualizedJobList.tsx.
    expect(sites.length).toBeGreaterThanOrEqual(2);
    const missing = sites.filter((f) => !/data-index=\{/.test(blankComments(readFileSync(f, "utf8"))));
    expect(missing.map((f) => f.replace(ROOT + "/", ""))).toEqual([]);
  });
});
