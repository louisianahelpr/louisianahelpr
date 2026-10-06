/**
 * CLASS (Q446, owner 2026-10-05: "make sure another email is never created"):
 * an Apple/Google sign-in whose email matches no account silently creates a
 * second account. 2026-05-05 the owner's own Apple sign-in with Hide My Email
 * did exactly that.
 *
 * Layers, each held here:
 *   1. SERVER — the newest migration defining public.hook_one_account_per_person
 *      refuses apple/google user creation with the shared prefix, and offers
 *      choose_new_social_account; scripts/check-identity-linking.mjs FAILS live
 *      unless the auth config points the Before User Created hook at it and
 *      manual linking is on (GoTrue calls the hook only when it would create).
 *   2. CLIENT WRITE — inventory from source: every signInWithIdToken /
 *      signInWithOAuth / linkIdentity call (comments blanked). Each id-token
 *      sign-in either reads the refusal into a choice (accountChoiceFrom) or
 *      runs after the person chose "I'm new here" (the RPC). The native catch
 *      returns the choice before any error handling.
 *   3. WEB RETURN — the redirect capture reads the choice before GoTrue's
 *      generic access_denied (which it would show as "declined", i.e. nothing).
 *   4. READER — every screen with the social buttons shows the choice dialog
 *      (it lives inside SocialAuthButtons); Login hands it the web refusal.
 *   5. MERGE — Profile > Security offers Connect for every provider the sign-in
 *      screen offers.
 *
 * @mutate src/lib/socialAuth.ts | if (choice) throw new AccountChoiceRequired({ ...choice, provider, idToken }); | void choice;
 * @mutate src/lib/socialAuth.ts | if (err instanceof AccountChoiceRequired) return { kind: "choose", choice: err.choice }; | void AccountChoiceRequired;
 * @mutate src/lib/oauthRedirectError.ts | if (choice) return hold(loc, hist, query, hash, { provider: pending.provider, | if (false) return hold(loc, hist, query, hash, { provider: pending.provider,
 * @mutate src/components/auth/SocialAuthButtons.tsx | <AccountChoiceDialog choice={choice} | <AccountChoiceDialog choice={null}
 * @mutate src/components/auth/SocialAuthButtons.tsx | onChoose(result.choice); | void result;
 * @mutate src/components/auth/SocialAuthButtons.tsx | import("@/components/auth/AccountChoiceDialog") | import("@/components/auth/AccountChoiceDialogX")
 * @mutate src/components/auth/SocialAuthButtons.tsx | if (live) failed.current(); | void failed;
 * @mutate src/components/auth/SocialAuthButtons.tsx | markAccountChoiceRetry(); | void 0;
 * @mutate src/pages/auth/Login.tsx | loginNotice({ oauthError, accountChoiceRetry, | loginNotice({ oauthError,
 * @mutate src/components/auth/SocialAuthButtons.tsx | import { useEffect, useState } from "react"; | import { useEffect, useState } from "react";\nimport { AccountChoiceDialog as Eager } from "@/components/auth/AccountChoiceDialog";
 * @mutate src/pages/auth/Login.tsx | <SocialAuthButtons mode="signin" initialChoice={accountChoice} /> | <SocialAuthButtons mode="signin" />
 * @mutate supabase/migrations/20261005182630_one_account_per_person.sql | 'message', 'lh_account_choice:' | 'message', 'lh_other:'
 * @mutate supabase/migrations/20261005182630_one_account_per_person.sql | IF v_provider IS NULL OR v_provider NOT IN ('apple', 'google') THEN | IF v_provider IS NULL OR v_provider NOT IN ('apple') THEN
 * @mutate src/components/profile/SignInMethodsCard.tsx | = ["apple", "google"]; | = ["apple"];
 * @mutate scripts/check-identity-linking.mjs | ["hook_before_user_created_enabled", true, | ["hook_before_user_created_enabledX", true,
 */
import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const code = (rel: string) => blankComments(read(rel));
const SOCIAL = "src/lib/socialAuth.ts";
const PREFIX = "lh_account_choice:";

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

/** The body of the function containing `index` (from its `function` keyword to the next top-level close). */
function enclosingFunction(src: string, index: number): string {
  const start = src.lastIndexOf("\nexport async function", index) > src.lastIndexOf("\nasync function", index)
    ? src.lastIndexOf("\nexport async function", index)
    : src.lastIndexOf("\nasync function", index);
  const end = src.indexOf("\n}\n", index);
  return src.slice(start, end);
}

/** Newest migration whose code (comments blanked) defines the function. */
function newestDefinition(fn: string): { file: string; sql: string } | null {
  const dir = join(ROOT, "supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const re = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${fn}\\s*\\(`, "i");
  for (const f of files.reverse()) {
    const sql = blankSqlComments(readFileSync(join(dir, f), "utf8"));
    const m = re.exec(sql);
    if (!m) continue;
    // Body: from the definition to its closing dollar-quote tag (any tag).
    const after = sql.slice(m.index);
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(after)?.[1];
    if (!tag) return { file: f, sql: after };
    const open = after.indexOf(tag);
    const close = after.indexOf(tag, open + tag.length);
    return { file: f, sql: after.slice(0, close + tag.length) };
  }
  return null;
}

describe("one account per person: a no-match social sign-in never silently creates an account (Q446)", () => {
  const CALL = /\.auth\s*\.\s*(signInWithOAuth|signInWithIdToken|linkIdentity)\s*\(/g;
  const sites = walk(join(ROOT, "src")).flatMap((file) =>
    [...blankComments(readFileSync(file, "utf8")).matchAll(CALL)].map((m) => ({ rel: relative(ROOT, file), fn: m[1], at: m.index ?? 0 })),
  );

  it("inventory: finds the id-token, OAuth and link calls, all in socialAuth.ts", () => {
    expect(sites.length).toBeGreaterThan(3);
    expect(new Set(sites.map((s) => s.fn))).toEqual(new Set(["signInWithOAuth", "signInWithIdToken", "linkIdentity"]));
    expect(sites.filter((s) => s.rel !== SOCIAL)).toEqual([]);
  });

  it("every id-token sign-in either turns the refusal into the choice or runs after the person chose", () => {
    const src = code(SOCIAL);
    const idToken = sites.filter((s) => s.fn === "signInWithIdToken");
    expect(idToken.length).toBeGreaterThan(1);
    const bad = idToken.filter((s) => {
      const body = enclosingFunction(src, s.at);
      const after = body.slice(body.indexOf("signInWithIdToken"));
      const readsChoice = /accountChoiceFrom\(\s*error\s*\)/.test(after) && /throw new AccountChoiceRequired\(/.test(after);
      const afterChoice = body.indexOf('rpc("choose_new_social_account"') > -1 && body.indexOf('rpc("choose_new_social_account"') < body.indexOf("signInWithIdToken");
      return !readsChoice && !afterChoice;
    });
    expect(bad.map((s) => `${s.rel}@${s.at}`), "a sign-in that can create an account must go through the choice").toEqual([]);
  });

  it("the native catch returns the choice before treating anything as an error", () => {
    const src = code(SOCIAL);
    const body = enclosingFunction(src, src.indexOf("export async function signInWithProvider"));
    const choose = body.indexOf('return { kind: "choose", choice: err.choice }');
    expect(choose).toBeGreaterThan(-1);
    expect(choose).toBeLessThan(body.indexOf("report("));
  });

  it("the web return reads the choice before GoTrue's generic access_denied, with and without the marker", () => {
    const src = code("src/lib/oauthRedirectError.ts");
    expect(src).toContain(`"${PREFIX}"`);
    for (const fn of ["export function captureOAuthRedirectError", "function captureUnmarked"]) {
      const body = src.slice(src.indexOf(fn), src.indexOf("\n}\n", src.indexOf(fn)));
      const choice = body.search(/if \(choice\) return hold\(/);
      expect(choice, fn).toBeGreaterThan(-1);
      expect(choice, fn).toBeLessThan(body.search(/get\("error_code"\)/));
    }
  });

  it("every screen with the social buttons shows the choice, and Login hands it the web refusal", () => {
    const buttons = code("src/components/auth/SocialAuthButtons.tsx");
    expect(buttons).toMatch(/<AccountChoiceDialog choice=\{choice\}/);
    expect(buttons).toMatch(/case "choose":[\s\S]{0,120}onChoose\(result\.choice\)/);
    // The dialog code (Radix dialog stack, ~19 KB gz) loads only when the choice
    // is asked: never a static import (it put /login 22 KB over its Q178
    // budget, 2026-10-05), and never React.lazy (a suspended first render is
    // discarded and Login's read-once takeOAuthRedirectError() then hands the
    // re-render null, so the dialog never opened; seen in a browser 2026-10-05).
    expect(buttons).not.toMatch(/^\s*import\s+(?!type\s)[^;]*from\s+"@\/components\/auth\/AccountChoiceDialog"/m);
    expect(buttons).not.toMatch(/\blazy\(/);
    expect(buttons).toMatch(/import\("@\/components\/auth\/AccountChoiceDialog"\)/);
    // A failed download is never a silent drop: the catch tells the person and
    // clears the choice so the next tap asks again.
    expect(buttons).toMatch(/\.catch\([\s\S]{0,500}failed\.current\(\)/);
    // A stale-download failure reloads the page before that catch runs, so the
    // note for Log In is written BEFORE the download (seen in a browser,
    // 2026-10-05) and Log In reads it.
    expect(buttons).toMatch(/markAccountChoiceRetry\(\);\s*import\("@\/components\/auth\/AccountChoiceDialog"\)/);
    expect(code("src/pages/auth/Login.tsx")).toMatch(/loginNotice\(\{ oauthError, accountChoiceRetry,/);
    expect(buttons).toMatch(/useAccountChoiceDialog\(choice !== null, \(\) => \{[\s\S]{0,200}setChoice\(null\)[\s\S]{0,200}toast\.error\(/);
    expect(code("src/pages/auth/Login.tsx")).toMatch(/<SocialAuthButtons mode="signin" initialChoice=\{accountChoice\} \/>/);
    // Both "I'm new here" and "I already have an account" are offered.
    const dialog = code("src/components/auth/AccountChoiceDialog.tsx");
    expect(dialog).toMatch(/continueAsNewAccount\(/);
    expect(dialog).toMatch(/secondaryLabel="I already have an account"/);
  });

  it("server: the newest hook refuses apple and google creation with the client's prefix", () => {
    const hook = newestDefinition("hook_one_account_per_person");
    expect(hook, "no migration defines public.hook_one_account_per_person").not.toBeNull();
    const sql = hook!.sql;
    expect(sql).toMatch(/NOT IN \('apple', 'google'\)/);
    expect(sql).toContain(`'${PREFIX}'`);
    expect(sql).toMatch(/'http_code',\s*4\d\d/);
    const choose = newestDefinition("choose_new_social_account");
    expect(choose, "no migration defines public.choose_new_social_account").not.toBeNull();
  });

  it("live: the identity-linking check fails unless the hook is on, is this function, and manual linking is on", () => {
    const script = code("scripts/check-identity-linking.mjs");
    expect(script).toMatch(/\["hook_before_user_created_enabled", true,/);
    expect(script).toMatch(/\["hook_before_user_created_uri", ONE_ACCOUNT_HOOK_URI,/);
    expect(script).toMatch(/\["security_manual_linking_enabled", true,/);
    expect(script).toContain('"pg-functions://postgres/public/hook_one_account_per_person"');
  });

  it("Profile > Security offers Connect for every provider the sign-in screen offers", () => {
    const offered = [...code("src/components/auth/SocialAuthButtons.tsx").matchAll(/<SocialAuthButton provider="(\w+)"/g)].map((m) => m[1]);
    expect(offered.length).toBeGreaterThan(1);
    const card = code("src/components/profile/SignInMethodsCard.tsx");
    const list = /CONNECTABLE_PROVIDERS[^=]*=\s*\[([^\]]*)\]/.exec(card)?.[1] ?? "";
    const connectable = [...list.matchAll(/"(\w+)"/g)].map((m) => m[1]);
    expect(connectable.sort()).toEqual([...offered].sort());
    expect(code("src/components/profile/SecurityTab.tsx")).toMatch(/<SignInMethodsCard \/>/);
  });
});
