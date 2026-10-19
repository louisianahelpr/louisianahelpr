import { useQueryClient } from "@tanstack/react-query";
import { listingRefExpired } from "@/lib/rentals/listings";

/**
 * A listing photo ref lasts 1-2 hours (20261019071203). When an <img> fails
 * because its ref expired (a page left open past the hour), refetch the read
 * that minted it, so the gallery gets fresh refs instead of staying broken
 * (lead review of Q2211 #6). A failure with a still-valid ref (a removed or
 * hidden listing) refetches nothing.
 */
export function useRefreshOnExpiredRef(queryKeys: readonly (readonly unknown[])[]): (ref: string) => void {
  const qc = useQueryClient();
  return (ref: string) => {
    if (!listingRefExpired(ref)) return;
    for (const queryKey of queryKeys) void qc.invalidateQueries({ queryKey });
  };
}
