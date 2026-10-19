import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { BROWSE } from "./sectionsConfig";

export interface SectionTabDef<T extends string> {
  value: T;
  label: string;
  count?: number;
}

/**
 * The section's tab, read from `?tab=`. EVERY SECTION OPENS ON BROWSE (owner,
 * 2026-10-19): no tab, or an unknown one, is Browse. Changing tab drops the
 * other tab's `?status=` filter so a stale filter never hides a list.
 */
export function useSectionTab<T extends string>(valid: readonly T[]) {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab = (raw && (valid as readonly string[]).includes(raw) ? raw : BROWSE) as T | typeof BROWSE;
  const setTab = useCallback(
    (next: string) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === BROWSE) p.delete("tab");
          else p.set("tab", next);
          p.delete("status");
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return [tab, setTab] as const;
}

/**
 * The top segmented toggle of a section. BROWSE IS ALWAYS LEFTMOST: it is not
 * a prop, so no caller can move it (guard: src/test/sectionDashboards.test.tsx).
 */
export function SectionTabs<T extends string>({
  label,
  tabs,
  value,
  onChange,
}: {
  label: string;
  tabs: readonly SectionTabDef<T>[];
  value: T | typeof BROWSE;
  onChange: (v: string) => void;
}) {
  const options = [{ value: BROWSE as string, label: "Browse" }, ...tabs.map((t) => ({ value: t.value as string, label: t.label, count: t.count, countTone: "attention" as const }))];
  return (
    <div data-testid="section-tabs">
    <SegmentedControl
      ariaLabel={label}
      semantics="tab"
      options={options}
      value={value}
      onChange={onChange}
      className="w-full"
      optionClassName="px-2 text-ds-13 min-[360px]:text-ds-14 whitespace-nowrap"
    />
    </div>
  );
}
