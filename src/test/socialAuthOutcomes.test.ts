/**
 * CLASS: a social sign-in outcome the app never shows (OA-018).
 *
 * Every Apple/Google sign-in the auth server refuses (the email-to-social
 * identity-linking cases: an unverified provider email, two accounts on one
 * address, a banned account) ends in one of two places:
 *   - web: a redirect back to the app with ?error=…&error_code=… in the URL,
 *     which nothing read — Login then showed "That page needs an account";
 *   - native: an AuthApiError whose `code` was ignored — the person got "give
 *     it another try?" for a refusal that is permanent.
 *
 * Inventory from source: every `auth.signInWithOAuth(` / `signInWithIdToken(` /
 * `linkIdentity(` / `signInWithSSO(` call in src/ (comments blanked). Each must
 * live in socialAuth.ts, whose web branch marks the round trip pending and
 * whose native error path goes through GoTrue's code; main.tsx must run the
 * capture before the app and the Supabase client; Login must show it.
 *
 * @mutate src/main.tsx | import "./lib/oauthRedirectError"; | // import removed
 * @mutate src/lib/socialAuth.ts | markOAuthPending(provider, new URL(redirectTo, getPublicOrigin()).pathname); | void redirectTo;
 * @mutate src/lib/socialAuth.ts | const specific = socialAuthErrorCopy(provider, typeof code === "string" ? code : null, raw); | const specific = null;
 * @mutate src/pages/auth/Login.tsx | useState(() => takeOAuthRedirectError()) | useState(() => null)
 * @mutate src/pages/auth/Login.tsx | op: "webSocialRedirect" | op: "webSocialRedirectOff"
 * @mutate src/lib/oauthRedirectError.ts | return code === "access_denied" \|\| code === "provider_email_needs_verification" \|\| code === "user_banned"; | return true;
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");
const SOCIAL = "src/lib/socialAuth.ts";
const CALL = /\.auth\s*\.\s*(signInWithOAuth|signInWithIdToken|linkIdentity|signInWithSSO)\s*\(/g;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test" || name === "__tests__" || name === "integrations") continue;
      out.push(...walk(p));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const code = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

describe("every social sign-in outcome reaches the person (OA-018)", () => {
  const sites = walk(SRC).flatMap((file) => {
    const rel = relative(ROOT, file);
    return [...blankComments(readFileSync(file, "utf8")).matchAll(CALL)].map((m) => ({ rel, fn: m[1] }));
  });

  it("inventory: finds the web and native sign-in calls", () => {
    // Floor: one signInWithOAuth (web) + one signInWithIdToken (native).
    expect(sites.length).toBeGreaterThan(1);
    expect(sites.map((s) => s.fn)).toEqual(expect.arrayContaining(["signInWithOAuth", "signInWithIdToken"]));
  });

  it("every provider sign-in call lives in socialAuth.ts, where its failures are handled", () => {
    const stray = sites.filter((s) => s.rel !== SOCIAL);
    expect(stray, "call these through signInWithProvider() so a refusal is explained").toEqual([]);
  });

  it("the web branch marks the round trip pending before it leaves the page", () => {
    const src = code(SOCIAL);
    const mark = src.search(/markOAuthPending\(\s*provider\s*,/);
    const leave = src.search(/\.auth\s*\.\s*signInWithOAuth\s*\(/);
    expect(mark).toBeGreaterThan(-1);
    expect(leave).toBeGreaterThan(mark);
  });

  it("the native error path maps GoTrue's error code, not only the message", () => {
    const src = code(SOCIAL);
    const body = src.slice(src.indexOf("function friendlyProviderError"));
    expect(body.slice(0, body.indexOf("\n}\n"))).toMatch(/socialAuthErrorCopy\(\s*provider\s*,\s*typeof code/);
  });

  it("main.tsx runs the capture before the app and the Supabase client load", () => {
    const imports = [...code("src/main.tsx").matchAll(/^import\s+(?:[^"']*from\s+)?["']([^"']+)["']/gm)].map((m) => m[1]);
    const capture = imports.indexOf("./lib/oauthRedirectError");
    expect(capture).toBeGreaterThan(-1);
    expect(capture).toBeLessThan(imports.indexOf("./App.tsx"));
  });

  it("Login reports a web refusal that is not the person's own outcome", () => {
    // Showing copy while ops hears nothing was the silent-failure half of the
    // class (lh-silent-failure review of #1806): a server_error from a failing
    // auth trigger reached the user as "try again" and nobody else.
    const login = code("src/pages/auth/Login.tsx");
    expect(login).toMatch(/isExpectedSocialRefusal\(\s*oauthError\.code\s*\)/);
    expect(login).toMatch(/report\([\s\S]{0,200}op:\s*"webSocialRedirect"/);
    // The capture module runs before the Supabase client: it must import nothing.
    expect(code("src/lib/oauthRedirectError.ts")).not.toMatch(/^\s*import\s/m);
  });

  it("Login shows the captured reason", () => {
    expect(code("src/pages/auth/Login.tsx")).toMatch(/useState\(\s*\(\)\s*=>\s*takeOAuthRedirectError\(\)\s*\)/);
  });
});
