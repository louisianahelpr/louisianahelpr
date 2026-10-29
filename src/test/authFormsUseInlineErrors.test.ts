/**
 * CLASS GUARD (app audit 2026-10-29, A3-L3): an auth form answers a bad entry
 * with the app's inline error, never the browser's native validation bubble.
 *
 * /reset-password kept `required` + `minLength` on its inputs without
 * `noValidate`, so an empty or short password got Chrome's "Please fill out
 * this field" tooltip and handleSubmit never ran its inline message (sign-up,
 * log-in and forgot-password were already noValidate for the same reason).
 *
 * Inventory from source: every <form> in src/pages/auth (tests excluded,
 * comments blanked). A form whose own fields (<input>, <Input>, <textarea>,
 * <Textarea>, <select>) carry a browser-enforced constraint (`required`,
 * `minLength`, `pattern`, `min`) must carry `noValidate`.
 */
// @mutate src/pages/auth/ResetPassword.tsx |           <form onSubmit={handleSubmit} noValidate className="space-y-4"> |           <form onSubmit={handleSubmit} className="space-y-4">
// @mutate src/pages/auth/ResetPassword.tsx |               <PasswordStrengthMeter password={password} /> |               <PasswordStrengthMeter password={password} />{PASSWORD_RULES.map((r) => r.label)}
import { describe, expect, it } from "vitest";
import { relative } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { readSource, walkSource } from "./helpers/walkSource";

type Form = { file: string; line: number; open: string; body: string };

const forms: Form[] = [];
for (const abs of walkSource(["src/pages/auth"])) {
  const file = relative(process.cwd(), abs);
  if (!/\.tsx$/.test(file) || /\.test\.tsx$/.test(file)) continue;
  const src = blankComments(readSource(abs) ?? "");
  for (const m of src.matchAll(/<form\b/g)) {
    const at = m.index ?? 0;
    const openEnd = src.indexOf(">", at);
    const close = src.indexOf("</form>", openEnd);
    forms.push({
      file,
      line: src.slice(0, at).split("\n").length,
      open: src.slice(at, openEnd + 1),
      body: src.slice(openEnd + 1, close < 0 ? undefined : close),
    });
  }
}

/** The opening tags of a form's fields, braces balanced so `=>` inside a handler does not end a tag. */
function fieldTags(body: string): string[] {
  const tags: string[] = [];
  for (const m of body.matchAll(/<(?:input|Input|textarea|Textarea|select)\b/g)) {
    const start = m.index ?? 0;
    let depth = 0;
    let i = start;
    for (; i < body.length; i++) {
      const c = body[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    tags.push(body.slice(start, i + 1));
  }
  return tags;
}

/** A browser-enforced constraint attribute on a field. */
const CONSTRAINT = /\s(?:required|minLength|pattern|min)(?=[\s=/>])/;
const constrained = (body: string) => fieldTags(body).some((t) => CONSTRAINT.test(t));

describe("auth forms use the app's inline errors, not the browser's bubble (A3-L3)", () => {
  it("finds the auth forms (floor)", () => {
    // Measured 2026-10-29: CompleteProfile, ForgotPassword, Login (two), ResetPassword.
    expect(forms.length).toBeGreaterThan(4);
    // The field scan reads real tags: ResetPassword's and Login's fields are constrained.
    expect(forms.filter((f) => constrained(f.body)).length).toBeGreaterThan(1);
  });

  it("every auth form with constrained fields is noValidate", () => {
    const bubble = forms
      .filter((f) => constrained(f.body) && !/\bnoValidate\b/.test(f.open))
      .map((f) => `${f.file}:${f.line}`);
    expect(bubble).toEqual([]);
  });

  it("reset password states the rules the way sign-up does: no up-front list, the missing ones named inline", () => {
    const reset = blankComments(readSource("src/pages/auth/ResetPassword.tsx") ?? "");
    const signup = blankComments(readSource("src/pages/auth/signup/SignupStep1.tsx") ?? "");
    for (const src of [reset, signup]) {
      expect(src.length).toBeGreaterThan(5000);
      expect(src).not.toMatch(/PASSWORD_RULES\.map\(/);
      expect(src).toMatch(/passwordProblem\(password\)/);
    }
  });
});
