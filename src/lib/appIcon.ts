// Alternate App Icon switching — thin wrapper around
// @capacitor-community/native-app-icon.
//
// iOS supports per-app alternate icons via UIApplication's
// setAlternateIconName API. The user can switch between the primary
// AppIcon (the ornate Garden District H) and "AppIcon-Fleur" (the
// notification-thumbnail friendly variant — see public/app-icon-alt.svg).
//
// Android handles alt icons via activity-alias and is not currently
// supported by this wrapper — Android users always see the primary.
//
// All calls are wrapped in try/catch and no-op on web / unsupported
// platforms so callers don't have to special-case anything.
//
// NOTE: this module is dormant until cowork wires the alt icon PNGs
// into Xcode and re-adds the CFBundleAlternateIcons keys to Info.plist
// (see commit d6be7b4). Until then, isAppIconSwitchingAvailable()
// returns true on iOS but setAppIcon will throw at the native layer.
// The feature flag in src/lib/featureFlags.ts gates the UI.

import { Capacitor } from "@capacitor/core";

export type AppIconName = "default" | "fleur";

// iOS expects the AppIcon set name as declared in Info.plist's
// CFBundleAlternateIcons dictionary. `null` resets to the primary
// CFBundleIcons.CFBundlePrimaryIcon.
const ICON_NAME_MAP: Record<AppIconName, string | null> = {
  default: null,
  fleur: "AppIcon-Fleur",
};

const PLUGIN_NAME = "NativeAppIcon";

interface NativeAppIconPlugin {
  getName(): Promise<{ name: string | null }>;
  changeIcon(options: { name: string | null }): Promise<void>;
  reset(): Promise<void>;
  supportsAlternateIcons(): Promise<{ value: boolean }>;
}

function getPlugin(): NativeAppIconPlugin | null {
  try {
    if (!Capacitor.isNativePlatform()) return null;
    if (!Capacitor.isPluginAvailable(PLUGIN_NAME)) return null;
    // Lazy-resolve via the Capacitor.Plugins global rather than a
    // static import so the missing plugin (until cowork installs it
    // on Mac) doesn't break the web bundle.
    const plugins = (Capacitor as unknown as { Plugins?: Record<string, unknown> }).Plugins;
    const plugin = plugins?.[PLUGIN_NAME] as NativeAppIconPlugin | undefined;
    return plugin ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns true only when alt-icon switching is actually usable:
 *   · running natively (not the browser)
 *   · on iOS specifically — Android uses activity-alias which isn't
 *     wired up here
 *   · the @capacitor-community/native-app-icon plugin is registered
 */
export function isAppIconSwitchingAvailable(): boolean {
  try {
    if (!Capacitor.isNativePlatform()) return false;
    if (Capacitor.getPlatform() !== "ios") return false;
    return Capacitor.isPluginAvailable(PLUGIN_NAME);
  } catch {
    return false;
  }
}

/**
 * Read the currently active app icon. Returns 'default' on web, on
 * Android, when the plugin is missing, or if the native call errors.
 */
export async function getAppIcon(): Promise<AppIconName> {
  const plugin = getPlugin();
  if (!plugin) return "default";
  try {
    const { name } = await plugin.getName();
    if (!name) return "default";
    if (name === ICON_NAME_MAP.fleur) return "fleur";
    return "default";
  } catch {
    return "default";
  }
}

/**
 * Switch the active app icon. No-ops on web / Android / when the
 * plugin is missing. Silently swallows native errors — the iOS API
 * occasionally throws transient errors (e.g. when called while the
 * app is backgrounding) that the user shouldn't see.
 *
 * iOS shows a system-level "You have changed the icon for [App]"
 * alert on switch; that UX is owned by Apple and can't be suppressed.
 */
export async function setAppIcon(name: AppIconName): Promise<void> {
  const plugin = getPlugin();
  if (!plugin) return;
  try {
    const target = ICON_NAME_MAP[name];
    await plugin.changeIcon({ name: target });
  } catch {
    // Swallow — caller can re-read state with getAppIcon() to see
    // whether the change took effect.
  }
}
