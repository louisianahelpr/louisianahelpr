/**
 * axe's colour-contrast target is unique when axe SCANS, not when the sweep
 * RESOLVES it a moment later (a11y-webkit-prod run 39003252698, nightly-red
 * #2375): on /messages at desktop the rail's "Post a Job" button
 * (DesktopSidebarNav, a radial-gradient fill, so axe says bgGradient) was the
 * only `.rounded-2xl`, axe named it `.rounded-2xl`, and then the lazily loaded
 * swipe trails mounted (ConversationSwipeLayer, two `.rounded-2xl` per
 * conversation row; three rows) and the resolver found 7 matches and failed
 * the gate as "undecidable".
 *
 * measureInPage now keeps only the candidates axe's own node snapshot
 * (`html`) describes. This drives the real page function in jsdom against the
 * real shape: one gradient button plus six aria-hidden trails.
 */
// @mutate e2e/happy-path/contrastResolve.ts | if (described.length === 1) candidates = described; | if (described.length === -1) candidates = described;
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { measureInPage } from "../../e2e/happy-path/contrastResolve";

const BUTTON =
  '<button class="flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3" ' +
  'style="background: radial-gradient(125% 125% at 32% 22%, rgb(110, 116, 80) 0%, rgb(85, 90, 60) 46%, rgb(60, 64, 42) 100%); color: rgb(245, 238, 222);">Post a Job</button>';
const TRAIL = '<div class="absolute inset-y-0 right-0 flex items-center justify-end pr-5 rounded-2xl" aria-hidden="true" style="opacity: 0;"><span>Archive</span></div>';

function mount(): HTMLButtonElement {
  document.body.innerHTML = `<aside>${BUTTON}</aside><ul>${`<li>${TRAIL}${TRAIL.replace("right-0", "left-0")}</li>`.repeat(3)}</ul>`;
  return document.querySelector("button")!;
}

// jsdom has no 2d canvas. The resolver only uses it to normalise colour
// strings, and jsdom's computed colours are already "rgb(...)", which the
// resolver's own fallback parses; a context that keeps what it is given is
// enough. No screenshot is passed, so no pixels are read.
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillStyle: "" } as unknown as CanvasRenderingContext2D);
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("contrast resolver — a selector made ambiguous after axe scanned", () => {
  it("the fixture reproduces the run: the selector matches 7 elements", () => {
    mount();
    expect(document.querySelectorAll(".rounded-2xl").length).toBe(7);
  });

  it("resolves the element axe's own snapshot describes (full outerHTML)", () => {
    const button = mount();
    const [row] = measureInPage({
      items: [{ selector: ".rounded-2xl", need: 4.5, axeReason: "bgGradient", html: button.outerHTML }],
      hasScreenshot: false,
    });
    expect(row.reason ?? "", JSON.stringify(row)).not.toMatch(/matches \d+ elements/);
    expect(row.vanished).not.toBe(true);
    // Known answer: it measured the button, not a trail.
    expect(row.resolved, JSON.stringify(row)).toBe(true);
    expect(row.text).toBe("Post a Job");
  });

  it("resolves it from a truncated opening tag too (axe's ' ...>' form over 300 chars)", () => {
    const button = mount();
    const openTag = button.outerHTML.slice(0, button.outerHTML.indexOf(">"));
    const [row] = measureInPage({
      items: [{ selector: ".rounded-2xl", need: 4.5, axeReason: "bgGradient", html: `${openTag.slice(0, 80)} ...>` }],
      hasScreenshot: false,
    });
    expect(row.reason ?? "", JSON.stringify(row)).not.toMatch(/matches \d+ elements/);
  });

  it("still fails loudly when nothing tells the candidates apart", () => {
    mount();
    for (const html of [null, "<p>not any of them</p>"]) {
      const [row] = measureInPage({
        items: [{ selector: ".rounded-2xl", need: 4.5, axeReason: "bgGradient", html }],
        hasScreenshot: false,
      });
      expect(row.resolved).toBe(false);
      expect(row.reason).toMatch(/matches 7 elements/);
    }
  });
});
