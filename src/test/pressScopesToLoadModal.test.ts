// @vitest-environment jsdom
/**
 * Q294: /jobs/:id renders JobDetailDialog, a modal already open at load. The
 * page pass skipped controls inside overlays and no overlay pass ran for a
 * modal no press opened, so it pressed the covered background: run
 * 35905268411, /jobs/:id customer "found=16 pressed=0 fail=9 skip=7", every
 * fail NOT CLICKABLE behind the modal's backdrop.
 *
 * This runs the harness's own ENUMERATE (the function page.evaluate receives)
 * against a DOM with a modal open at load and asserts it returns the modal's
 * controls and none of the covered page behind it.
 *
 * @mutate scripts/audit/press-every-control.mjs |       if (!loadModal.contains(el)) return; |       if (loadModal.contains(el)) return;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../../scripts/audit/press-every-control.mjs"), "utf8");
const body = src.match(/\nconst ENUMERATE = (\([\s\S]*?\n\});\n/)?.[1];
const constant = (name: string) => {
  const m = src.match(new RegExp(`\\n(?:export )?const ${name} =\\s*([\\s\\S]*?);\\n`));
  if (!m) throw new Error(`${name} not found in press-every-control.mjs`);
  return new Function(`return ${m[1]}`)() as string;
};

type Found = { label: string };
const enumerate = (scope: "page" | "overlay"): Found[] =>
  new Function(`return ${body}`)()({
    controlSel: constant("CONTROL_SEL"),
    overlaySel: constant("OPEN_OVERLAY"),
    scope,
    base: "",
    transientSel: constant("TRANSIENT_REGION_SEL"),
  });

describe("press page pass scopes to a modal open at load (Q294)", () => {
  it("finds ENUMERATE in the harness", () => {
    expect(body).toBeTruthy();
  });

  it("returns only the open modal's controls, none of the covered page", () => {
    // jsdom has no innerText, so labels come from aria-label.
    document.body.innerHTML = `
      <main><button aria-label="Search jobs"></button><button aria-label="Hide status filters"></button></main>
      <div role="dialog" data-state="open"><button aria-label="Apply"></button><button aria-label="Close"></button></div>`;
    const rect = { x: 0, y: 0, top: 0, left: 0, right: 40, bottom: 40, width: 40, height: 40, toJSON() {} };
    Element.prototype.getBoundingClientRect = () => rect as DOMRect;
    const labels = enumerate("page").map((c) => c.label).sort();
    expect(labels).toEqual(["Apply", "Close"]);
  });

  it("with no modal open, the page pass still owns the page", () => {
    document.body.innerHTML = `<main><button aria-label="Search jobs"></button></main>`;
    expect(enumerate("page").map((c) => c.label)).toEqual(["Search jobs"]);
  });
});
