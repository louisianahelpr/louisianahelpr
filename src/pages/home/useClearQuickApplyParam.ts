import { useCallback } from "react";
import type { SetURLSearchParams } from "react-router-dom";

/**
 * Jobs > Browse (Dashboard.tsx): drop `?quickApply` once the deep link has resolved. Functional + replace:
 * it reads `prev` rather than the captured `searchParams`, and adds no history
 * entry. It is NOT a stable reference: react-router 7's `setSearchParams` is a
 * useCallback over `[navigate, searchParams]`, so this changes identity on
 * every query-string change. It never re-fires QuickApplyHandler's effect only
 * because that component reads `onHandled` through a ref, not a dep.
 */
export function useClearQuickApplyParam(setSearchParams: SetURLSearchParams) {
  return useCallback(() => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("quickApply");
      return next;
    }, { replace: true });
  }, [setSearchParams]);
}
