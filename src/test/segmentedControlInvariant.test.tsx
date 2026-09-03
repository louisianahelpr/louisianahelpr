import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

/**
 * ONE SEGMENTED CONTROL.
 *
 * Four different visual languages used to answer the same "pick one of N"
 * question, measured on a production bundle 2026-09-02:
 *
 *   Analytics "12 months"            olive gloss      9999px
 *   Earnings range toggle            olive gloss      9999px
 *   Accessibility Light/Auto/Dark    flat bark 12%    0px
 *   Earnings view switcher           parchment        8px
 *
 * The fourth is the one that made this a defect rather than an inconsistency:
 * parchment IS the page canvas, so the selected quarter of the Earnings tab
 * was painted the colour of the paper behind it. And two of the four shipped
 * 140px apart on that same screen.
 *
 * WHAT WOULD MAKE THIS TEST USELESS, and what is done about it:
 *
 *  1. A HAND-WRITTEN LIST OF THE CONTROLS. A registry that is both the test's
 *     input and its definition of correctness cannot fail for a missing
 *     member — a fifth control simply would not be in the list. So the subject
 *     set is derived from the tree: every intrinsic container in `src` that
 *     LOOKS like a segmented track (rounded + a segment-gap padding + its own
 *     background) in a file that also paints a selected state conditionally.
 *     Run against the pre-unification commit this finds twelve files; run
 *     against this one it finds only the two that opt out in their own source.
 *
 *  2. ASSERTING A CLASS NAME. `btn-grad-primary` on an element proves
 *     nothing: an inline `background` SHORTHAND resets `background-image`, and
 *     a Tailwind variant over a hand-written class
 *     (`data-[state=checked]:btn-grad-primary`) compiles to no CSS at all.
 *     Both are how a control can carry every correct class and render flat. So
 *     the class-name checks below are paired with a check that the class
 *     RESOLVES to a real gradient in `index.css`, and that the component
 *     toggles it as a plain class rather than through a variant.
 *
 * The final proof — computed `background-image` on a real selected segment in
 * a built bundle — is not available to jsdom, which loads no CSS. It belongs
 * to the Playwright pass over `vite preview`.
 */

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

const tsxFiles = (): string[] =>
  execFileSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter((f) => f.endsWith(".tsx") && !/\.test\./.test(f));

const stripComments = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * A segmented TRACK: an intrinsic container (not a Radix `PopoverContent` or
 * `TabsList`, which are their own primitives) that is rounded, carries the
 * small padding that makes a row of segments sit inside a rail, and paints
 * itself — by utility or by inline style.
 */
const CONTAINER_TAG = /<(?:div|nav|ul|ol|span|section|fieldset)\b([^>]*)>/gs;
const TRACK_PADDING = /(?:^|[\s"`{])p-(?:0\.5|1|1\.5)(?=[\s"`}]|$)/;
const TRACK_PAINT = /(?:^|[\s"`{])bg-\S|background(?:Color)?\s*:/;

/** A selected-ness identifier, and a background paint, on the same ternary. */
const SELECTEDNESS = /\b(?:active|selected|isActive|isSelected|checked|Active|Selected)\b/;
const PAINT_TOKEN = /btn-grad-primary|(?:^|[\s"`{])bg-[a-z[]|background(?:Color|Image)?\s*:/;

/**
 * The opt-out. A file that genuinely is not this control writes the marker in
 * its own source, next to the thing it is exempting, where a reviewer reads
 * it. That is deliberately different from an allowlist kept in this file: the
 * exemption has to be committed at the site, and the test still enumerates
 * every one of them below so the set cannot grow silently.
 */
const EXEMPT_MARKER = "@segmented-control-exempt";

interface HandRolled {
  file: string;
  track: string;
}

function findHandRolledControls(): HandRolled[] {
  const found: HandRolled[] = [];
  for (const file of tsxFiles()) {
    if (file.endsWith("ui/SegmentedControl.tsx")) continue;
    const src = stripComments(read(file));
    // Delegating to the shared component is the whole point — a file that
    // renders it is done, whatever else it draws.
    if (/<SegmentedControl\b/.test(src)) continue;

    const tracks: string[] = [];
    for (const m of src.matchAll(CONTAINER_TAG)) {
      const attrs = m[1];
      if (!/rounded/.test(attrs)) continue;
      if (!TRACK_PADDING.test(attrs)) continue;
      if (!TRACK_PAINT.test(attrs)) continue;
      tracks.push(attrs.replace(/\s+/g, " ").trim().slice(0, 120));
    }
    if (tracks.length === 0) continue;

    let paintsSelection = false;
    for (const m of src.matchAll(/\?/g)) {
      const before = src.slice(Math.max(0, m.index - 160), m.index);
      const after = src.slice(m.index, m.index + 220);
      if (SELECTEDNESS.test(before) && PAINT_TOKEN.test(before + after)) {
        paintsSelection = true;
        break;
      }
    }
    if (paintsSelection) found.push({ file, track: tracks[0] });
  }
  return found;
}

describe("one segmented control, and it is glossy", () => {
  it("no file outside SegmentedControl.tsx hand-paints a selected segment", () => {
    const offenders = findHandRolledControls().filter(
      // Read from the FILE, not from a list here: an exemption has to be
      // written where the control is.
      ({ file }) => !read(file).includes(EXEMPT_MARKER),
    );
    expect(
      offenders.map((o) => `${o.file}\n      track: ${o.track}`),
      "A segmented control must render <SegmentedControl /> " +
        "(src/components/ui/SegmentedControl.tsx). If this is genuinely a " +
        `different control, say so in its own source with ${EXEMPT_MARKER} ` +
        "and a reason.",
    ).toEqual([]);
  });

  it("the exemptions are the two known ones and nothing has quietly joined them", () => {
    // The detector is deliberately allowed to reach these two; the assertion
    // is that the set has not grown. Both wear the canonical `btn-grad-primary`
    // gloss already — what exempts them is structure, not paint.
    //   SubscriptionTab   a framer `layoutId` pill that SLIDES between
    //                     segments, plus a 44px refresh button inside the same
    //                     grid. Both were owner-specified.
    //   HowItWorksSection a marketing tablist on the landing page whose track
    //                     material was owner-matched to the hero's "Browse
    //                     Jobs" button.
    const exempt = findHandRolledControls()
      .filter(({ file }) => read(file).includes(EXEMPT_MARKER))
      .map((o) => o.file)
      .sort();
    expect(exempt).toEqual([
      "src/components/landing/HowItWorksSection.tsx",
      "src/components/profile/SubscriptionTab.tsx",
    ]);
  });

  it("the canonical selected paint resolves to a real gradient", () => {
    // The class name is not the evidence. `.btn-grad-primary` has to actually
    // declare a gradient, or every assertion about "the glossy one" above is
    // true of a flat control.
    const css = read("src/index.css");
    const rule = css.slice(css.indexOf(".btn-grad-primary {"));
    const body = rule.slice(0, rule.indexOf("}"));
    expect(body).toMatch(/background-image:\s*radial-gradient\(/);
    expect(body).toMatch(/--bark-light/);
    expect(body).toMatch(/--bark-deep/);

    // And the shared paint classes have to exist, or the selected segment is
    // an unstyled button wearing a name.
    for (const cls of [".segmented-track {", ".segmented-option {", ".segmented-option-selected {"]) {
      expect(css, `${cls} missing from index.css`).toContain(cls);
    }
  });

  it("the gloss is toggled as a plain class, never through a Tailwind variant", () => {
    // `data-[state=checked]:btn-grad-primary` emits NO CSS — Tailwind variants
    // only compose over utilities Tailwind itself generates, and this class is
    // hand-written in index.css. A control that used the variant form would
    // look correct in the markup and render flat.
    const src = read("src/components/ui/SegmentedControl.tsx");
    expect(src).not.toMatch(/[\w[\]=-]+:btn-grad-primary/);
    expect(src).toMatch(/active && "btn-grad-primary segmented-option-selected"/);

    // And nothing in the component may set the `background` SHORTHAND, which
    // silently resets `background-image` and is exactly how the Earnings view
    // switcher ended up canvas-coloured.
    expect(src).not.toMatch(/\bbackground:\s/);
  });
});

describe("SegmentedControl behaviour", () => {
  const OPTIONS = [
    { value: "a", label: "Alpha" },
    { value: "b", label: "Beta" },
    { value: "c", label: "Gamma" },
  ];

  type Overrides = {
    semantics?: "radio" | "tab";
    value?: string | null;
    disabled?: boolean;
  };

  const renderControl = (props: Overrides = {}) => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        ariaLabel="Test group"
        options={OPTIONS}
        value="a"
        onChange={onChange}
        {...props}
      />,
    );
    return { onChange };
  };

  it("is a radiogroup by default and a tablist on request", () => {
    renderControl();
    expect(screen.getByRole("radiogroup", { name: "Test group" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Alpha" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Beta" })).toHaveAttribute("aria-checked", "false");
    cleanup();

    renderControl({ semantics: "tab" });
    expect(screen.getByRole("tablist", { name: "Test group" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute("aria-selected", "true");
  });

  it("puts the gloss on the selected segment and nowhere else", () => {
    renderControl({ value: "b" });
    const selected = screen.getByRole("radio", { name: "Beta" });
    const other = screen.getByRole("radio", { name: "Alpha" });
    expect(selected.className).toContain("btn-grad-primary");
    expect(selected.className).toContain("segmented-option-selected");
    expect(other.className).not.toContain("btn-grad-primary");
    // No inline background anywhere — see the shorthand trap above.
    expect(selected.getAttribute("style") ?? "").not.toContain("background");
  });

  it("holds every segment to the 44px tap target, radio semantics included", () => {
    // index.css's bare `button { min-height: 44px }` explicitly SKIPS
    // `[role="radio"]`, so this is the one variant that could render short if
    // the class were dropped.
    renderControl();
    for (const name of ["Alpha", "Beta", "Gamma"]) {
      expect(screen.getByRole("radio", { name }).className).toContain("min-h-11");
    }
  });

  it("is one stop in the tab order, not one per option", () => {
    renderControl({ value: "b" });
    expect(screen.getByRole("radio", { name: "Alpha" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("radio", { name: "Beta" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Gamma" })).toHaveAttribute("tabindex", "-1");
  });

  it("moves the selection with the arrow keys, wrapping at both ends", () => {
    // The control is controlled and `onChange` is a spy, so `value` stays put
    // between presses — every assertion here is "from B, this key asks for X".
    const { onChange } = renderControl({ value: "b" });
    const group = screen.getByRole("radiogroup");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("c");
    fireEvent.keyDown(group, { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith("c");
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("a");
    fireEvent.keyDown(group, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith("a");
    fireEvent.keyDown(group, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("c");
    cleanup();

    // Wrapping: left off the first option lands on the last, not nowhere.
    const wrapped = renderControl({ value: "a" });
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowLeft" });
    expect(wrapped.onChange).toHaveBeenLastCalledWith("c");
  });

  it("does not re-fire onChange for the option already selected", () => {
    const { onChange } = renderControl({ value: "a" });
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "Home" });
    fireEvent.click(screen.getByRole("radio", { name: "Alpha" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores the arrow keys while disabled", () => {
    const { onChange } = renderControl({ disabled: true });
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("radio", { name: "Beta" })).toBeDisabled();
  });

  it("accepts no selection at all, and the arrows enter the set from there", () => {
    const { onChange } = renderControl({ value: null });
    for (const name of ["Alpha", "Beta", "Gamma"]) {
      expect(screen.getByRole("radio", { name })).toHaveAttribute("aria-checked", "false");
    }
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("a");
  });

  it("names a count rather than trailing loose digits", () => {
    render(
      <SegmentedControl
        ariaLabel="Inbox"
        options={[
          { value: "unread", label: "Unread", count: 3, countLabel: "3 unread" },
          { value: "all", label: "All", count: 0 },
        ]}
        value="unread"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("radio", { name: /Unread/ })).toHaveTextContent("3");
    expect(screen.getByText("3 unread")).toBeInTheDocument();
    // A zero count is not rendered as "0".
    expect(screen.getByRole("radio", { name: "All" })).toHaveTextContent(/^All$/);
  });
});
