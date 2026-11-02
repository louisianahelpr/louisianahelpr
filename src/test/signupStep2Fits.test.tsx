/**
 * Auditor 8's sign-up Lows (audit 11-01, ~/.lh-shots/audit-1101-a3.md):
 * - A3-101: sign-up step 2 sat in `page-measure` (AuthShell's "2xl", 1,344 px at 1440) while step 1 sits in a 384 px
 *   card, on a screen with no nav above it. Step 2 now uses one of AuthShell's capped widths.
 * - A3-102: the optional ZIP box's placeholder "70801" read as a ZIP already filled in, on sign-up step 2 and Complete
 *   Profile. It now reads "e.g. 70801" (es "p. ej. 70801"), from the dictionary.
 *
 * @mutate src/pages/auth/Signup.tsx | maxWidth={step === 1 ? "sm" : "lg"} | maxWidth={step === 1 ? "sm" : "2xl"}
 * @mutate src/lib/i18n/enScreens.ts |   "signup.zipExample": "e.g. 70801", |   "signup.zipExample": "70801",
 * @mutate src/pages/auth/signup/SignupStep2.tsx | placeholder={t("signup.zipExample")} | placeholder="70801"
 * @mutate src/pages/auth/CompleteProfile.tsx | placeholder={t("signup.zipExample")} | placeholder="70801"
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { blankComments } from "./helpers/blankNonCode";
import { SignupStep2, type SignupStep2Props } from "@/pages/auth/signup/SignupStep2";

vi.mock("@/components/postjob/CityAutocomplete", () => ({ CityAutocomplete: () => <input id="location" /> }));

const ROOT = process.cwd();
const code = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

describe("A3-101: sign-up step 2 keeps a capped, centred column", () => {
  it("Signup passes AuthShell a width for step 2, and that width is capped (not page-measure)", () => {
    const signup = code("src/pages/auth/Signup.tsx");
    const m = signup.match(/maxWidth=\{step === 1 \? "(\w+)" : "(\w+)"\}/);
    expect(m, "Signup.tsx's step 1 / step 2 maxWidth").not.toBeNull();
    const shell = code("src/components/auth/AuthShell.tsx");
    const width = (key: string) => shell.match(new RegExp(`(?:^|\\s)"?${key}"?:\\s*"([^"]+)"`, "m"))?.[1] ?? null;
    const step2 = width(m![2]);
    expect(step2, `AuthShell's widthMap entry for "${m![2]}"`).not.toBeNull();
    expect(step2).not.toContain("page-measure");
    expect(step2).toMatch(/max-w-/);
  });
});

describe("A3-102: the ZIP placeholder reads as an example", () => {
  const noop = () => {};
  const props: SignupStep2Props = {
    avatarPreview: null, onAvatarChange: noop, location: "", setLocation: noop, zipCode: "", setZipCode: noop,
    bio: "", setBio: noop, referralCode: "", setReferralCode: noop, inputCls: "", labelCls: "",
    onContinue: noop, onSkip: noop,
  };
  it("sign-up step 2 shows e.g. 70801", () => {
    const { container } = render(<SignupStep2 {...props} />);
    expect(container.querySelector<HTMLInputElement>("#zipCode")?.placeholder).toBe("e.g. 70801");
  });
  it("Complete Profile takes the same words (no bare ZIP placeholder left in either screen)", () => {
    for (const rel of ["src/pages/auth/CompleteProfile.tsx", "src/pages/auth/signup/SignupStep2.tsx"]) {
      const src = code(rel);
      expect(src, rel).toContain('placeholder={t("signup.zipExample")}');
      expect(src, rel).not.toMatch(/placeholder="\d{5}"/);
    }
  });
});
