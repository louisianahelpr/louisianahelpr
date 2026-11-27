/**
 * Polish audit 11-27 #4 (owner phone polish audit): the Log in screen asked a guest to sign up three times (a boxed
 * notice with its own "Create an account" link, the Create account tab, and "New to Helpr? Create an account" at the
 * bottom), Sign up ended with "Already have an account? Log in", desktop Sign up said "Create account" three times, and
 * the notice changed shape by page ("Your home page needs an account"). Now: the notice is ONE 14px grey line, no
 * box, icon or link, the same "Log in to …" pattern for every page; both footer lines are gone (the tabs cover them);
 * the desktop headings are screen-reader only; a guest opening /jobs lands on the public list (/browse).
 * (Earlier history kept here: AUD31-16 named the Declutter page; F080 named every gated page.)
 *
 * @mutate src/pages/auth/loginNotice.ts |   ["/home", "Log in to see your Home."], |   ["/home", "Your home page needs an account."],
 * @mutate src/pages/auth/loginNotice.ts |   if (url.pathname.startsWith("/declutter/item/")) return "Log in to see this item."; |   if (url.pathname.startsWith("/declutter/item/")) return "That's an item for sale on Declutter.";
 * @mutate src/pages/auth/loginNotice.ts |   if (returning) return returning; |   if (returning) return `${returning} We'll take you straight back to it.`;
 * @mutate src/pages/auth/Login.tsx | <p className={`text-ds-14 leading-snug mb-4 text-center ${oauthError | <p className={`text-ds-13 leading-snug mb-4 px-4 py-3 rounded-2xl border ${oauthError
 * @mutate src/pages/auth/Login.tsx |           {loginNoticeInLang(notice)}\n        </p> |           {loginNoticeInLang(notice)} <Link to={signupHref}>{t("login.createAccount")}</Link>\n        </p>
 * @mutate src/pages/auth/signup/SignupStep1.tsx |         <h1 className="sr-only">{t("signup.title")}</h1> |         <h1 className="text-page-title text-foreground max-[479px]:sr-only">{t("signup.title")}</h1>
 * @mutate src/pages/auth/signup/SignupStep1.tsx |       {/* Polish audit 11-27 #4: no "Already have an account? Log in" line | <p>{t("signup.haveAccount")}</p>{/* x
 * @mutate src/components/ProtectedRoute.tsx |     if (!lostMidUse && location.pathname === "/jobs" && !location.search && !hadSessionOnThisBrowser()) return | if (false) return
 * @mutate src/components/ProtectedRoute.tsx | location.pathname === "/jobs" && !location.search && !hadSessionOnThisBrowser()) | location.pathname === "/jobs")
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";
import { enPublic } from "@/lib/i18n/enPublic";
import { esPublic } from "@/lib/i18n/esPublic";
import { declutterGatedNotice, gatedPageNotice, loginNotice, loginNoticeInLang } from "./loginNotice";

const base = { oauthError: null, connect: null, signedOutForInactivity: false, arrivedFromSignup: false, bouncedFromGatedRoute: true };
const src = (p: string) => blankComments(readFileSync(p, "utf8"));

describe("Login notice: one short 'Log in to …' line for every gated page (polish audit 11-27 #4)", () => {
  it("names each page in the same pattern, with no Create an account sentence", () => {
    const cases: [string, string][] = [
      ["/home", "Log in to see your Home."],
      ["/profile?tab=settings", "Log in to see your profile."],
      ["/jobs?tab=posted", "Log in to see your jobs."],
      ["/post-job?category=cleaning", "Log in to post a job."],
      ["/shops", "Log in to see Shops."],
      ["/posts", "Log in to see your posts."],
      ["/messages?jobId=j1", "Log in to see your messages."],
      ["/tips/abc", "Log in to send your tip."],
      ["/payment-success?session_id=cs_x", "Log in to see your payment."],
      ["/declutter/item/00000000-0000-4000-8000-000000000001", "Log in to see this item."],
      ["/declutter/sell", "Log in to sell on Declutter."],
      ["/declutter?tab=buying", "Log in to see your Declutter orders."],
      ["/declutter?tab=selling", "Log in to see your Declutter listings."],
      ["/declutter/settings", "Log in to see your Declutter settings."],
      ["/declutter/move", "Log in to plan a moving sale."],
      ["/declutter", "Log in to use Declutter."],
      ["/somewhere-new", "Log in to see that page."],
    ];
    expect(cases.length).toBeGreaterThan(15);
    for (const [path, line] of cases) {
      const n = loginNotice({ ...base, redirect: path });
      expect(n.notice, path).toBe(line);
      expect(n.notice, path).not.toMatch(/Create an account|needs? (a free|an) account/);
      expect("leadWithSignup" in n, path).toBe(false);
    }
    expect(gatedPageNotice("/payment-successish")).toBeNull();
    expect(declutterGatedNotice("/declutterish")).toBeNull();
    expect(declutterGatedNotice(null)).toBeNull();
  });

  it("every line has a Spanish twin, and the en/es tables carry no stale back-to-it sentence", () => {
    const lines = ["Log in to see your Home.", "Log in to see this item.", "Log in to see that page.", "Log in to apply for this job."];
    for (const l of lines) expect(loginNoticeInLang(l), l).toBe(l); // English reader: unchanged
    const es = esPublic as Record<string, string>;
    const en = enPublic as Record<string, string>;
    expect(en["ln.g.home"]).toBe("Log in to see your Home.");
    expect(es["ln.g.home"]).toMatch(/^Inicie sesión/);
    expect(Object.keys(en).filter((k) => k.startsWith("ln.")).sort()).toEqual(Object.keys(es).filter((k) => k.startsWith("ln.")).sort());
    expect(en["ln.backToIt"]).toBeUndefined();
    expect(en["ln.logBackIn"]).toBeUndefined();
  });

  it("Login draws the notice as one plain 14px grey line with no link, and no sign-up footer", () => {
    const login = src("src/pages/auth/Login.tsx");
    const at = login.indexOf("data-login-notice=\"\"");
    expect(at).toBeGreaterThan(0);
    const open = login.lastIndexOf("<p", at);
    const close = login.indexOf("</p>", at);
    const block = login.slice(open, close);
    expect(block).toContain('className={`text-ds-14 leading-snug mb-4 text-center ${oauthError ? "text-[hsl(var(--destructive-ink))]" : "text-muted-foreground"}`}');
    expect(block).not.toMatch(/<Link|rounded|border|<svg|Info|Clock/);
    expect(login).not.toContain("data-login-new-here");
    expect(login).not.toContain("data-login-lead-signup");
    expect(login).toMatch(/<h1 className="sr-only">\{t\("login\.title"\)\}<\/h1>/);
  });

  it("Sign up has no 'Already have an account?' footer and its heading is for screen readers only", () => {
    const step = src("src/pages/auth/signup/SignupStep1.tsx");
    expect(step).not.toContain('t("signup.haveAccount")');
    expect(step).toMatch(/<h1 className="sr-only">\{t\("signup\.title"\)\}<\/h1>/);
  });

  // Polish audit 11-27 #137: the two checkboxes sat 7px in from the fields' edge (px-1.5); they line up now. The
  // "We may email once" disclosure stays (kept by lead 11-27: it says what happens to a typed email).
  // @mutate src/pages/auth/signup/SignupStep1.tsx |         className="flex items-start gap-3 px-0 py-2 min-h-[44px] | className="flex items-start gap-3 px-1.5 py-2 min-h-[44px]
  // Polish audit 11-27 #76: the password rules were said 3 times while typing (a red sentence, the checklist, the meter);
  // the red sentence and border now wait for "Create account" (or a server refusal); the checklist ticks as you type.
  // @mutate src/pages/auth/signup/SignupStep1.tsx |   const passwordError = (attempted && !passwordValid) \|\| !!serverPasswordError; |   const passwordError = (password.length > 0 && !passwordValid) \|\| !!serverPasswordError;
  it("Sign up's red password sentence waits for Create account; the checklist stays", () => {
    const step = src("src/pages/auth/signup/SignupStep1.tsx");
    expect(step).toContain("const passwordError = (attempted && !passwordValid) || !!serverPasswordError;");
    expect(step).not.toMatch(/passwordError = \(password\.length > 0/);
    expect(step).toContain("<PasswordRuleList password={password} />");
  });

  it("Sign up's checkboxes line up with the fields, and the may-email disclosure stays", () => {
    const step = src("src/pages/auth/signup/SignupStep1.tsx");
    expect(step.match(/flex items-start gap-3 px-0 py-2/g)?.length).toBe(2);
    expect(step).not.toMatch(/flex items-start gap-3 px-1\.5 py-2/);
    expect(step).toContain('{t("signup.mayEmailOnce")}');
  });

  it("only a first-time guest opening a plain /jobs goes to the public list; members and /jobs?job= links still log in", () => {
    const pr = src("src/components/ProtectedRoute.tsx");
    expect(pr).toContain('if (!lostMidUse && location.pathname === "/jobs" && !location.search && !hadSessionOnThisBrowser()) return <Navigate to="/browse" replace />;');
  });
});
