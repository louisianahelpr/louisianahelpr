/**
 * Whole-app audit 11-10, Builder 2.
 *
 * F260n (sign-up step 2's history entry) retired with the second screen itself (owner 11-23: sign-up is one
 * screen; src/test/signupOneScreen.test.tsx), so nothing here asks for a step-2 entry any more.
 * F219: the password rules were written twice (a sentence, then a five-item checklist). The checklist is the one
 * visible copy; the sentence stays as the list's aria-label.
 *
 * @mutate src/components/auth/PasswordRuleList.tsx |       <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label={hint}> |       <p className="text-ds-11 text-muted-foreground">{hint}</p><ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label={hint}>
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { blankComments } from "@/test/helpers/blankNonCode";
import { PasswordRuleList } from "@/components/auth/PasswordRuleList";

const ROOT = resolve(__dirname, "../..");
const src = (p: string) => blankComments(readFileSync(resolve(ROOT, p), "utf8"));

describe("F219: the password rules are written once", () => {
  it("the checklist is the visible copy and keeps the sentence as its label", () => {
    render(<PasswordRuleList password="" />);
    const list = screen.getByRole("list");
    expect(list.getAttribute("aria-label")).toMatch(/^At least 12 characters/);
    expect(list.querySelectorAll("li")).toHaveLength(5);
    expect(screen.queryByText(/^At least 12 characters/)).toBeNull();
    const rules = src("src/components/auth/PasswordRuleList.tsx");
    expect(rules).not.toMatch(/<p[^>]*>\{hint\}<\/p>/);
  });
});
