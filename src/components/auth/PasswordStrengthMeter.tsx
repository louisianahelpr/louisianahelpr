import { passwordStrength } from "@/pages/auth/signup/signupHelpers";

/**
 * The ONE password strength meter (owner 2026-10-21), shared by Sign up step 1
 * and Reset password so the bar reads the same on both. Colour by rung:
 *   Weak        -> --alert-ink (the one warning colour);
 *   Fair        -> neutral (--muted-foreground);
 *   Good/Strong -> olive (--bark); the segment count and the label tell them apart.
 * Never rust (rust is for money) and never green (not in the palette).
 */
export function strengthColor(score: number): string {
  if (score >= 3) return "hsl(var(--bark))";
  if (score === 2) return "hsl(var(--muted-foreground))";
  return "hsl(var(--alert-ink))";
}

export function PasswordStrengthMeter({ password }: { password: string }) {
  if (!password) return null;
  const { score, label } = passwordStrength(password);
  const barColor = strengthColor(score);
  return (
    <div className="flex items-center gap-2" data-testid="password-strength">
      <div className="flex gap-1 flex-1">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="h-1 flex-1 rounded-full transition-colors"
            style={{ background: i <= score ? barColor : "hsl(var(--olivewood) / 0.15)" }}
          />
        ))}
      </div>
      <span className="text-ds-11 font-sans w-10 text-right" style={{ color: barColor }}>
        {label}
      </span>
    </div>
  );
}
