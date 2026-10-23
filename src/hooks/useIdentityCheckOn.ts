import { useFeatureStatus } from "@/hooks/useFeature";

/**
 * Is the ID check required and offered for this member? (owner ruling
 * 2026-10-23: OFF, "we will move to paypal"; switch `identity_check`, migration
 * 20261023213857.) FALSE while loading, on a read error and when signed out,
 * which is the owner's default: no "Verify your ID" prompt, step or gate shows.
 * The server holds the same rule (identity_check_exempt, helper_accept_missing).
 *
 * Every member-facing place that asks for, offers or promises an ID check reads
 * this (or identityCheckOn() from src/lib/identityCheckSwitch.ts, which
 * IdentityCheckHost keeps equal to it). Guard:
 * src/test/identityCheckOffEntryPoints.test.ts.
 */
export function useIdentityCheckOn(): boolean {
  return useIdentityCheckStatus().on;
}

/** The same answer plus whether it is IN yet (an entry link waits for it rather than being dropped). */
export function useIdentityCheckStatus(): { on: boolean; settled: boolean } {
  const { on, settled } = useFeatureStatus("identity_check");
  return { on, settled };
}
