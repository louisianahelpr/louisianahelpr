// Every email-auth call sends the address TRIMMED (owner, 2026-10-20: "my
// password and email are correct though"). The login form's own check trims,
// so "lexilombas05@gmail.com " (a space from a keyboard suggestion, autofill
// or paste) showed a green tick, then Supabase answered invalid_credentials:
// measured on prod the same day, the address with a trailing or leading space
// is refused and the bare address signs in.
//
// Scans every tracked non-test file under src/ for the supabase-js calls that
// take an email and requires the email argument to end in `.trim()`.
//
// @mutate src/lib/loginTransport.ts | email: email.trim(), password | email, password
// @mutate src/pages/auth/ForgotPassword.tsx | resetPasswordForEmail(email.trim() | resetPasswordForEmail(email
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { trackedFiles } from "./helpers/trackedFiles";

const ROOT = path.resolve(__dirname, "../..");
const CALL = /auth\.(signInWithPassword|signUp|resetPasswordForEmail|resend|signInWithOtp)\(/g;

/** The call's argument text, up to its matching close paren. */
function argsOf(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

/** The email expression a call passes: resetPasswordForEmail's first arg, else the `email` property. */
export function emailArg(method: string, args: string): string | null {
  if (method === "resetPasswordForEmail") return args.split(",")[0].trim();
  const m = /(?:^|[{,\s])email\s*(?::\s*([^,\n}]+))?\s*[,\n}]/.exec(args);
  if (!m) return null;
  return (m[1] ?? "email").trim();
}

export function untrimmedCalls(file: string, src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(CALL)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    const expr = emailArg(m[1], argsOf(src, open));
    if (expr !== null && !/\.trim\(\)$/.test(expr)) {
      out.push(`${file}:${src.slice(0, m.index).split("\n").length} auth.${m[1]} sends email as \`${expr}\``);
    }
  }
  return out;
}

describe("email-auth calls send a trimmed address", () => {
  it("the scan flags the original login call and passes the fixed one", () => {
    expect(untrimmedCalls("x.ts", "supabase.auth.signInWithPassword({ email, password, options: { captchaToken } })")).toHaveLength(1);
    expect(untrimmedCalls("x.ts", "supabase.auth.signInWithPassword({ email: email.trim(), password })")).toEqual([]);
    expect(untrimmedCalls("x.ts", "supabase.auth.resetPasswordForEmail(email, { redirectTo })")).toHaveLength(1);
    expect(untrimmedCalls("x.ts", "supabase.auth.resend({\n  type: \"signup\",\n  email: prefillEmail,\n})")).toHaveLength(1);
  });

  it("every call under src/ trims", () => {
    const files = trackedFiles("src").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.(test|spec)\.(ts|tsx)$/.test(f) && !f.startsWith("src/test/"));
    expect(files.length).toBeGreaterThan(100);
    const hits = files.flatMap((f) => {
      const src = readFileSync(path.join(ROOT, f), "utf8");
      return src.includes("auth.") ? untrimmedCalls(f, src) : [];
    });
    expect(hits).toEqual([]);
  });
});
