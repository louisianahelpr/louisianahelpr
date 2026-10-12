export const PROBE_EMAIL: string;
export function judge(r: {
  switches: { key: string; audience: string }[] | null;
  probe: Record<string, unknown>;
  tester: Record<string, unknown>;
  anon: Record<string, unknown>;
  probeIsTester: boolean | null;
}): string[];
