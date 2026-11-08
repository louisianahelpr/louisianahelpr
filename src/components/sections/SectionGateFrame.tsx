import { Skeleton } from "@/components/ui/skeleton";
import { SectionScreen } from "./SectionScreen";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { sectionByKey, type SectionKey } from "./sectionsConfig";

/**
 * A section's frame while its hidden switch's answer loads (Shops, Homes; Declutter's skeleton is the same frame
 * with bones). It draws EXACTLY the settled section header: the section's own title with no back arrow, the tabs'
 * place, no "Search all sections" field (Browse, where the section opens, draws its own search).
 *
 * Owner, 2026-10-28, desktop /shops hard reload: "it shows a back arrow to the left of Shops then goes away once
 * settled". The gates used to hold AppPage (a sub-screen frame: back arrow + title) while the switch loaded, so the
 * desktop bar read "<- Shops" for ~400ms, then "Shops". Guard: src/test/sectionLoadingHeaderIsSettled.test.tsx.
 */
export function SectionGateFrame({ section, label }: { section: SectionKey; label: string }) {
  const { label: title } = sectionByKey(section);
  const desktop = useIsWebDesktop();
  // Phone (owner 11-08, the Vinted header): the bar's search bone; the tabs moved to "My …" under the photo.
  return (
    <SectionScreen section={section} title={title} globalSearch={false}
      search={desktop ? undefined : <Skeleton className="h-11 w-full rounded-full" aria-hidden />}
      tabs={desktop ? <Skeleton className="h-11 w-full rounded-ds-md" aria-hidden /> : undefined}>
      <p role="status" className="sr-only">
        {label}
      </p>
    </SectionScreen>
  );
}
