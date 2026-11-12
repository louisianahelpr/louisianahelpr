/**
 * S2-041 (Shops audit 2): Edit my shop has sections that save on their own (pickup address, questions, the daily
 * limit) beside the main "Save my shop". Each section reports here whether it has unsaved edits, so the page can warn
 * before the main save takes the owner away (or the tab closes) and their other edits are lost. Without a provider
 * (the section used elsewhere) reporting does nothing.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type Report = (name: string, dirty: boolean) => void;
const UnsavedContext = createContext<Report | null>(null);

export function UnsavedSectionsProvider({ onChange, children }: { onChange: (dirty: string[]) => void; children: ReactNode }) {
  const [dirty, setDirty] = useState<string[]>([]);
  const report = useCallback<Report>((name, isDirty) => {
    setDirty((d) => (isDirty ? (d.includes(name) ? d : [...d, name]) : d.filter((x) => x !== name)));
  }, []);
  useEffect(() => onChange(dirty), [dirty, onChange]);
  const value = useMemo(() => report, [report]);
  return <UnsavedContext.Provider value={value}>{children}</UnsavedContext.Provider>;
}

/** Tells the page this section has (or no longer has) unsaved edits; clears itself when the section leaves. */
export function useReportUnsaved(name: string, dirty: boolean): void {
  const report = useContext(UnsavedContext);
  useEffect(() => {
    report?.(name, dirty);
  }, [report, name, dirty]);
  useEffect(() => () => report?.(name, false), [report, name]);
}
