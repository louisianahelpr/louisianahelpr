// Self-hosted OTA updates: the wiring half (iOS app only).
//
// Loaded by src/main.tsx with a dynamic import, only on native iOS, so the
// website never downloads this module or the plugin. The pure decisions live
// in ./otaManifest.ts (unit-tested). How it works and how to release:
// docs/OTA_UPDATES.md.
//
// Flow on cold start, and on resume at most every OTA_RESUME_THROTTLE_MS:
//   notifyAppReady()  -> tells the plugin this bundle booted. If a new bundle
//                        never gets here within appReadyTimeout, the plugin
//                        rolls back to the last good bundle on its own.
//   fetch manifest    -> HTTPS, our domain, no cache
//   parse + verify    -> shape, signature (fail closed), min native build, newer
//   download          -> per-file; the plugin hashes each file natively, reuses
//                        any file the store build already has, refuses a mismatch
//   next({ id })      -> applied on the NEXT cold start, never mid-session

import {
  OTA_MANIFEST_URL,
  decideOtaUpdate,
  parseOtaManifest,
  parseRunningBundle,
  toPluginManifest,
  verifyOtaManifest,
} from "./otaManifest";
import { raceVisibleDeadlineAbortable } from "../visibleDeadline";

export const OTA_RESUME_THROTTLE_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

let lastCheckAt = 0;
let checking = false;

async function checkForUpdate(): Promise<void> {
  if (checking) return;
  checking = true;
  lastCheckAt = Date.now();
  try {
    // The deadline counts only visible time (src/lib/visibleDeadline.ts): this check runs on
    // launch and resume, and a page frozen mid-read must not count as a timeout. A timeout
    // throws into the catch below, which leaves the current bundle running.
    const res = await raceVisibleDeadlineAbortable(
      (signal) => fetch(OTA_MANIFEST_URL, { cache: "no-store", signal, credentials: "omit" }),
      FETCH_TIMEOUT_MS,
      "[ota] manifest fetch timed out",
    );
    if (res.status === 404) return; // nothing published yet
    if (!res.ok) {
      console.warn("[ota] manifest fetch returned", res.status);
      return;
    }
    const raw: unknown = await res.json();

    const manifest = parseOtaManifest(raw);
    if (!manifest) {
      console.warn("[ota] manifest rejected: bad shape");
      return;
    }
    const verified = await verifyOtaManifest(manifest, globalThis.crypto?.subtle);
    if (!verified) {
      console.warn("[ota] manifest rejected: signature did not verify");
      return;
    }

    const [{ App }, { CapacitorUpdater }] = await Promise.all([
      import("@capacitor/app"),
      import("@capgo/capacitor-updater"),
    ]);
    const info = await App.getInfo();
    const { bundles } = await CapacitorUpdater.list();
    const decision = decideOtaUpdate(manifest, {
      runningBundle: parseRunningBundle(__OTA_BUNDLE__),
      nativeBuild: info.build,
      failedVersions: bundles.filter((b) => b.status === "error").map((b) => b.version),
    });
    if (!decision.install) return;

    // Already downloaded on an earlier check: just queue it again.
    const existing = bundles.find((b) => b.version === manifest.version && b.status === "success");
    const bundle =
      existing ??
      (await CapacitorUpdater.download({
        // Required by the plugin's bridge even in manifest mode, where each
        // file downloads from its own (signed, same-origin) url instead.
        url: OTA_MANIFEST_URL,
        version: manifest.version,
        manifest: toPluginManifest(manifest),
      }));
    await CapacitorUpdater.next({ id: bundle.id });
  } catch (err) {
    // A failed check leaves the current bundle running; the next start retries.
    console.warn("[ota] update check failed", err);
  } finally {
    checking = false;
  }
}

/** Call once per launch, after React has mounted. */
export async function initOta(): Promise<void> {
  try {
    const { CapacitorUpdater } = await import("@capgo/capacitor-updater");
    await CapacitorUpdater.notifyAppReady();
  } catch (err) {
    // Without notifyAppReady the plugin rolls this bundle back, which is the
    // safe outcome; log so a broken bridge shows up in Sentry breadcrumbs.
    console.warn("[ota] notifyAppReady failed", err);
    return;
  }
  void checkForUpdate();
  try {
    const { App } = await import("@capacitor/app");
    await App.addListener("resume", () => {
      if (Date.now() - lastCheckAt >= OTA_RESUME_THROTTLE_MS) void checkForUpdate();
    });
  } catch (err) {
    console.warn("[ota] resume listener failed", err);
  }
}
