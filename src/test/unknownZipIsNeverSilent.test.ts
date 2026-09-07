// An unrecognised ZIP must never be silent — on any of the three screens that
// collect one.
//
// The defect this file exists to prevent, found 2026-09-06:
// `louisiana_zip_parishes` held 252 of Louisiana's 720 ZIP codes, so nearly two
// thirds of the state resolved to `parish = NULL`. Parish is what places a
// member who has not granted device geolocation, which is most of them:
// `get_ranked_open_jobs` ranks on it and the helper job-match fan-out matches
// on `p.parish = NEW.parish`, neither of which consults a coordinate. A NULL
// parish is an account that nothing reaches.
//
// The table is complete now, which removes the cause but not the class. An
// out-of-state ZIP, a typo, or a future gap all still produce the same NULL —
// so the requirement is that the person is TOLD, and that the event is
// recorded, rather than the account being quietly created unreachable. The
// owner's own profile (ZIP 70528, parish NULL) is what made that concrete.
//
// THREE ENTRY POINTS, which is the whole point of this file. Email signup goes
// through SignupStep2; Google and Apple sign-ins never see that screen and land
// on CompleteProfile; an existing member changes their ZIP in ProfileEditForm.
// Warning on one of them moves the gap rather than closing it — the same
// reasoning, and the same trap, as zipRequiredAtSignup.test.ts.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { UNKNOWN_ZIP_MESSAGE } from "@/hooks/useParishForZip";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

// SignupStep2 is presentational and receives the flag as a prop, so it renders
// on `zipUnknown`; the two that own their own state render on `unknownZip`.
const SURFACES: Array<[label: string, path: string, flag: string]> = [
  ["email signup (SignupStep2)", "src/pages/signup/SignupStep2.tsx", "zipUnknown"],
  ["social sign-in (CompleteProfile)", "src/pages/CompleteProfile.tsx", "unknownZip"],
  ["profile edit (ProfileEditForm)", "src/components/profile/ProfileEditForm.tsx", "unknownZip"],
];

describe("every ZIP field warns on an unresolvable ZIP", () => {
  for (const [label, path, flag] of SURFACES) {
    it(`${label} renders the shared warning`, () => {
      const src = codeOnly(read(path));
      // Rendered on the unknown-ZIP flag specifically — not on "no parish
      // resolved", which is also true while the user is still typing and while
      // the lookup is failing.
      expect(src).toContain(`{${flag} && (`);
      // Uses the ONE shared sentence rather than a locally-invented one, so
      // three screens cannot drift into three explanations of one thing.
      expect(src).toContain("UNKNOWN_ZIP_MESSAGE");
    });
  }

  it("all three read the parish through the shared hook", () => {
    // Each of these used to carry its own byte-identical copy of the resolve
    // effect, and each independently decided to render nothing for the case
    // that mattered. One hook is what stops a fourth copy repeating that.
    for (const [, path] of SURFACES.slice(1)) {
      expect(codeOnly(read(path)), path).toContain("useParishForZip(zipCode)");
    }
    // SignupStep2 is presentational — Signup.tsx owns the state and passes it.
    const signup = codeOnly(read("src/pages/Signup.tsx"));
    expect(signup).toContain("useParishForZip(zipCode)");
    expect(signup).toMatch(/zipUnknown=\{unknownZip\}/);
  });
});

describe("the warning itself", () => {
  it("does not call an out-of-state ZIP invalid", () => {
    // A Texas ZIP is a real ZIP. Telling someone their address is wrong when
    // it is merely outside our coverage is a different, worse failure.
    expect(UNKNOWN_ZIP_MESSAGE).not.toMatch(/invalid|not a valid|incorrect/i);
  });

  it("says what the consequence is, not just that something is off", () => {
    // The point of the message is that "nothing will reach you" is invisible
    // otherwise — the account works, it is simply never matched.
    expect(UNKNOWN_ZIP_MESSAGE).toMatch(/Louisiana/);
    expect(UNKNOWN_ZIP_MESSAGE).toMatch(/parish/i);
    expect(UNKNOWN_ZIP_MESSAGE).toMatch(/won't reach you/);
  });
});
