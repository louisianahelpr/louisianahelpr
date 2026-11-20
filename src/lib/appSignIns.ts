import { useEffect } from "react";
import { loadModule } from "@/lib/loadModule";
import { report } from "@/lib/errorLogger";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { isNativePlatform } from "@/lib/nativeInit";

/**
 * App sign-ins (owner 2026-11-20: "add an app download feature ... and do your best to say which people it came
 * from"). Apple and Google never say who downloaded the app, so the native app records who SIGNS IN on it:
 * record_app_open (migration 20261120150247) keeps each member's first and latest native-app sign-in, the platform
 * and the app version, for the admin "App sign-ins this week" card. The web app never calls it.
 *
 * Called when a signed-in member opens the app (cold launch or sign-in) and when the app comes back to the front.
 * The server writes at most once an hour per member, so the calls are cheap. Best-effort: a failure is reported
 * and never blocks anything.
 */

// Loaded, not imported: SessionManager is on the boot path.
const supabaseClient = () => loadModule(() => import("@/integrations/supabase/client"));
const capacitorAppModule = () => loadModule(() => import("@capacitor/app"));

/** The native platform, or null on the web (and for anything that is not iOS or Android). */
export function nativeAppPlatform(): "ios" | "android" | null {
  if (!isNativePlatform) return null;
  const raw = (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.();
  return raw === "ios" || raw === "android" ? raw : null;
}

/** The app's version string (Capacitor App.getInfo().version), or null when it cannot be read or looks odd. */
async function appVersion(): Promise<string | null> {
  try {
    const m = await capacitorAppModule();
    if (!m) return null;
    const { App } = m;
    const info = await App.getInfo();
    const v = typeof info?.version === "string" ? info.version.trim() : "";
    return /^[0-9A-Za-z.+-]{1,40}$/.test(v) ? v : null;
  } catch (e) {
    console.warn("[app-sign-ins] could not read the app version", e);
    return null;
  }
}

/** Record this member's app sign-in. Resolves; never rejects. A no-op on the web. */
export async function recordAppOpen(): Promise<void> {
  const platform = nativeAppPlatform();
  if (!platform) return;
  try {
    const version = await appVersion();
    const m = await supabaseClient();
    if (!m) return; // a recovery reload is under way; the next launch tries again
    const { error } = await m.supabase.rpc("record_app_open", { p_platform: platform, p_app_version: version ?? undefined });
    if (error) {
      // Before the email is confirmed every write is refused (42501 "email_unconfirmed"): expected, quiet.
      if (/^\s*email_unconfirmed\b/.test(String(error.message ?? ""))) return;
      // PGRST202: not deployed yet (db-deploy lag after merge).
      if (isMissingRpcNamed(error, "record_app_open")) return;
      report(error, { tags: { source: "app-sign-ins" } });
    }
  } catch (e) {
    report(e, { tags: { source: "app-sign-ins" } });
  }
}

/** Mounted once in SessionManager: records the app sign-in on launch / sign-in, and again on each return to the app. */
export function useRecordAppOpen(userId: string | undefined) {
  useEffect(() => {
    if (!userId || !nativeAppPlatform()) return;
    void recordAppOpen();
    let cancelled = false;
    let remove: (() => void) | null = null;
    void (async () => {
      try {
        const m = await capacitorAppModule();
        if (!m || cancelled) return;
        const { App } = m;
        const handle = await App.addListener("resume", () => void recordAppOpen());
        if (cancelled) void handle.remove();
        else remove = () => void handle.remove();
      } catch (e) {
        report(e, { tags: { source: "app-sign-ins" } });
      }
    })();
    return () => {
      cancelled = true;
      remove?.();
    };
  }, [userId]);
}
