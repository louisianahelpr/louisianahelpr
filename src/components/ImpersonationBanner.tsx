/**
 * ImpersonationBanner — sticky top banner shown while an admin is
 * viewing the customer-facing app "as" another user. Triggered by the
 * useImpersonation hook (state lives in localStorage so it survives
 * navigation + reload).
 *
 * Mutations are gated client-side via the same hook; the banner is the
 * visible reminder. Clicking "Exit" clears the impersonation flag and
 * the user immediately sees their own data again.
 */
import { Eye, X } from "lucide-react";
import { useImpersonation } from "@/hooks/useImpersonation";

export const ImpersonationBanner = () => {
  const { impersonation, stop } = useImpersonation();
  if (!impersonation) return null;
  return (
    <div
      className="sticky top-0 z-50 flex items-center gap-2 px-3 sm:px-4 py-2 bg-warning text-warning-foreground shadow-sm"
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}
      role="status"
      aria-live="polite"
    >
      <Eye className="w-4 h-4 shrink-0" aria-hidden />
      <p className="text-ds-11 sm:text-ds-13 font-semibold flex-1 min-w-0 truncate">
        Viewing as <span className="underline underline-offset-2">{impersonation.userName}</span>
        <span className="ml-1 font-normal opacity-80">— read-only, no writes allowed</span>
      </p>
      <button
        type="button"
        onClick={stop}
        aria-label="Exit impersonation"
        className="shrink-0 inline-flex items-center gap-1 rounded-md bg-[hsl(var(--amber-ink)/0.15)] hover:bg-[hsl(var(--amber-ink)/0.25)] px-2 h-7 text-ds-11 font-semibold"
      >
        <X className="w-3 h-3" /> Exit
      </button>
    </div>
  );
};

export default ImpersonationBanner;
