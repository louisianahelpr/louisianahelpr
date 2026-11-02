// PROVEN ABLE TO FAIL: putting the label back in Title Case ("Sign Up to
// Apply") makes this red.
// @mutate src/components/dashboard/jobDetailDialog/JobDetailFooter.tsx | const guestCtaLabel = "Sign up to apply"; | const guestCtaLabel = "Sign Up to Apply";

/**
 * Q248(a) once held this guest CTA in Title Case ("Sign Up to Apply"). The
 * owner's rule of 2026-10-21 replaced that: buttons are sentence case
 * everywhere (src/test/controlsSentenceCase.test.ts). Lead 11-02 (Q2619):
 * follow the owner's rule, so the job-detail footer and the guest preview
 * both say "Sign up to apply". The file keeps its name so its history reads.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FILE = resolve(__dirname, "../components/dashboard/jobDetailDialog/JobDetailFooter.tsx");

describe("Q248(a) / Q2619: guest apply CTA is sentence case (owner 2026-10-21)", () => {
  it("labels the guest CTA \"Sign up to apply\"", () => {
    const src = readFileSync(FILE, "utf8");
    const m = /const guestCtaLabel = "([^"]+)";/.exec(src);
    expect(m, "guestCtaLabel declaration not found").toBeTruthy();
    expect(m![1]).toBe("Sign up to apply");
  });
});
