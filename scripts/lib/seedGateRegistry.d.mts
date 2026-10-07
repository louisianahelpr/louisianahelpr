export interface SeedGateEntry {
  surface: string;
  object: string;
  via?: string;
}
export function parseSeedGateRegistry(src: string): SeedGateEntry[];
export function countSeedGateRegistryKeys(src: string): number;
export function discoverGateCallers(migrations: { name: string; sql: string }[], authority: string): Set<string>;
export function liveGateNeedle(entry: SeedGateEntry, flagKey: string): string;
