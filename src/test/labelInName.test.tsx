import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { render, screen, cleanup } from "@testing-library/react";
import { Wrench } from "lucide-react";
import { JobActionChip } from "@/components/activity/JobActionRow";

/**
 * `aria-label` MUST NOT REPLACE A VISIBLE LABEL — WCAG 2.5.3 Label in Name.
 *
 * `aria-label` does not annotate the visible text; it OVERWRITES it. So a
 * button that reads "Hire Again" and carries
 * `aria-label="Hire this Helpr again"` has an accessible name that does not
 * contain the words on its own face. A voice-control user says "click Hire
 * Again" and nothing happens — the only words that work are ones they cannot
 * see. This is a failure a per-screen visual audit structurally cannot catch:
 * the screen looks right, and the defect is in an attribute.
 *
 * `JobActionRow.tsx` already solves it properly, with `composeAccessibleName`:
 * visible label first (what a voice user says), context appended (what a screen
 * reader user needs), and the prefix skipped when the caller's string already
 * opens with the label. This file (a) proves that behaviour holds at runtime,
 * and (b) sweeps every OTHER element in the codebase for the same defect.
 */

const ROOT = resolve(__dirname, "../..");

function tsxFiles(): string[] {
  return execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((f) => f.endsWith(".tsx") && !/\.test\./.test(f))
    .filter((f) => existsSync(resolve(ROOT, f)));
}

const stripComments = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// ---------------------------------------------------------------------------
// 1 — the runtime contract, on the component that takes both
// ---------------------------------------------------------------------------

describe("a component taking BOTH a visible label and an ariaLabel", () => {
  it("the accessible name CONTAINS the visible text", () => {
    cleanup();
    render(
      <JobActionChip
        icon={Wrench}
        label="Hire Again"
        tone="neutral"
        onClick={() => {}}
        ariaLabel="Hire this Helpr again"
      />,
    );
    const name = screen.getByRole("button").getAttribute("aria-label")!;
    expect(
      name.toLowerCase().includes("hire again"),
      `the chip's accessible name is "${name}", which does not contain its visible text ` +
        `"Hire Again". A voice-control user can only say words that are IN the accessible ` +
        `name (WCAG 2.5.3), and the only words they can SEE are the visible ones. ` +
        `Compose — do not substitute. See composeAccessibleName in ` +
        `src/components/activity/JobActionRow.tsx.`,
    ).toBe(true);
    // …and the context must survive too: dropping it would trade one user group
    // for the other.
    expect(name, "the screen-reader context was dropped instead of appended").toMatch(/Helpr/);
  });

  it("does not double the label when the caller already opens with it", () => {
    cleanup();
    render(
      <JobActionChip
        icon={Wrench}
        label="Hire Again"
        tone="neutral"
        onClick={() => {}}
        ariaLabel="Hire Again — this Helpr, on a new job"
      />,
    );
    const name = screen.getByRole("button").getAttribute("aria-label")!;
    expect(
      (name.toLowerCase().match(/hire again/g) ?? []).length,
      `"${name}" repeats the visible label — a screen reader says it twice`,
    ).toBe(1);
  });

  it("with NO ariaLabel the visible text is left to be the name", () => {
    cleanup();
    render(<JobActionChip icon={Wrench} label="Message" tone="neutral" onClick={() => {}} />);
    expect(
      screen.getByRole("button").getAttribute("aria-label"),
      "an aria-label was synthesised where none was asked for — the visible text is " +
        "already a perfectly good accessible name, and an invented one can only diverge",
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2 — the codebase-wide sweep
// ---------------------------------------------------------------------------

describe("no element's aria-label overwrites its own visible text", () => {
  /**
   * The structural rule, at the level the defect actually lives.
   *
   * A static sweep of `<button aria-label="…">Text</button>` finds almost
   * nothing here (exactly one element in the whole tree), because this codebase
   * builds controls out of components: the visible label and the accessible
   * name arrive as two PROPS, `label` and `ariaLabel`, and the substitution
   * happens inside the component where no per-screen review will ever look.
   *
   * So the rule to enforce is: a component that accepts BOTH must DERIVE the
   * accessible name from the visible one. `aria-label={ariaLabel}` beside
   * `<p>{label}</p>` is the defect, even when today's four call sites happen to
   * pass strings that contain their labels — because nothing makes the fifth
   * one do so.
   */
  it("a component taking both `label` and `ariaLabel` derives one from the other", () => {
    /** ariaLabel names a GROUP, not the labelled control — a different scope. */
    const GROUP_LABEL: Record<string, string> = {
      "src/components/ui/UnderlineTabs.tsx":
        "ariaLabel names the tablist; `label` is per-tab and is its own tab's visible name",
    };

    const offenders: string[] = [];
    for (const file of tsxFiles()) {
      if (file in GROUP_LABEL) continue;
      const src = stripComments(readFileSync(resolve(ROOT, file), "utf8"));
      // A props type declaring both.
      if (!/\blabel\s*\??\s*:\s*string/.test(src)) continue;
      if (!/\bariaLabel\s*\??\s*:\s*string/.test(src)) continue;
      // Does ANY aria-label in the file mention `label`, directly or through a
      // composing helper? One that does is the file taking the rule seriously.
      const composes = [...src.matchAll(/aria-label=\{([^}]*)\}/g)].some((m) =>
        /\blabel\b/.test(m[1]),
      );
      if (composes) continue;
      offenders.push(
        `${file} — declares both a visible \`label: string\` and an \`ariaLabel: string\`, ` +
          `and every aria-label it renders uses ariaLabel ALONE. The accessible name then ` +
          `REPLACES the words on screen (WCAG 2.5.3): a voice-control user can only say ` +
          `what is in the name, and the only words they can see are the visible ones. ` +
          `Compose them — copy composeAccessibleName from ` +
          `src/components/activity/JobActionRow.tsx — or, if ariaLabel names a GROUP rather ` +
          `than the labelled control, add the file to GROUP_LABEL with that reason.`,
      );
    }
    expect(
      offenders,
      "components whose aria-label substitutes for their visible label:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("every aria-label on an element with visible text contains that text", () => {
    /**
     * The pattern being hunted:
     *
     *     <button aria-label="Hire this Helpr again">Hire Again</button>
     *
     * i.e. a LITERAL aria-label and a LITERAL text child on the same element.
     * Interpolated names (`aria-label={`${label} — …`}`) are out of scope for a
     * static sweep — that is what the runtime block above is for — and elements
     * with no text child (an icon-only button) are the case aria-label is FOR.
     */
    const OPEN = /<(button|a|Button|Link)\b([^>]*?)>([^<]{1,60})</g;
    const offenders: string[] = [];
    let examined = 0;

    for (const file of tsxFiles()) {
      const src = stripComments(readFileSync(resolve(ROOT, file), "utf8"));
      for (const m of src.matchAll(OPEN)) {
        const [, tag, attrs, text] = m;
        const aria = /aria-label=["']([^"']+)["']/.exec(attrs);
        if (!aria) continue;
        // ANY brace in the child means the label is computed, so what a regex
        // can see is a fragment of an expression, not the rendered words —
        // `{sendingTest ? (` is not a visible label. Computed names are the
        // runtime block's job, above.
        if (/[{}]/.test(text)) continue;
        const visible = text.replace(/\s+/g, " ").trim();
        // No literal visible text (icon-only) → the aria-label is the name
        // rather than a replacement for one, which is exactly what it is for.
        if (!visible || !/[A-Za-z]{2}/.test(visible)) continue;
        examined++;
        const name = aria[1].toLowerCase();
        const words = visible.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
        if (!words.length) continue;
        if (words.every((w) => name.includes(w))) continue;
        offenders.push(
          `${file}:${src.slice(0, m.index).split("\n").length} — <${tag}> shows "${visible}" ` +
            `but its accessible name is "${aria[1]}". A voice-control user can only say ` +
            `what is IN the name (WCAG 2.5.3). Put the visible words first and append the ` +
            `context: aria-label="${visible} — ${aria[1]}".`,
        );
      }
    }
    expect(
      offenders,
      "aria-labels that overwrite visible text:\n  " + offenders.join("\n  "),
    ).toEqual([]);
    // A green sweep that looked at nothing is worse than no sweep — it reads as
    // proof. This one legitimately has a tiny surface (the codebase builds
    // controls out of components, so almost every accessible name is computed —
    // which is why the PROP-LEVEL assertion above is the one that carries the
    // weight), but it must still be looking at SOMETHING.
    expect(
      examined,
      "the sweep examined no <button>/<a>/<Button> with BOTH a literal aria-label and " +
        "literal visible text. The matcher has stopped matching — check OPEN against " +
        "how these elements are written now, or this test is passing vacuously.",
    ).toBeGreaterThan(0);
  });

  it("the composing helper is still the shared pattern, not a one-off", () => {
    // If composeAccessibleName is deleted or inlined, every JobActionChip call
    // site silently reverts to substitution — and there are dozens.
    const src = readFileSync(resolve(ROOT, "src/components/activity/JobActionRow.tsx"), "utf8");
    expect(
      src,
      "composeAccessibleName is gone from JobActionRow.tsx — every chip with an ariaLabel " +
        "has reverted to REPLACING its visible label",
    ).toContain("composeAccessibleName");
    expect(
      src,
      "composeAccessibleName no longer prefixes the visible label onto the aria-label",
    ).toMatch(/starts \? ariaLabel : `\$\{label\}/);
  });
});
