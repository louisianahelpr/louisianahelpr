import { Eye, X } from "lucide-react";
import { useImpersonation } from "@/hooks/useImpersonation";

/**
 * Sticky banner shown across the app when an admin is impersonating a
 * user via `?impersonate=<userId>`. Hidden when no impersonation is
 * active. Pair with `assertWritable()` at mutation call sites to
 * actually no-op the writes.
 */
const ImpersonationBanner = () => {
  const { active, targetName, exit } = useImpersonation();
  if (!active) return null;
  return (
    <div className="sticky top-0 z-[60] bg-accent text-accent-foreground border-b border-accent/40">
      <div className="container mx-auto flex items-center justify-between gap-3 px-4 h-10 text-ds-12">
        <div className="flex items-center gap-2 min-w-0">
          <Eye className="w-4 h-4 shrink-0" />
          <span className="truncate">
            <strong className="font-semibold">Viewing as</strong>{" "}
            {targetName ?? "loading…"} · Read-only impersonation
          </span>
        </div>
        <button
          onClick={exit}
          className="inline-flex items-center gap-1 px-2 h-7 rounded-ds-sm hover:bg-accent-foreground/10"
          aria-label="Exit impersonation"
        >
          <X className="w-3.5 h-3.5" /> Exit
        </button>
      </div>
    </div>
  );
};

export default ImpersonationBanner;
