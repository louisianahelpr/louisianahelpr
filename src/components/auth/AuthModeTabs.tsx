import { Link } from "react-router-dom";
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enScreens"; // registers the screen words t() reads here

/**
 * The Log in | Create account switch at the top of both auth cards (signup-confusion 11-19).
 *
 * A real visitor (11-20 02:16 UTC auth logs) typed a new email and password into Log in three times, got
 * "Invalid login credentials" each time, then asked for a password reset: he believed he was on sign-up. The two
 * cards looked alike (same H mark, same fields, same olive pill) and the only way across was one small line at the
 * very bottom. This switch says which form you are on before anything else, on every width.
 *
 * Two links, not tabs: each side is its own route (/login, /signup), so the current one carries aria-current="page".
 * The selected side wears btn-grad-primary (CLAUDE.md: selected controls wear it); both are 44px tall.
 * `signupHref`/`loginHref` keep the pending redirect; `email` rides in router state (never the URL) so a typed
 * address carries across. Guard: src/test/signupConfusion1119.test.tsx.
 */
export function AuthModeTabs({
  active,
  signupHref = "/signup",
  loginHref = "/login",
  email,
}: {
  active: "login" | "signup";
  signupHref?: string;
  loginHref?: string;
  email?: string;
}) {
  const { t } = useLanguage();
  const state = email && email.trim() ? { email: email.trim() } : undefined;
  const side = (on: boolean) =>
    `flex-1 inline-flex items-center justify-center min-h-11 rounded-full px-3 text-ds-14 font-sans font-bold transition-colors ${
      on ? "btn-grad-primary !text-[hsl(var(--parchment))]" : "hover:bg-[hsl(var(--bark)/0.08)]"
    }`;
  return (
    <nav
      aria-label={t("authTabs.label")}
      data-testid="auth-mode-tabs"
      className="flex w-full gap-1 p-1 rounded-full"
      style={{ background: "hsl(var(--bark) / 0.08)" }}
    >
      <Link
        to={loginHref}
        state={state}
        aria-current={active === "login" ? "page" : undefined}
        className={side(active === "login")}
        style={active === "login" ? undefined : { color: "hsl(var(--ink-deep) / 0.78)" }}
        data-auth-tab="login"
      >
        {t("authTabs.login")}
      </Link>
      <Link
        to={signupHref}
        state={state}
        aria-current={active === "signup" ? "page" : undefined}
        className={side(active === "signup")}
        style={active === "signup" ? undefined : { color: "hsl(var(--ink-deep) / 0.78)" }}
        data-auth-tab="signup"
      >
        {t("authTabs.signup")}
      </Link>
    </nav>
  );
}
