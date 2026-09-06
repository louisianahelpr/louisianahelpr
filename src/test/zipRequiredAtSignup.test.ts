// ZIP is required at BOTH entry points, or it is required at neither.
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
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

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
    const field = STEP2.slice(STEP2.indexOf('htmlFor="zipCode"'), STEP2.indexOf('htmlFor="zipCode"') + 900);
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
