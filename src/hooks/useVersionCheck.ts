import { useEffect, useState } from "react";
import { isNativePlatform } from "@/lib/nativeInit";
import { supabase } from "@/integrations/supabase/client";

/**
 * useVersionCheck
 *
 * Reads the native bundle build number (Capacitor `App.getInfo()` →
 * `build`) and compares against `MIN_SUPPORTED_BUILD`. When the
 * installed build is older than the minimum, returns
 * `forceUpdate: true` so the caller can render the `<ForceUpdate />`
 * full-screen blocker.
 *
 * Why a build number, not a semver string:
 *
 *   * `App.getInfo().build` is the iOS `CFBundleVersion` and the
 *     Android `versionCode` — both are monotonically-increasing
 *     integers, so a single numeric comparison works for both
 *     platforms.
 *   * Semver versions (`App.getInfo().version`) are user-facing and
 *     occasionally re-used across patches; the build number never is.
 *
 * Web is always treated as up-to-date — there is no installed binary
 * to force, and the user already has the latest code on every load.
 *
 * TODO(version-check): wire `MIN_SUPPORTED_BUILD` to a runtime source
 * so we can bump it without shipping a new build. Options:
 *
 *   1. A new `app_config` row in Supabase (`SELECT min_supported_build
 *      FROM app_config WHERE platform = $1`).
 *   2. A static JSON file served from the marketing domain
 *      (`https://louisianahelpr.com/app-config.json`) — no Supabase
 *      round-trip, cacheable on a CDN.
 *
 * Until then the constant defaults to `0` so the check never fires
 * in production; bumping it to a real value triggers the gate.
 */

/** Minimum CFBundleVersion / Android versionCode supported by this
 *  release. Bump as a one-line change when shipping a backend
 *  migration that breaks older binaries. Default `0` = check disabled. */
export const MIN_SUPPORTED_BUILD = 0;

/**
 * Pure parser — accepts the build string `App.getInfo()` returns
 * (`"127"`, `"3.0.4"`, etc.) and returns a numeric build code. iOS
 * sometimes ships a dotted CFBundleVersion (`"3.0.4"`); we use the
 * MAJOR segment as the comparison key in that case. Android always
 * returns an integer-as-string.
 */
export const parseBuild = (raw: string | undefined | null): number => {
  if (!raw) return 0;
  const trimmed = String(raw).trim();
  if (!trimmed) return 0;
  // Take the leading numeric run — handles "127", "127.0", "1.0.2", etc.
  const match = trimmed.match(/^(\d+)/);
  if (!match) return 0;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) ? n : 0;
};

interface VersionCheckResult {
  /** True when the binary is older than MIN_SUPPORTED_BUILD. */
  forceUpdate: boolean;
  /** Numeric build code currently installed (0 if unknown / web). */
  installedBuild: number;
  /** Build code we require (mirrored from `MIN_SUPPORTED_BUILD`). */
  minSupportedBuild: number;
}

export const useVersionCheck = (): VersionCheckResult => {
  const [installedBuild, setInstalledBuild] = useState<number>(0);
  // Read the live minimum from platform_settings so the bar can be
  // raised without shipping a binary. Falls back to the in-bundle
  // MIN_SUPPORTED_BUILD constant when the DB call hasn't returned yet
  // or the column doesn't exist (migration not deployed). The DB
  // value, if any, takes precedence — that's the whole point.
  const [dbMin, setDbMin] = useState<number | null>(null);

  useEffect(() => {
    if (!isNativePlatform) return;
    let cancelled = false;
    (async () => {
      try {
        // Dynamic import keeps the @capacitor/app chunk off the
        // critical-path bundle on web. We don't import the module at
        // all if we never run this effect.
        const { App } = await import("@capacitor/app");
        const info = await App.getInfo();
        if (cancelled) return;
        setInstalledBuild(parseBuild(info.build));
      } catch {
        // Plugin not bridged or info unavailable — treat as
        // up-to-date so we don't lock users out on a bad lookup.
        if (!cancelled) setInstalledBuild(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await (supabase.from as any)("platform_settings")
          .select("min_supported_build")
          .limit(1)
          .maybeSingle();
        if (cancelled) return;
        // 42703 = undefined column → migration not deployed yet; just
        // fall back silently to the bundle constant. The PGRST116
        // "no rows" code is also a no-op.
        if (error) return;
        const v = typeof data?.min_supported_build === "number" ? data.min_supported_build : null;
        if (v !== null && Number.isFinite(v)) setDbMin(v);
      } catch {
        /* network errors are fine — local fallback continues to work */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const effectiveMin = dbMin ?? MIN_SUPPORTED_BUILD;
  // Disabled when effectiveMin is 0 (the default) so this hook is safe
  // to wire in advance of a real minimum being set.
  const forceUpdate =
    effectiveMin > 0 &&
    installedBuild > 0 &&
    installedBuild < effectiveMin;

  return { forceUpdate, installedBuild, minSupportedBuild: effectiveMin };
};
