/**
 * Owner 2026-10-21: ONE shared password strength meter for Sign up step 1 and
 * Reset password. Weak is --alert, Fair is neutral, Good/Strong olive; never
 * rust (money only). The auth pages' background wash is neutral too.
 *
 * @mutate src/components/auth/PasswordStrengthMeter.tsx |   if (score === 2) return "hsl(var(--muted-foreground))"; |   if (score === 2) return "hsl(var(--burnt-sienna))";
 * @mutate src/pages/auth/ResetPassword.tsx |               <PasswordStrengthMeter password={password} /> |               {null}
 * @mutate src/components/auth/AuthShell.tsx | hsl(var(--stormy-sky) / 0.08) | hsl(var(--burnt-sienna) / 0.08)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { PasswordStrengthMeter, strengthColor } from "@/components/auth/PasswordStrengthMeter";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const read = (f: string) => blankComments(readFileSync(join(ROOT, f), "utf8"));

describe("one password strength meter", () => {
  it("colours: weak alert, fair neutral, good/strong olive", () => {
    expect(strengthColor(1)).toBe("hsl(var(--alert-ink))");
    expect(strengthColor(2)).toBe("hsl(var(--muted-foreground))");
    expect(strengthColor(3)).toBe("hsl(var(--bark))");
    expect(strengthColor(4)).toBe("hsl(var(--bark))");
  });
  it("renders the label for a typed password and nothing for an empty one", () => {
    const { rerender } = render(<PasswordStrengthMeter password="" />);
    expect(screen.queryByTestId("password-strength")).toBeNull();
    rerender(<PasswordStrengthMeter password="abc" />);
    expect(screen.getByTestId("password-strength")).toBeInTheDocument();
  });
  it("both pages render the shared meter and score nothing themselves", () => {
    for (const f of ["src/pages/auth/ResetPassword.tsx", "src/pages/auth/signup/SignupStep1.tsx"]) {
      const s = read(f);
      expect(s).toMatch(/<PasswordStrengthMeter password=\{password\} \/>/);
      expect(s).not.toMatch(/passwordStrength\(/);
    }
  });
  it("no rust on the meter or the auth wash", () => {
    expect(read("src/components/auth/PasswordStrengthMeter.tsx")).not.toMatch(/burnt-sienna|accent-ink|success-ink/);
    expect(read("src/components/auth/AuthShell.tsx")).not.toMatch(/radial-gradient[^"]*burnt-sienna/);
  });
});
