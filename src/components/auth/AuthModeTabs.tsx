import { Link } from "react-router-dom";

/**
 * Sign in ⇄ Create account, as a segmented control ABOVE the auth card
 * (owner: "move create account and sign up out, like the profile tabs").
 *
 * The two modes used to be reachable only from a small text link buried at
 * the bottom of the other page's card — below the password field, the CTA,
 * the divider and the social buttons. That made "I'm in the wrong one" a
 * scroll-and-hunt, and it hid the fact that the two screens are one choice
 * with two halves rather than two unrelated destinations.
 *
 * Outside the card on purpose: it is navigation BETWEEN cards, not a control
 * belonging to either. Same shape as the /legal policy tabs and the Profile
 * tab row, so it reads as the app's one segmented-control idiom.
 *
 * Links, not buttons — each mode is a real route, so this stays
 * middle-clickable, deep-linkable and crawlable, and the browser handles the
 * navigation.
 */
export function AuthModeTabs({
  active,
  /** Preserved on the Create-account side so `?type=business` survives. */
  signupSearch = "",
  className = "",
}: {
  active: "signin" | "signup";
  signupSearch?: string;
  className?: string;
}) {
  const base =
    "flex-1 h-10 inline-flex items-center justify-center rounded-ds-md text-ds-13 font-sans font-semibold leading-none transition-colors duration-200";

  const tab = (isActive: boolean) =>
    isActive
      ? `${base} btn-grad-primary`
      : `${base} hover:bg-[hsl(var(--olivewood)/0.06)]`;

  const activeStyle = {
    color: "hsl(var(--parchment))",
    border: "1px solid hsl(var(--bark-border))",
    boxShadow:
      "inset 0 1px 0 hsl(var(--parchment) / 0.22), " +
      "0 1px 1px hsl(var(--ink-deep) / 0.10), " +
      "0 2px 6px hsl(var(--ink-deep) / 0.12)",
  } as const;
  const idleStyle = { color: "hsl(var(--olivewood))" } as const;

  return (
    <div
      className={`flex items-center gap-1 rounded-2xl p-1 ${className}`}
      style={{ border: "1px solid hsl(var(--bark) / 0.18)" }}
      role="group"
      aria-label="Sign in or create an account"
    >
      <Link
        to="/login"
        className={tab(active === "signin")}
        style={active === "signin" ? activeStyle : idleStyle}
        aria-current={active === "signin" ? "page" : undefined}
      >
        Sign in
      </Link>
      <Link
        to={`/signup${signupSearch}`}
        className={tab(active === "signup")}
        style={active === "signup" ? activeStyle : idleStyle}
        aria-current={active === "signup" ? "page" : undefined}
      >
        Create account
      </Link>
    </div>
  );
}

export default AuthModeTabs;
