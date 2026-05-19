import { AlertTriangle, RotateCw } from "lucide-react";

interface ProfileSectionErrorProps {
  /** Name of the sub-section that failed, e.g. "Saved Helprs". */
  section: string;
  /** Retries just this sub-section's load. */
  onRetry: () => void;
}

/**
 * ProfileSectionError — a SMALL inline error scoped to a single Profile
 * sub-section.
 *
 * The Profile landing loads its hero stats, review preview and job lists
 * as independent sub-loaders. When one fails it must NOT imply the whole
 * profile failed — the core profile (name, avatar) loaded fine. This is a
 * single restrained row ("Couldn't load X — retry"), not a page-level
 * banner, so a partial failure reads as recoverable, not catastrophic.
 */
export function ProfileSectionError({ section, onRetry }: ProfileSectionErrorProps) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-ds-md border border-destructive/20 bg-destructive/5 px-3 py-2"
    >
      <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" strokeWidth={2.25} />
      <p className="flex-1 min-w-0 text-ds-11 text-foreground leading-snug">
        Couldn&apos;t load {section}.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 inline-flex items-center gap-1 text-ds-11 font-semibold text-destructive active:opacity-70 transition-opacity"
      >
        <RotateCw className="w-3 h-3" strokeWidth={2.5} />
        Retry
      </button>
    </div>
  );
}

export default ProfileSectionError;
