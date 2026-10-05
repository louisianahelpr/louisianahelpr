/**
 * Q1314 — every email-auth call the app makes carries a Turnstile token.
 *
 * Supabase Auth checks `captchaToken` on sign-up, password sign-in, OTP/magic
 * link, password reset (/recover) and resend once `security_captcha_enabled`
 * is on. One call site that forgets it is a screen that stops working on the
 * day the lead flips the switch — and nothing else would notice until a real
 * person could not sign in.
 *
 * Inventory is DERIVED: every `.auth.<method>(` call in src/ (tests excluded)
 * for the captcha-gated methods, comments blanked. Each call's own argument
 * list must name `captchaToken`, and each file making one must render a
 * <TurnstileField> (where the token comes from). Social sign-in (OAuth,
 * id_token) is not captcha-gated and is not scanned.
 */
// @mutate src/pages/auth/Login.tsx | supabase.auth.signInWithPassword({ email, password, options: { captchaToken: captchaToken ?? undefined } }), | supabase.auth.signInWithPassword({ email, password }),
// @mutate src/pages/auth/ForgotPassword.tsx |       captchaToken: captchaToken ?? undefined,\n    }); |     });
// @mutate src/pages/auth/SignupPending.tsx | <TurnstileField ref={turnstileRef} action="signup_resend" className="mt-3" /> | {null}
import { describe, it, expect } from "vitest";
import { relative } from "node:path";
import { walkSource, readSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

const GATED = ["signUp", "signInWithPassword", "signInWithOtp", "resetPasswordForEmail", "resend", "signInAnonymously"];
const CALL = new RegExp(`\\.auth\\s*\\.\\s*(${GATED.join("|")})\\s*\\(`, "g");

/** The argument text of the call whose "(" is at `open`, balanced. */
function argsAt(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

type Site = { file: string; line: number; method: string; args: string };

const sites: Site[] = [];
const filesWithSites = new Set<string>();
for (const abs of walkSource(["src"])) {
  const file = relative(process.cwd(), abs);
  if (/\.test\.tsx?$|(^|\/)test\//.test(file)) continue;
  const raw = readSource(abs);
  if (raw === null) continue;
  const src = blankComments(raw);
  for (const m of src.matchAll(CALL)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    sites.push({
      file,
      line: src.slice(0, m.index).split("\n").length,
      method: m[1],
      args: argsAt(src, open),
    });
    filesWithSites.add(file);
  }
}

describe("email-auth calls carry a Turnstile captchaToken (Q1314)", () => {
  it("finds the app's email-auth call sites (floor)", () => {
    // Measured 2026-10-05: Login signInWithPassword, Signup signUp,
    // ForgotPassword + SecurityTab resetPasswordForEmail, SignupPending resend.
    expect(sites.length).toBeGreaterThan(4);
    expect(new Set(sites.map((s) => s.method))).toEqual(
      new Set(["signInWithPassword", "signUp", "resetPasswordForEmail", "resend"]),
    );
  });

  it("every call passes options.captchaToken", () => {
    const missing = sites.filter((s) => !/\bcaptchaToken\b/.test(s.args)).map((s) => `${s.file}:${s.line} auth.${s.method}`);
    expect(missing, "pass `captchaToken` from a <TurnstileField> (src/components/auth/TurnstileField.tsx)").toEqual([]);
  });

  it("every file making one renders the TurnstileField the token comes from", () => {
    const noWidget = [...filesWithSites].filter((f) => !/<TurnstileField\b/.test(blankComments(readSource(f) ?? "")));
    expect(noWidget).toEqual([]);
  });
});
