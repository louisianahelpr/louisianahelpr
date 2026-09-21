import { describe, it, expect, vi, afterEach } from "vitest";
import { osBodyPx, IOS_DEFAULT_BODY_PX } from "@/lib/simpleMode";

/**
 * The Dynamic Type probe. This is the ONE reading of the OS text size in the
 * app — accessibility.ts divides it for `--user-text-scale`, simpleMode
 * thresholds it for the senior-mode class. It used to be two implementations
 * with two gates and two thresholds; see the header in simpleMode.ts.
 */
describe("osBodyPx — Dynamic Type probe", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("answers null when the browser drops `font: -apple-system-body`", () => {
    // Unstubbed jsdom IS the non-Apple browser: it discards the declaration,
    // so the probe inherits its host's sentinel size rather than an OS reading.
    expect(osBodyPx()).toBeNull();
  });

  it("rejects the sentinel rather than reporting it as a measurement", () => {
    // The failure this guards: without an out-of-band host size, a dropped
    // declaration leaves the probe at an ordinary inherited 16px, which reads
    // back as a real measurement and silently pins everyone to ~0.94 scale.
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      fontSize: "99px",
    } as CSSStyleDeclaration);
    expect(osBodyPx()).toBeNull();
  });

  it("returns the OS body size when the keyword resolves", () => {
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (el: Element) =>
        ({
          fontSize: el instanceof HTMLSpanElement ? "21px" : "99px",
        }) as CSSStyleDeclaration,
    );
    expect(osBodyPx()).toBe(21); // Dynamic Type "xxLarge"
  });

  it("does not consult CSS.supports", () => {
    // WebKit has answered false for the system-font keywords in the `font`
    // shorthand while still resolving them. Reading the gate would discard a
    // good measurement on exactly the platform this exists to serve.
    const cssObj = CSS as unknown as { supports?: (p: string, v?: string) => boolean };
    const hadSupports = "supports" in cssObj;
    const supports = vi.fn(() => false);
    cssObj.supports = supports;
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (el: Element) =>
        ({
          fontSize: el instanceof HTMLSpanElement ? "28px" : "99px",
        }) as CSSStyleDeclaration,
    );

    expect(osBodyPx()).toBe(28);
    expect(supports).not.toHaveBeenCalled();

    if (!hadSupports) delete cssObj.supports;
  });

  it("leaves no probe nodes in the document", () => {
    const before = document.documentElement.childElementCount;
    osBodyPx();
    osBodyPx();
    expect(document.documentElement.childElementCount).toBe(before);
  });

  it("pins the default rung so the scale divisor stays 1.0 at default", () => {
    expect(IOS_DEFAULT_BODY_PX).toBe(17);
  });
});

// The sentinel only discriminates while the plausible-band ceiling sits below
// it. Widen the band past 99 and a browser that DROPPED `font: -apple-system-
// body` hands its host size straight back and is read as a real Dynamic Type
// measurement — which is the silent false positive this probe was rebuilt to
// remove, and it pins every non-Apple user to a scale nobody asked for.
// @mutate src/lib/simpleMode.ts | const MAX_BODY_PX = 60; | const MAX_BODY_PX = 200;
// The probe must leave nothing behind: it runs on every visibilitychange.
// @mutate src/lib/simpleMode.ts | host.remove(); | void 0;
// The divisor for `--user-text-scale`. 17 is iOS "Large"; any other value
// scales every user's type at the DEFAULT OS setting.
// @mutate src/lib/simpleMode.ts | export const IOS_DEFAULT_BODY_PX = 17; | export const IOS_DEFAULT_BODY_PX = 16;
