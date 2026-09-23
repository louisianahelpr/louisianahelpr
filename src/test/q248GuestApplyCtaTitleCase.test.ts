// PROVEN ABLE TO FAIL: reverting the label to sentence case ("Sign up to
// apply") makes this red.
// @mutate src/components/dashboard/jobDetailDialog/JobDetailFooter.tsx | const guestCtaLabel = "Sign Up to Apply"; | const guestCtaLabel = "Sign up to apply";

/**
 * Q248(a): the guest CTA in the job-detail footer must match the app's Title
 * Case CTA convention (see Navbar.tsx "Get Started" / "Log In"), not sentence
 * case.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FILE = resolve(__dirname, "../components/dashboard/jobDetailDialog/JobDetailFooter.tsx");

describe("Q248(a): guest apply CTA is Title Case", () => {
  it("labels the guest CTA \"Sign Up to Apply\", not sentence case", () => {
    const src = readFileSync(FILE, "utf8");
    const m = /const guestCtaLabel = "([^"]+)";/.exec(src);
    expect(m, "guestCtaLabel declaration not found").toBeTruthy();
    expect(m![1]).toBe("Sign Up to Apply");
  });
});
