import { useContext, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PolicySearchContext } from "@/components/policy/CollapsedPolicy";

/**
 * The "General guidance only" tax row in the Terms and the Community Rules.
 * It said "Consult a CPA for advice specific to your situation." Audit
 * 2026-10-28 P5-11: we point to the published source instead of a
 * professional, the IRS's own Self-Employed Individuals Tax Center (checked
 * live 2026-10-28, HTTP 200). Guard: src/test/noProfessionalReferrals.test.ts.
 */
export const TaxGuidanceLine = () => (
  <p>
    Tax laws change. The IRS explains how self-employment income is taxed in its{" "}
    <a
      href="https://www.irs.gov/businesses/small-businesses-self-employed/self-employed-individuals-tax-center"
      target="_blank"
      rel="noopener noreferrer"
      className="link-standard"
    >
      Self-Employed Individuals Tax Center
    </a>
    .
  </p>
);

// While a policy search is active, editorial chrome (the TLDR summary,
// the privacy callout, the "contact support" footer) is noise — it isn't
// a search result. These helpers collapse it so the results read as a
// tight list of matching sections.
export const HideOnSearch = ({ children }: { children: ReactNode }) => {
  const query = useContext(PolicySearchContext);
  return query.trim() ? null : <>{children}</>;
};

export const TldrCard = ({ items }: { items: string[] }) => {
  const query = useContext(PolicySearchContext);
  if (query.trim()) return null;
  return (
  // Spec v2 rebuild (audit 2026-10-21): the one card (20px radius, 1px
  // --line border, no inset highlight or second shadow), same as the
  // policy sections under it.
  <div className="rounded-[20px] border border-border bg-card p-5 space-y-3">
    <div className="flex items-center gap-2">
      <ListChecks className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} />
      <span className="text-ds-13 font-sans font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
        The short version
      </span>
    </div>
    <ul className="space-y-1.5 text-ds-13 font-sans" style={{ color: "hsl(var(--ink-deep))" }}>
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5 leading-relaxed">
          <span
            className="shrink-0 w-1.5 h-1.5 rounded-full mt-[8px]"
            style={{ background: "hsl(var(--bark))" }}
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  </div>
  );
};

// Footer card closing every policy tab: the support link, and the revision date
// back on its right (owner).
//
// The date lived here once and was pulled because the page header showed
// "Updated <month>" beside the title, stating the same fact twice on one
// screen. The header no longer carries it, so this is the single instance
// again — and it pairs naturally with the support link: when this last changed,
// and who to ask about it.
//
// Also used by the Help Center (src/pages/info/HelpCenter.tsx), which closes its FAQ
// with the same "here is who to ask" card — owner: "help center contact support
// should be more similar to legals". Shared rather than restyled to match,
// because two copies of one card is exactly how they drift apart again.
//
// TWO MODES, ONE CARD:
//
//   * default — a text link. Right for a POLICY tab, where reaching a human is
//     a footnote under the thing the reader came for, and where the right-hand
//     slot carries the revision date (`updated`).
//   * `cta` — the shared glossy `Button variant="primary"`. Right for the HELP
//     CENTER, where reaching a human is the page's one primary action and there
//     is no revision date to balance it against. /help shipped with
//     `grep -c btn-grad-primary` = 0 in its body: the only route to a person on
//     the whole screen was an inline link inside a flat card, which is not what
//     this app's primary actions look like anywhere else.
//
// It is a prop rather than a second component precisely so the two cannot drift
// — same surface, same border, same destination, one decision about emphasis.
export const PolicyFooter = ({ updated, cta = false }: { updated?: string; cta?: boolean }) => (
  <div
    data-print-hide
    className={
      cta
        ? "rounded-[20px] bg-muted px-4 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        : "rounded-[20px] bg-muted px-4 py-3 flex items-center justify-between gap-3"
    }
  >
    <p className="text-ds-13 font-sans" style={{ color: "hsl(var(--ink-deep))" }}>
      {cta ? (
        <>
          <span className="font-semibold">Still stuck?</span> A real person reads every message.
        </>
      ) : (
        <>
          Questions?{" "}
          {/* /support, not /profile?tab=support: the legal pages are public, so
              this link is followed by logged-OUT visitors far more often than by
              signed-in ones, and the Profile tab forces a sign-in they may not
              have. /support renders the same form for both. */}
          <Link to="/support" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>
            Contact support
          </Link>
        </>
      )}
    </p>
    {cta && (
      // `asChild` so the glossy Button IS the Link — one control, one tap
      // target, real routing. The gloss comes from `variant="primary"`
      // (btn-grad-primary in index.css); never hand-paint a `background`
      // shorthand over it, which silently resets the gradient (CLAUDE.md).
      <Button variant="primary" size="lg" className="shrink-0 rounded-full h-12 w-full sm:w-auto" asChild>
        <Link to="/support">Contact support</Link>
      </Button>
    )}
    {updated && (
      <span
        className="shrink-0 text-ds-11 font-sans tabular-nums"
        style={{ color: "hsl(var(--olivewood) / 0.8)" }}
      >
        Updated {updated}
      </span>
    )}
  </div>
);
