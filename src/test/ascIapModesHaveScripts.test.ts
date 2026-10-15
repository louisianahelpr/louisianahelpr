// @mutate .github/workflows/asc-iap.yml | options: [probe, create, | options: [ghost-mode, probe, create,
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

/*
 * GUARD (docs/OPEN.md Q1683): a script reached only through a dynamic path is
 * still in use. On 2026-10-12 a basename search listed scripts/asc/
 * fix-availability.mjs, inspect.mjs and screenshots.mjs as linked from
 * nowhere, and the owner chose to archive them; but asc-iap.yml runs
 * `node scripts/asc/${{ inputs.mode }}.mjs`, and those three are mode choices.
 * Archiving them would have broken those modes. This pins: every mode the
 * workflow offers has its script at scripts/asc/<mode>.mjs, and the workflow
 * still runs it by that dynamic path.
 */
const root = join(__dirname, "..", "..");
const src = readFileSync(join(root, ".github/workflows/asc-iap.yml"), "utf8");
const wf = parse(src) as Record<string, unknown>;
const on = (wf.on ?? wf["true"]) as { workflow_dispatch: { inputs: { mode: { options: string[] } } } };
const modes = on.workflow_dispatch.inputs.mode.options;

describe("asc-iap.yml's modes each have their script (Q1683)", () => {
  it("inventory: the workflow offers modes and runs scripts/asc/<mode>.mjs", () => {
    expect(modes.length).toBeGreaterThan(4); // 6 on 2026-10-14
    expect(src).toMatch(/run: node scripts\/asc\/\$\{\{ inputs\.mode \}\}\.mjs/);
  });

  it("every mode's script exists at scripts/asc/<mode>.mjs", () => {
    const missing = modes.filter((m) => !existsSync(join(root, "scripts/asc", `${m}.mjs`)));
    expect(missing).toEqual([]);
  });
});
