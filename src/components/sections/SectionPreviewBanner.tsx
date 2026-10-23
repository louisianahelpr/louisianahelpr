import { Eye } from "lucide-react";
import { useSectionPreview } from "./ExploreSwitcher";
import type { SectionKey } from "./sectionsConfig";

/**
 * "Coming soon – early preview" (owner, 2026-10-22): a tester opening a section that is not open to everyone yet
 * sees it is a preview, while every listing says "Coming soon" to everyone (ExploreSwitcher). Shown only when
 * useSectionIsPreview says so, which is never true for a member and never while that answer is loading or failed.
 * Its own component, so only a section screen asks (Home's SectionScreen never does).
 * Guard: src/test/exploreHeaderSteady.test.ts.
 */
export function SectionPreviewBanner({ section }: { section: SectionKey }) {
  const preview = useSectionPreview(section);
  if (!preview) return null;
  return (
    <p
      role="status"
      data-section-preview-banner=""
      className="flex items-center gap-2 rounded-2xl border px-3.5 py-2.5 text-ds-13 font-semibold"
      style={{ color: "hsl(var(--bark))", borderColor: "hsl(var(--bark) / 0.3)", backgroundColor: "hsl(var(--bark) / 0.06)" }}
    >
      <Eye className="h-4 w-4 shrink-0" aria-hidden />
      Coming soon – early preview
    </p>
  );
}
