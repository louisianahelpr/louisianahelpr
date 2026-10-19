// The admin's locally resolved job flags, moved out of AdminJobs.tsx
// (component size ratchet).
import { useState } from "react";
import { getResolvedFlags, saveResolvedFlags } from "./adminJobsHelpers";

export function useResolvedFlags() {
  const [resolvedFlags, setResolvedFlags] = useState<Set<string>>(getResolvedFlags());

  const markFlagResolved = (jobId: string) => {
    const next = new Set(resolvedFlags);
    next.add(jobId);
    setResolvedFlags(next);
    saveResolvedFlags(next);
  };

  const reopenFlag = (jobId: string) => {
    const next = new Set(resolvedFlags);
    next.delete(jobId);
    setResolvedFlags(next);
    saveResolvedFlags(next);
  };

  return { resolvedFlags, markFlagResolved, reopenFlag };
}
