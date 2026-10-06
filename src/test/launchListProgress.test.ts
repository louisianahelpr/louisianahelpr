/**
 * The launch list (owner, 2026-10-05): the header line "Launch list: N left of M"
 * in docs/OPEN.md is generated from the Q numbers between the launch-list
 * markers, and an item counts as left only while its own line is open.
 *
 * @mutate scripts/scoreboard.mjs | const todo = listed.filter((q) => state.get(q) === " ").length; | const todo = 0;
 * @mutate scripts/scoreboard.mjs | const partly = listed.filter((q) => state.get(q) === "~").length; | const partly = 0;
 * @mutate scripts/scoreboard.mjs | (${launch.todo} to do | (${launch.partly} to do
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LAUNCH_LIST_END, LAUNCH_LIST_START, launchListProgress, renderOpenBlock } from "../../scripts/scoreboard.mjs";

const ROOT = join(__dirname, "..", "..");
const OPEN_MD = readFileSync(join(ROOT, "docs/OPEN.md"), "utf8");

describe("launch list progress", () => {
  it("counts a listed item as left only while its own line is open", () => {
    const text = [
      LAUNCH_LIST_START, "- A: Q1, Q2, Q3", LAUNCH_LIST_END,
      "- [ ] **Q1 HIGH a**", "- [~] **Q2 HIGH b**", "- [ ] **Q9 LOW not listed**",
    ].join("\n");
    // Q3 has no open line: ticked and archived, so done.
    expect(launchListProgress(text)).toEqual({ total: 3, todo: 1, partly: 1, left: 2 });
    expect(launchListProgress("no markers")).toBeNull();
  });

  it("the generated header prints that progress", () => {
    const text = [LAUNCH_LIST_START, "- A: Q1, Q2, Q3", LAUNCH_LIST_END, "- [ ] **Q1 HIGH a**", "- [~] **Q2 HIGH b**"].join("\n");
    const local = [{ signal: "OPEN.md queue", fail: 1, pass: 1, skipped: "1" }];
    expect(renderOpenBlock(local, "- **Workflows on main:** x", text)).toMatch(/^- \*\*Launch list: 2 left of 3\*\* \(1 to do, 1 fixed awaiting proof/m);
    expect(renderOpenBlock(local, "- **Workflows on main:** x", "no markers")).not.toMatch(/Launch list/);
  });

  it("OPEN.md's header line matches its own LAUNCH LIST section", () => {
    const p = launchListProgress(OPEN_MD);
    expect(p).not.toBeNull();
    expect(p!.total).toBeGreaterThan(20);
    const line = /^- \*\*Launch list: (\d+) left of (\d+)\*\* \((\d+) to do, (\d+) fixed awaiting proof/m.exec(OPEN_MD);
    expect(line, "the generated Launch list line is missing from docs/OPEN.md").not.toBeNull();
    expect(line!.slice(1).map(Number)).toEqual([p!.left, p!.total, p!.todo, p!.partly]);
  });

  it("every listed item exists (open here, or ticked into the archive)", () => {
    const i = OPEN_MD.indexOf(LAUNCH_LIST_START), j = OPEN_MD.indexOf(LAUNCH_LIST_END);
    const listed = [...new Set([...OPEN_MD.slice(i, j).matchAll(/\bQ(\d+)\b/g)].map((m) => `Q${m[1]}`))];
    expect(listed.length).toBeGreaterThan(20);
    const archive = readFileSync(join(ROOT, "docs/archive/OPEN-done-2026-10.md"), "utf8");
    const missing = listed.filter((q) => !new RegExp(`^- \\[[ ~x.]\\] \\*\\*${q}\\b`, "m").test(OPEN_MD + "\n" + archive));
    expect(missing).toEqual([]);
  });
});
