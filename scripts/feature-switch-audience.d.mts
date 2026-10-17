export const PROBE_EMAIL: string;
export const REGISTRY_FILE: string;
export function registryKeysFromSource(src: string): string[] | null;
export function readRegistryKeys(file?: string): string[] | null;
export function judge(r: {
  registry: string[] | null;
  switches: { key: string; audience: string }[] | null;
  probe: Record<string, unknown>;
  tester: Record<string, unknown>;
  anon: Record<string, unknown>;
  probeIsTester: boolean | null;
}): string[];
