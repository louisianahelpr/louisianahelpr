// @vitest-environment jsdom
/**
 * #1582 (run 36069319716): the press log printed at most FOUR failures per row
 * and no reason for any unpressed control, so shard 2's "90 control(s)
 * unpressed without a documented reason" and Q389(b)'s admin rows could not
 * be traced from the log, and the shard artifacts (coverage.md, screenshots)
 * cannot be downloaded where the red is triaged. Every failed press and every
 * undocumented skip now gets its own full line, and a "control not found"
 * reason says what the reloaded screen held instead.
 *
 * @mutate scripts/audit/pressFailureClass.mjs | c.result === "SKIP" && !documented.has(c.why ?? "") | c.result === "SKIP" && documented.has(c.why ?? "")
 * @mutate scripts/audit/press-every-control.mjs | documented: DOCUMENTED_SKIPS })) console.log(l); | documented: DOCUMENTED_SKIPS })) void l;
 * @mutate scripts/audit/press-every-control.mjs |             entry.why += " " + (await page.evaluate(RELOADED_SCREEN, | void (await page.evaluate(RELOADED_SCREEN,
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { rowDetailLines } from "../../scripts/audit/pressFailureClass.mjs";

const ROOT = resolve(__dirname, "..", "..");
const harness = blankComments(readFileSync(resolve(ROOT, "scripts/audit/press-every-control.mjs"), "utf8"));
const documented = new Set(["disabled (inert by design)"]);

describe("the press log names every failure and every undocumented skip (#1582)", () => {
  it("prints all failures, not the first four, with the full reason", () => {
    const long = "NOT CLICKABLE (covered): " + "x".repeat(580);
    const controls = Array.from({ length: 6 }, (_, i) => ({ chain: ["Menu", `Item ${i}`], result: "FAIL", why: i === 5 ? long : `no observable change ${i}` }));
    const lines = rowDetailLines({ route: "/admin?view=people", persona: "admin", controls, documented });
    expect(lines).toHaveLength(6);
    expect(lines[5]).toContain(long);
    expect(lines[0]).toBe('[/admin?view=people admin]   FAIL "Menu › Item 0" — no observable change 0');
  });

  it("prints an undocumented skip with its reason, and never a documented skip or a pass", () => {
    const lines = rowDetailLines({
      route: "/profile?tab=notifications",
      persona: "customer",
      documented,
      controls: [
        { chain: ["Push"], result: "SKIP", why: "a reason nobody documented" },
        { chain: ["Save"], result: "SKIP", why: "disabled (inert by design)" },
        { chain: ["Back"], result: "PASS", why: "" },
      ],
    });
    expect(lines).toEqual(['[/profile?tab=notifications customer]   UNDOCUMENTED SKIP "Push" — a reason nobody documented']);
  });

  it("the harness prints those lines for every row, judged against its own DOCUMENTED_SKIPS", () => {
    expect(harness).toMatch(/for \(const l of rowDetailLines\(\{ route: route\.url, persona, controls: rec\.controls, documented: DOCUMENTED_SKIPS \}\)\) console\.log\(l\);/);
  });

  it("a control-not-found reason carries what the reloaded screen held", async () => {
    expect(harness).toMatch(/entry\.why \+= " " \+ \(await page\.evaluate\(RELOADED_SCREEN,/);
    // @ts-expect-error - plain .mjs tool script, no types
    const mod = await import("../../scripts/audit/press-every-control.mjs");
    document.body.innerHTML = `<div><div data-index="3"><button>Row 3</button></div><div data-index="4"><button>Row 4</button></div></div>`;
    const said = (mod as unknown as { RELOADED_SCREEN: (a: { controlSel: string; label: string }) => string }).RELOADED_SCREEN({ controlSel: "button", label: "Row 9" });
    expect(said).toContain("2 control(s)");
    expect(said).toContain("2 virtual row(s) mounted, index 3-4");
    expect(said).toContain("label text absent");
  });
});
