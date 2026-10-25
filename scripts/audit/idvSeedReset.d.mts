export function needsIdvSeedReset(
  current: { is_seed?: boolean | null; idv_status?: string | null } | null | undefined,
  wantedProfile: { idv_status?: string } | null | undefined,
): boolean;
export function resetSeedIdv(userId: string, rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>): Promise<void>;
