// A referral code must be TYPEABLE, not only linkable — and whatever ends up
// in the field must reach complete-signup's body.
//
// @mutate src/pages/signup/SignupStep2.tsx | id="referralCode" | id="referralCodeGone"
// @mutate src/pages/signup/SignupStep2.tsx | data-testid="referral-code-toggle" | data-testid="referral-code-toggle-gone"
// @mutate src/pages/Signup.tsx | setReferralCode={setReferralCode} | inputCls={inputCls}
// @mutate src/pages/Signup.tsx | referralCode: referralCode.trim().toUpperCase() \|\| null, | referralCode: null,
// @mutate src/pages/Signup.tsx | const [referralCode, setReferralCode] = useState( | const [referralCode] = useState(
//
// Until 2026-09-22 the only door was `?ref=<code>`:
//
//     const [referralCode] = useState(searchParams.get("ref") || "");
//
// `useState` with NO setter. Read once from the URL, never settable. Someone
// who HEARD a code, read it on a flyer, or saw it in a Facebook comment could
// not enter it at all — and the owner is about to post publicly, where people
// read codes rather than click links. The wiring behind the field was already
// proven end to end (a real signup with FUHNW3 minted both the $5
// first_job_bonus and the $5 referrer_bonus); the INPUT was the whole gap.
//
// This file guards three separate things, because closing one without the
// others re-opens the hole in a way that looks fixed:
//
//   1. the field EXISTS and is bound to a real setter (SignupStep2),
//   2. the setter is actually HANDED to the step by the parent (Signup),
//   3. the value REACHES complete-signup's body, normalised.
//
// Normalisation is asserted at BOTH ends on purpose. The referral RPC already
// resolves " fuhnw3 " to FUHNW3, so the server was never the risk — the risk is
// the SCREEN: before the trim/upper on the `?ref=` seed, a link-supplied code
// rendered `fuhnw3` while a hand-typed one rendered `FUHNW3`, the same code
// shown two ways in the same field. That was caught on a 375 screenshot, which
// is exactly the kind of thing a source guard cannot see — so it is pinned here
// now that it has been seen once.
//
// What this file deliberately does NOT assert: that the code is valid, or
// required, or blocking. An unknown code must never stop an account being
// created, so there is no validator to guard.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * Blank every comment — including a TRAILING one — while preserving offsets,
 * so a requirement cannot be satisfied by a commented-out copy of itself.
 * String-aware, because `//` inside a string literal is not a comment.
 *
 * This is the lesson zipRequiredAtSignup.test.ts learned the hard way: a
 * whole-line-only stripper let `if (false) { } // if (!zip) …` pass 10/10.
 */
const codeOnly = (src: string): string => {
  const out = src.split("");
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") out[i++] = " ";
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] !== "\n") out[i] = " ";
        i++;
      }
      if (i < src.length) {
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
      }
      continue;
    }
    i++;
  }
  return out.join("");
};

const STEP2 = codeOnly(read("src/pages/signup/SignupStep2.tsx"));
const SIGNUP = codeOnly(read("src/pages/Signup.tsx"));

describe("a referral code can be typed, not only deep-linked", () => {
  it("SignupStep2 renders a referral-code input", () => {
    // Anchored on the id the label's htmlFor and the parent's aria-controls
    // both point at — rename it and the field is no longer addressable.
    expect(STEP2).toContain('id="referralCode"');
  });

  it("the input is bound to setReferralCode, not to a read-only value", () => {
    // A `value={referralCode}` with no onChange is a field you can look at and
    // cannot fill — which is the exact defect this file exists for, wearing a
    // different costume.
    expect(STEP2).toMatch(/onChange=\{\(e\) => setReferralCode\(/);
    expect(STEP2).toContain("value={referralCode}");
  });

  it("the collapsed affordance is discoverable", () => {
    // Collapsed by default, so it costs nothing to the majority with no code —
    // but there has to be something to press.
    expect(STEP2).toContain('data-testid="referral-code-toggle"');
    expect(read("src/pages/signup/SignupStep2.tsx")).toContain("Have a referral code?");
  });

  it("Signup hands BOTH the value and the setter to the step", () => {
    expect(SIGNUP).toContain("referralCode={referralCode}");
    expect(SIGNUP).toContain("setReferralCode={setReferralCode}");
  });

  it("referralCode is state with a setter, seeded from ?ref= and normalised", () => {
    expect(SIGNUP).toMatch(/const \[referralCode, setReferralCode\] = useState\(/);
    // The `?ref=` deep link must still seed it — this addition must not have
    // cost the flow it was built beside.
    expect(SIGNUP).toContain('searchParams.get("ref")');
    // …and the seed is canonicalised, so link and keyboard agree on screen.
    expect(SIGNUP).toMatch(
      /searchParams\.get\("ref"\) \|\| ""\)\s*\.trim\(\)\s*\.toUpperCase\(\)/,
    );
  });

  it("the code reaches complete-signup's body, trimmed and upper-cased", () => {
    // The whole point. A field nobody sends is decoration.
    expect(SIGNUP).toMatch(
      /referralCode:\s*referralCode\.trim\(\)\.toUpperCase\(\)\s*\|\|\s*null/,
    );
  });

  it("does not gate account creation on the code", () => {
    // No validator may name referralCode: an unknown or mistyped code must
    // never be the reason a person cannot create an account.
    const validators = SIGNUP.match(/errors\.[A-Za-z]+\s*=/g) ?? [];
    expect(validators.some((v) => /referral/i.test(v))).toBe(false);
    expect(STEP2).not.toMatch(/fieldErrors\.referralCode/);
  });
});
