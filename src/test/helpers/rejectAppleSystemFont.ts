import { vi } from "vitest";

/**
 * Make the test DOM behave like a non-Apple browser for the `-apple-system-*` font keywords: the `font:`
 * declaration naming one is dropped when the style is parsed, so the element inherits its parent's size.
 *
 * Why this is explicit: osBodyPx() (src/lib/simpleMode.ts) relies on exactly that drop. jsdom 30 dropped the
 * declaration on its own; jsdom 31 keeps it (`style.font` reads "-apple-system-body") and computes the probe at
 * the 16px initial size, which is no browser's behaviour (measured 11-15, jsdom 30.1.3 vs 31.0.0). The tests that
 * mean "the keyword is unsupported" say so with this instead of leaning on one jsdom version.
 *
 * It wraps the nearest `cssText` setter on the style's prototype chain (the probe writes `style.cssText`); undo it
 * with vi.restoreAllMocks().
 */
export function rejectAppleSystemFont(): void {
  let owner: object | null = Object.getPrototypeOf(document.createElement("span").style);
  while (owner && !Object.prototype.hasOwnProperty.call(owner, "cssText")) owner = Object.getPrototypeOf(owner);
  if (!owner) throw new Error("rejectAppleSystemFont: no cssText accessor on CSSStyleDeclaration's chain");
  const set = Object.getOwnPropertyDescriptor(owner, "cssText")?.set;
  if (!set) throw new Error("rejectAppleSystemFont: cssText has no setter");
  vi.spyOn(owner as CSSStyleDeclaration, "cssText", "set").mockImplementation(function (this: CSSStyleDeclaration, v: string) {
    set.call(this, v.replace(/(^|;)\s*font\s*:\s*-apple-system-[\w-]+\s*(;|$)/g, "$1"));
  });
}
