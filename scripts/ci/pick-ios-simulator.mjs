/**
 * Q1008 (11-05): pick the simulator the iOS biometric device check boots, from what the runner ACTUALLY has.
 *
 * Run 41987403403 picked its device by a regex over the device list's runtime keys (/iOS-26/ + /^iPhone 1[67]/) and
 * then sat in `simctl bootstatus -b` until the 45-minute job timeout. The device list can name a runtime that is not
 * usable (isAvailable false, or the runtime is missing from `simctl list runtimes`), and a key regex cannot tell. So:
 *   1. only runtimes `simctl list runtimes` reports as iOS and isAvailable;
 *   2. the one matching the selected Xcode's iphonesimulator SDK version first, else the newest available;
 *   3. an available Face ID iPhone already on that runtime (never an SE: Touch ID), else one to CREATE from the runtime's
 *      own supportedDeviceTypes (newest Face ID iPhone it supports).
 *
 *   xcrun simctl list -j runtimes devices devicetypes | node scripts/ci/pick-ios-simulator.mjs <sdkVersion>
 *
 * Prints `udid=<UDID>` or `create=<deviceTypeIdentifier> <runtimeIdentifier>`, then `runtime=<name>` on a second line.
 * Exits 1 (with the reason on stderr) when no available iOS runtime has a Face ID iPhone: nothing to boot is a red.
 * Guard: src/test/iosBiometricDeviceCheckIsSafe.test.ts (the picker cases).
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** A Face ID iPhone: the X line and every numbered iPhone from 11 on (16e too). The SE line (Touch ID) and the 8 and
 * older never match: "SE" and a single digit are not in the pattern. */
export const isFaceIdIphone = (name) => /^iPhone (X|1[1-9]|[2-9]\d)(?!\d)/.test(name);

const versionKey = (v) => String(v ?? "").split(".").map((n) => Number(n) || 0);
const newer = (a, b) => {
  const x = versionKey(a), y = versionKey(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};
/** Newest model first: the trailing generation number, then the name (Pro Max after Pro after plain). */
const byModel = (a, b) => (Number(/\d+/.exec(b.name)?.[0] ?? 0) - Number(/\d+/.exec(a.name)?.[0] ?? 0)) || b.name.localeCompare(a.name);

/**
 * @param {{ runtimes?: any[]; devices?: Record<string, any[]> }} list `simctl list -j runtimes devices devicetypes`
 * @param {string} sdkVersion e.g. "26.0" (`xcrun --sdk iphonesimulator --show-sdk-version`)
 */
export function pickSimulator(list, sdkVersion) {
  const runtimes = (list.runtimes ?? []).filter((r) => r.isAvailable === true && (r.platform === "iOS" || /\.iOS-/.test(r.identifier ?? "")));
  if (runtimes.length === 0) return { error: "no available iOS simulator runtime is installed" };
  const sdkMajorMinor = versionKey(sdkVersion).slice(0, 2).join(".");
  const ordered = [...runtimes].sort((a, b) => {
    const am = versionKey(a.version).slice(0, 2).join(".") === sdkMajorMinor, bm = versionKey(b.version).slice(0, 2).join(".") === sdkMajorMinor;
    return am !== bm ? (am ? -1 : 1) : newer(b.version, a.version);
  });
  for (const rt of ordered) {
    const existing = (list.devices?.[rt.identifier] ?? []).filter((d) => d.isAvailable === true && isFaceIdIphone(d.name)).sort(byModel);
    if (existing.length) return { udid: existing[0].udid, runtime: rt.name };
    const types = (rt.supportedDeviceTypes ?? []).filter((t) => (t.productFamily ?? "iPhone") === "iPhone" && isFaceIdIphone(t.name)).sort(byModel);
    if (types.length) return { create: { deviceType: types[0].identifier, runtime: rt.identifier }, runtime: rt.name };
  }
  return { error: `no Face ID iPhone on any available iOS runtime (${runtimes.map((r) => r.name).join(", ")})` };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const picked = pickSimulator(JSON.parse(readFileSync(0, "utf8")), process.argv[2] ?? "");
  if (picked.error) {
    process.stderr.write(`pick-ios-simulator: ${picked.error}\n`);
    process.exit(1);
  }
  process.stdout.write(`${picked.udid ? `udid=${picked.udid}` : `create=${picked.create.deviceType} ${picked.create.runtime}`}\nruntime=${picked.runtime}\n`);
}
