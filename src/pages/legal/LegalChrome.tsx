import { useContext, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ListChecks } from "lucide-react";
import { PolicySearchContext } from "@/components/policy/CollapsedPolicy";

// While a policy search is active, editorial chrome (the TLDR summary,
// the privacy callout, the "contact support" footer) is noise — it isn't
// a search result. These helpers collapse it so the results read as a
// tight list of matching sections.
export const HideOnSearch = ({ children }: { children: ReactNode }) => {
  const query = useContext(PolicySearchContext);
  return query.trim() ? null : <>{children}</>;
};

export const TldrCard = ({
  items,
  updated,
}: {
  items: string[];
  /** e.g. "Jun 2026" — rendered right of the title on this card's header row. */
  updated?: string;
}) => {
  const query = useContext(PolicySearchContext);
  if (query.trim()) return null;
  return (
  <div
    className="rounded-2xl p-5 space-y-3"
    style={{
      // Bumped contrast vs the cream PolicySection surface below so
      // the TLDR reads as a discrete summary card, not another row.
      // Slightly tinted bark backdrop + inset highlight + bottom shadow
      // gives the card a soft lift over the page.
      background: "hsl(var(--bark) / 0.10)",
      border: "1px solid hsl(var(--bark) / 0.28)",
      boxShadow:
        "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
        "0 1px 2px hsl(var(--olivewood) / 0.06), " +
        "0 8px 18px -8px hsl(var(--olivewood) / 0.12)",
    }}
  >
    {/* Title left, revision date right (owner). The date was a stray
        left-aligned line under the last policy card and before that it sat
        beside the page title, where it competed with the page name. On this
        row it rides along with the summary a reader actually starts on, and it
        is the one place it appears — see PolicyFooter's note below. */}
    <div className="flex items-center gap-2">
      <ListChecks className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} />
      <span className="text-ds-13 font-sans font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
        The short version
      </span>
      {updated && (
        <span
          className="ml-auto shrink-0 text-ds-11 font-sans tabular-nums"
          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
        >
          Updated {updated}
        </span>
      )}
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

// Footer card closing every policy tab: just the support link. The revision
// date used to sit on the right of this row, but the page header already shows
// "Updated <month>" beside the title, so it stated the same fact twice on one
// screen.
export const PolicyFooter = () => (
  <div
    data-print-hide
    className="rounded-2xl px-4 py-3 flex items-center justify-between gap-3"
    style={{
      background: "hsl(var(--bark) / 0.05)",
      border: "1px solid hsl(var(--bark) / 0.16)",
    }}
  >
    <p className="text-ds-13 font-sans" style={{ color: "hsl(var(--ink-deep))" }}>
      Questions?{" "}
      {/* /support, not /profile?tab=support: the legal pages are public, so
          this link is followed by logged-OUT visitors far more often than by
          signed-in ones, and the Profile tab forces a sign-in they may not
          have. /support renders the same form for both. */}
      <Link to="/support" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>
        Contact support
      </Link>
    </p>
  </div>
);
