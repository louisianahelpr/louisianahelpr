/**
 * L9 (iOS design audit 11-16): Log in's "Create an account" link, the way to sign up for a newcomer, was a 105x14 tap
 * target. It is now a 44px-tall inline box (min-h-11), its extra height pulled back out of the sentence (-my-3).
 *
 * @mutate src/pages/auth/Login.tsx |             className="-my-3 inline-flex min-h-11 items-center px-1 font-semibold hover:underline whitespace-nowrap" |             className="font-semibold hover:underline whitespace-nowrap"
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";

describe("Log in's sign-up link has a 44px target (L9)", () => {
  it("the bottom 'Create an account' link is a min-h-11 inline box", () => {
    const src = blankComments(readFileSync(join(process.cwd(), "src/pages/auth/Login.tsx"), "utf8"));
    const at = src.indexOf("data-login-signup-link");
    expect(at).toBeGreaterThan(0);
    const open = src.lastIndexOf("<Link", at);
    const tag = src.slice(open, src.indexOf(">", at) + 1);
    const cls = tag.match(/className="([^"]+)"/)?.[1].split(/\s+/) ?? [];
    expect(cls.length).toBeGreaterThan(2);
    expect(cls).toEqual(expect.arrayContaining(["inline-flex", "min-h-11", "items-center"]));
  });
});
