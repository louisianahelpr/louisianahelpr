// ZIP is required at BOTH entry points, or it is required at neither.
//
// @mutate src/pages/Signup.tsx |       if (!zip) errors.zipCode = "Add your ZIP code"; |       if (false) { /* nothing */ } // if (!zip) errors.zipCode = "Add your ZIP code";
//
// Owner decision 2026-09-05. It was optional on the reasoning that a second
// required field on the highest-traffic form is a friction cost worth weighing
// deliberately — a fair argument, now overruled: ZIP is the ONLY input that
// resolves a member's parish, and parish drives job-match notifications, the
// daily digest, and Louisiana sales tax. Optional produced accounts that signed
// up fine and then never heard about a nearby job, with nothing on any screen
// explaining why.
//
// TWO ENTRY POINTS, and that is the whole point of this file. Email signup goes
// through SignupStep2; Google and Apple sign-ins never see that screen and land
// on CompleteProfile instead. Requiring it in one place moves the gap rather
// than closing it, and the two files are far enough apart that the next person
// to touch one will not think about the other.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * Blank every comment, INCLUDING a trailing one, and blank rather than delete
 * so offsets and line numbers survive.
 *
 * This was `.replace(/^[ \t]*\/\/.*$/gm, "")` — whole-LINE comments only —
 * and that made the file hollow. Proven 2026-09-21: replacing the requirement
 * with `if (false) { } // if (!zip) errors.zipCode = "Add your ZIP code";`
 * removes ZIP from email signup entirely and this suite passed **10/10**,
 * because the trailing comment still satisfied every regex.
 *
 * The consequence is the one this file's own header describes: ZIP is the only
 * input that resolves a member's parish, and parish drives job-match
 * notifications, the daily digest and Louisiana sales tax. The account signs
 * up fine and then never hears about a nearby job, with nothing on any screen
 * explaining why.
 *
 * String-aware, because a `//` inside a string literal is not a comment — a
 * naive scanner elsewhere in this repo ate a live value sitting after a URL.
 */
const codeOnly = (src: string): string => {
  const out = src.split("");
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; }
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") out[i++] = " ";
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] !== "\n") out[i] = " "; i++; }
      if (i < src.length) { out[i] = " "; out[i + 1] = " "; i += 2; }
      continue;
    }
    i++;
  }
  return out.join("");
};

const SIGNUP = codeOnly(read("src/pages/Signup.tsx"));
const STEP2 = codeOnly(read("src/pages/signup/SignupStep2.tsx"));
const COMPLETE = codeOnly(read("src/pages/CompleteProfile.tsx"));

describe("email signup (SignupStep2)", () => {
  it("rejects a missing ZIP", () => {
    expect(SIGNUP).toMatch(/errors\.zipCode\s*=\s*["']Add your ZIP code["']/);
  });

  it("rejects a partial ZIP, not just an empty one", () => {
    // A 3-digit ZIP resolves to no parish exactly like an absent one, so
    // presence alone is not the check.
    expect(SIGNUP).toMatch(/zip\.length !== 5/);
  });

  it("no longer labels the field optional", () => {
    const field = STEP2.slice(STEP2.indexOf('htmlFor="zipCode"'), STEP2.indexOf('htmlFor="zipCode"') + 700);
    expect(field).not.toMatch(/\(optional\)/);
  });

  it("shows the error on the field and clears it as the user types", () => {
    // Bounded by the field's own END MARKER, not a character count. This was
    // `+ 900`, and adding the valid check beside the input (2026-09-12) pushed
    // the FieldError past character 900 — the test failed with the field
    // perfectly intact, because it measured the markup instead of reading it.
    const start = STEP2.indexOf('htmlFor="zipCode"');
    const end = STEP2.indexOf("zipCode-unknown", start);
    expect(end, "the ZIP field's unknown-ZIP notice marker moved — re-anchor this test").toBeGreaterThan(start);
    const field = STEP2.slice(start, end);
    expect(field).toContain('FieldError id="zipCode-error"');
    expect(field).toContain('clearFieldError?.("zipCode")');
    // Without aria-describedby the message is visible but unannounced.
    expect(field).toContain('aria-describedby={fieldErrors.zipCode ? "zipCode-error" : undefined}');
  });

  it("stops treating an absent ZIP as a legal submitted value", () => {
    expect(SIGNUP).not.toMatch(/zipCode:\s*zipCode\.trim\(\)\s*\|\|\s*null/);
  });
});

describe("social sign-in (CompleteProfile)", () => {
  it("requires ZIP in the checklist that gates the submit button", () => {
    expect(COMPLETE).toMatch(/label: "ZIP code", done: zipCode\.replace\(\/\\D\/g, ""\)\.length === 5/);
  });

  it("keeps zipCode in the checklist's dependency array", () => {
    // Load-bearing: the checklist gates the button, so omitting the dep leaves
    // "ZIP code" permanently unchecked and the form impossible to submit.
    const memo = COMPLETE.slice(COMPLETE.indexOf("const checklist = useMemo"));
    const deps = memo.slice(memo.indexOf("}, ["), memo.indexOf("]);"));
    expect(deps).toContain("zipCode");
  });

  it("also guards at submit, not only in the checklist", () => {
    expect(COMPLETE).toMatch(/zipCode\.replace\(\/\\D\/g, ""\)\.length !== 5.*return fail/s);
  });

  it("no longer labels the field optional", () => {
    const field = COMPLETE.slice(COMPLETE.indexOf('htmlFor="zipCode"'), COMPLETE.indexOf('htmlFor="zipCode"') + 500);
    expect(field).not.toMatch(/\(optional\)/);
  });

  it("always writes zip_code rather than spreading it in conditionally", () => {
    expect(COMPLETE).not.toMatch(/\.\.\.\(zipCode\.trim\(\) \? \{ zip_code/);
    expect(COMPLETE).toMatch(/zip_code: zipCode\.trim\(\)/);
  });
});
