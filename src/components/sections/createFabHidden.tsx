import { useEffect, useSyncExternalStore } from "react";

/**
 * The floating create pill steps aside while the screen's empty state shows its own create button (owner via the lead,
 * 11-08: the action never appears twice). An empty state that offers the section's create mounts HideSectionCreateFab;
 * SectionCreateFab draws nothing while any such state is on screen. A count, not a flag, so two
 * empty states on one screen and their unmount order never leave the pill hidden. Guard: src/test/createFabStepsAside.test.tsx.
 */
let hiders = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

/** While mounted (and `active`), the section's floating create pill is hidden. */
function useHidesSectionCreateFab(active = true) {
  useEffect(() => {
    if (!active) return;
    hiders += 1;
    emit();
    return () => {
      hiders -= 1;
      emit();
    };
  }, [active]);
}

/** True while an empty state on screen shows its own create button. */
export function useSectionCreateFabHidden(): boolean {
  return useSyncExternalStore(subscribe, () => hiders > 0, () => false);
}

/** Drop-in for JSX: `<HideSectionCreateFab />` beside an empty state's own create button. */
export function HideSectionCreateFab({ active = true }: { active?: boolean }) {
  useHidesSectionCreateFab(active);
  return null;
}
