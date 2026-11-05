export function isFaceIdIphone(name: string): boolean;
export function pickSimulator(
  list: { runtimes?: unknown[]; devices?: Record<string, unknown[]> },
  sdkVersion: string,
): { udid?: string; create?: { deviceType: string; runtime: string }; runtime?: string; error?: string };
