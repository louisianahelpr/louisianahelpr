/*
 * GUARD (docs/OPEN.md Q981): the 88px profile avatar BUTTON is round.
 *
 * Owner, 2026-09-11: "remove the rectangle or square". The button carries the
 * tier ring as a boxShadow, and a boxShadow traces its own element, so while
 * the button was `rounded-ds-avatar squircle` (a rounded square) the ring
 * drew a squircle around the circular photo and its corners read as a stray
 * square behind it. 37d37c53f made the button `rounded-full overflow-hidden`.
 * Nothing failed if that came back.
 */
// @mutate src/components/profile/profileLanding/IdentityHeader.tsx | className="w-[88px] h-[88px] rounded-full overflow-hidden active:scale-[0.98] transition-transform" | className="w-[88px] h-[88px] rounded-ds-avatar squircle active:scale-[0.98] transition-transform"
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(__dirname, "..", "components", "profile", "profileLanding", "IdentityHeader.tsx"), "utf8");

/** The opening tag of the button that frames the avatar (the one labelled Edit profile / Add a profile photo). */
function avatarButtonTag(): string {
  const at = SRC.indexOf('aria-label={showsPhoto ? "Edit profile" : "Add a profile photo"}');
  expect(at, "the avatar button's aria-label moved; re-point this guard").toBeGreaterThan(0);
  const start = SRC.lastIndexOf("<button", at);
  const end = SRC.indexOf(">", SRC.indexOf("boxShadow", at));
  return SRC.slice(start, end);
}

describe("profile avatar button (Q981)", () => {
  it("is round and clips, so the tier ring traces a circle", () => {
    const tag = avatarButtonTag();
    const cls = /className="([^"]+)"/.exec(tag)?.[1] ?? "";
    expect(cls.split(/\s+/)).toEqual(expect.arrayContaining(["rounded-full", "overflow-hidden"]));
    expect(cls).not.toMatch(/squircle|rounded-ds-avatar/);
  });

  it("still wears the tier ring on that same element", () => {
    expect(avatarButtonTag()).toMatch(/boxShadow:\s*tierChip\?\.avatarRing/);
  });
});
