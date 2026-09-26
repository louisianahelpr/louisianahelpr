/**
 * The vacuity gate must apply each @mutate exactly as written. It used
 * String#replace with a string, which expands `$$`/`$&`, so a mutation
 * containing `$$` ran as something else and a real guard reported SURVIVED.
 *
 * @mutate scripts/vacuity/lib.mjs | return source.replace(find, () => replace); | return source.replace(find, replace);
 */
import { describe, expect, it } from "vitest";
import { applyMutation } from "../../scripts/vacuity/lib.mjs";

describe("vacuity applies mutations literally", () => {
  it.each([
    ["pay $${formatPrice(fee)}", "pay $${fee}"],
    ["a", "$&$&"],
    ["a", "$`x$'"],
  ])("%s -> %s", (find, replace) => {
    expect(applyMutation(`<${find}>`, find, replace)).toBe(`<${replace}>`);
  });
  it("replaces only the first occurrence", () => {
    expect(applyMutation("aa", "a", "b")).toBe("ba");
  });
});
