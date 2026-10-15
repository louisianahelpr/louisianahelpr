import { ShieldAlert } from "lucide-react";
import { LICENSE_WARNINGS } from "./detailsSectionConstants";

/**
 * T2 (owner 2026-10-14): on a category where Louisiana (or federal law)
 * requires a license or certificate at any price, a plain-words heads-up sits
 * right above "Who can apply?". A warning, never a block: the poster can still
 * leave the job open to anyone. Sources: LICENSE_WARNINGS.
 */
export function LicenseWarning({ category }: { category: string }) {
  const text = LICENSE_WARNINGS[category];
  if (!text) return null;
  return (
    <div
      role="note"
      data-testid="license-warning"
      className="flex items-start gap-2 rounded-ds-md p-3 text-ds-12 font-sans leading-snug"
      style={{
        background: "hsl(var(--burnt-sienna) / 0.08)",
        border: "0.5px solid hsl(var(--burnt-sienna) / 0.28)",
        color: "hsl(var(--ink-deep))",
      }}
    >
      <ShieldAlert className="w-4 h-4 shrink-0 mt-px" style={{ color: "hsl(var(--burnt-sienna))" }} aria-hidden />
      <span>{text}</span>
    </div>
  );
}
