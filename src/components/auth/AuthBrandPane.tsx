import HelprMark from "@/components/HelprMark";

/**
 * Desktop-only (lg+) brand mark that sits above the auth form column.
 * Intentionally minimal — just the H emblem — so the form dominates the
 * page and the desktop layout reads simple + premium. The wordmark and
 * tagline used to live here; both were removed at the user's request so
 * a single brand touch anchors the top without adding text noise.
 * Skipped entirely on mobile (the form's own header carries the mark).
 */
export function AuthBrandPane() {
  return (
    <div className="w-full flex justify-center">
      <HelprMark to={null} size="lg" emblemOnly />
    </div>
  );
}
