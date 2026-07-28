import { useLocation, NavLink, Link } from "react-router-dom";
import {
  Users,
  CreditCard,
  CalendarClock,
  FileSpreadsheet,
  FileText,
  KeyRound,
  Sparkles,
  Rocket,
  ShieldAlert,
} from "lucide-react";
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import HelprMark from "@/components/HelprMark";
import BackButton from "@/components/BackButton";
import NotificationPanel from "@/components/NotificationPanel";
import { useMyBusiness } from "@/hooks/useMyBusiness";

interface NavItem {
  to: string;
  label: string;
  icon: React.ElementType;
}

// Single source of truth for the /business/* sub-nav. Order mirrors the
// Phase 4 IA map: Team · Billing · Contracts · Exports · Reports · API ·
// Onboarding.
const NAV: NavItem[] = [
  { to: "/business/team", label: "Team", icon: Users },
  { to: "/business/billing", label: "Billing", icon: CreditCard },
  { to: "/business/contracts", label: "Contracts", icon: CalendarClock },
  { to: "/business/exports", label: "Exports", icon: FileSpreadsheet },
  { to: "/business/reports", label: "Reports", icon: FileText },
  { to: "/business/api", label: "API", icon: KeyRound },
  { to: "/business/onboarding", label: "Onboarding", icon: Rocket },
];

interface Props {
  /** Pre-title small-caps eyebrow line. */
  eyebrow: string;
  /** Main page title. */
  title: string;
  /** Optional sub-line below the title. */
  meta?: ReactNode;
  /**
   * When true, render a banner above `children` if the current business's
   * `verification_status !== "verified"`. Opt-in on posting/spending pages
   * (Billing, Contracts, API) so an unverified business sees the required
   * next step without being locked out of the surface they need to reach
   * (Team hosts the BusinessVerificationCard). The real gate is enforced
   * server-side on jobs.INSERT via RLS + at each client submit path — this
   * banner is UX. Non-money screens (Team, Onboarding, Exports, Reports)
   * omit the prop.
   */
  requiresVerification?: boolean;
  children: ReactNode;
}

/**
 * BusinessLayout — the one shared chrome for every `/business/*` surface.
 * Renders a brand header, a Back affordance, an editorial title block, and
 * the horizontal/scrollable Business sub-nav, then the page's own content.
 *
 * Each `/business/*` page wraps its body in this layout (children pattern),
 * so the seven routes share one header + sub-nav and no page renders its
 * own competing header.
 *
 * This is a `min-h-screen` document-scroll layout — every `/business/*`
 * route is already in DOCUMENT_SCROLL_ROUTES via the `/business` prefix
 * (see useAppShellViewport.ts). Do NOT introduce AppShell here.
 */
const BusinessLayout = ({ title, meta, requiresVerification, children }: Props) => {
  const location = useLocation();
  const { business } = useMyBusiness();

  const showVerificationBanner =
    !!requiresVerification && !!business && business.verification_status !== "verified";
  const verificationCopy = (() => {
    if (!business) return null;
    switch (business.verification_status) {
      case "pending":
        return {
          title: "Verification in review",
          body: "Your license & insurance documents are with our team. Posting and billing unlock once they're approved.",
        };
      case "rejected":
        return {
          title: "Verification was rejected",
          body: "See the rejection reason on the Team page and re-upload corrected documents to unlock posting and billing.",
        };
      case "none":
      default:
        return {
          title: "Verify your business to start posting",
          body: "Businesses must be verified (license + insurance) before posting jobs or being charged. Complete verification on the Team page.",
        };
    }
  })();

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      {/* Standard authed top bar built on the DashboardHeader chrome
          (glass-header, sticky, HelprMark left, NotificationPanel right) so
          /business/* shares the app's nav instead of a bespoke one. The
          business-name badge lives inline on the right, before the bell, to
          keep the current workspace identifiable at a glance. */}
      <header className="glass-header sticky top-0 z-50">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-5 lg:px-8 justify-between">
          <HelprMark to="/dashboard" size="md" />
          <div className="flex items-center gap-2 min-w-0">
            {business && (
              <span className="inline-flex items-center gap-1.5 px-2 h-7 rounded-ds-md bg-primary/10 text-primary text-ds-11 font-semibold min-w-0">
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{business.business_name}</span>
              </span>
            )}
            <NotificationPanel />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 lg:px-8 py-6">
        {/* Back affordance matches every other in-app header: the canonical
            frosted-glass round BackButton sits to the LEFT of the title block
            (chevron as lead-in), vertically centered against the whole
            eyebrow/title/meta stack — identical to PageHeader. */}
        <div className="flex items-center gap-3 mb-6">
          <div className="shrink-0">
            <BackButton />
          </div>
          <div className="flex flex-col leading-none min-w-0">
            {/* Eyebrow render intentionally removed (2026-07-25 app-wide
                eyebrow-removal decision) — same treatment as PageHeader. The
                `eyebrow` prop is kept in Props for call-site compatibility but
                no longer paints. */}
            <h1 className="text-page-title leading-tight mt-1">{title}</h1>
            {meta && (
              <p className="font-serif italic mt-1 text-[0.82rem]" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                {meta}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
          <nav aria-label="Business navigation" className="md:sticky md:top-20 md:self-start">
            <div className="rounded-ds-md liquid-glass p-2 flex md:flex-col gap-1 overflow-x-auto">
              {NAV.map(({ to, label, icon: Icon }) => {
                const active = location.pathname === to;
                return (
                  <NavLink
                    key={to}
                    to={to}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2 px-3 h-11 rounded-ds-sm text-ds-13 font-medium whitespace-nowrap transition-all duration-200",
                      active
                        ? "btn-grad-primary squircle border border-[hsl(66_24%_20%)] !text-[hsl(var(--parchment))] [&_svg]:!text-[hsl(var(--parchment))]"
                        : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                    )}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {label}
                  </NavLink>
                );
              })}
            </div>
          </nav>

          <div className="min-w-0">
            {showVerificationBanner && verificationCopy && (
              <div
                role="status"
                className="rounded-ds-md liquid-glass p-4 mb-5 flex items-start gap-3 border"
                style={{ borderColor: "hsl(var(--burnt-sienna) / 0.35)" }}
              >
                <ShieldAlert
                  className="w-5 h-5 shrink-0 mt-0.5"
                  style={{ color: "hsl(var(--burnt-sienna))" }}
                  aria-hidden
                />
                <div className="flex-1 min-w-0">
                  <p
                    className="font-semibold text-ds-13"
                    style={{ color: "hsl(var(--foreground))" }}
                  >
                    {verificationCopy.title}
                  </p>
                  <p
                    className="text-ds-12 mt-0.5"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    {verificationCopy.body}
                  </p>
                  {location.pathname !== "/business/team" && (
                    <Link
                      to="/business/team"
                      className="inline-block mt-2 text-ds-12 font-semibold underline-offset-2 hover:underline"
                      style={{ color: "hsl(var(--burnt-sienna))" }}
                    >
                      Complete verification →
                    </Link>
                  )}
                </div>
              </div>
            )}
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BusinessLayout;
