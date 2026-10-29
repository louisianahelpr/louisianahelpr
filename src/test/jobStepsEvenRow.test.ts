import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The job page's step tracker sat on two heights (owner 2026-10-25, "step
 * labels uneven"): a step with a time is a 44px <button>, and a button centres
 * its content, so those steps sat ~2px under the plain ones (measured live:
 * labels at 188.3 vs 186.1). The button must top-align its content, and the
 * wrapper inside it must be a block, so both kinds start at the top.
 *
 * @mutate src/components/tracker/JobProgress.tsx | className="flex flex-col justify-start w-[calc(100%+4px)] | className="flex flex-col w-[calc(100%+4px)]
 */
const src = readFileSync(resolve(__dirname, "../components/tracker/JobProgress.tsx"), "utf8");

describe("every step of the tracker sits on one line", () => {
  it("the step button top-aligns its content", () => {
    const btn = src.slice(src.indexOf("data-step-tip={i}"));
    const cls = btn.match(/className="([^"]*min-h-\[44px\][^"]*)"/)?.[1] ?? "";
    expect(cls.split(/\s+/)).toEqual(expect.arrayContaining(["flex", "flex-col", "justify-start"]));
    expect(btn).toMatch(/<span aria-hidden="true" className="block">\{body\}<\/span>/);
  });
});
