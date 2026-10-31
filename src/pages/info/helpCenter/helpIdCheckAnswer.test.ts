// AUD31-57: Help's "Do I need an account to browse jobs?" said posting or applying needs "a quick identity check
// through Stripe" while the identity_check switch is off (owner 2026-10-23) and the Terms say no ID is checked.
// @mutate src/pages/info/helpCenter/helpCenterContent.ts |           return identityCheckOn() |           return true
import { afterEach, describe, expect, it } from "vitest";
import { FAQ_SECTIONS } from "./helpCenterContent";
import { setIdentityCheckOn } from "@/lib/identityCheckSwitch";

const answer = () => FAQ_SECTIONS.flatMap((s) => s.items).find((i) => i.q === "Do I need an account to browse jobs?")?.a ?? "";

afterEach(() => setIdentityCheckOn(false));

describe("Help's account answer follows the identity_check switch", () => {
  it("off: no ID check is promised", () => {
    setIdentityCheckOn(false);
    expect(answer()).toMatch(/confirmed email\.$/);
    expect(answer()).not.toMatch(/identity|stripe|\bid\b/i);
  });
  it("on: the ID check is named", () => {
    setIdentityCheckOn(true);
    expect(answer()).toMatch(/quick identity check through Stripe/);
  });
});
