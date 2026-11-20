import { useNavigate } from "react-router-dom";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enScreens"; // registers the screen words t() reads here

type Mode = "login" | "signup";

/**
 * The Log in | Create account switch at the top of both auth cards (signup-confusion 11-19).
 *
 * A real visitor (11-20 02:16 UTC auth logs) typed a new email and password into Log in three times, got
 * "Invalid login credentials" each time, then asked for a password reset: he believed he was on sign-up. The two
 * cards looked alike (same H mark, same fields, same olive pill) and the only way across was one small line at the
 * very bottom. This switch says which form you are on before anything else, on every width.
 *
 * It is the app's one segmented control (segmentedControlInvariant). Each side is its own route, so choosing the other
 * side navigates there; `signupHref`/`loginHref` keep the pending redirect, and a typed `email` rides in router state
 * (never the URL) so it carries across. Guard: src/test/signupConfusion1119.test.tsx.
 */
export function AuthModeTabs({
  active,
  signupHref = "/signup",
  loginHref = "/login",
  email,
}: {
  active: Mode;
  signupHref?: string;
  loginHref?: string;
  email?: string;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const go = (next: Mode) => {
    const state = email && email.trim() ? { email: email.trim() } : undefined;
    navigate(next === "login" ? loginHref : signupHref, { state });
  };
  return (
    <div data-testid="auth-mode-tabs">
      <SegmentedControl<Mode>
        options={[
          { value: "login", label: t("authTabs.login") },
          { value: "signup", label: t("authTabs.signup") },
        ]}
        value={active}
        onChange={go}
        ariaLabel={t("authTabs.label")}
        semantics="tab"
        labelSize="md"
        className="w-full"
      />
    </div>
  );
}
