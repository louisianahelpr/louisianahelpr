import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { isNativePlatform } from "@/lib/nativeInit";
import { installStaleClientWatch, onRouteChange } from "@/lib/staleClient";

/**
 * Web only: keeps an open tab on the deployed build (src/lib/staleClient.ts).
 * Installs the focus / visibility / 42501 checks once, and hands every in-app
 * navigation to onRouteChange, which is where a pending newer deploy lands:
 * a navigation is the one moment a reload never throws away a half-typed form.
 * Native bundles live inside the binary; ForceUpdateGate covers them.
 */
export default function StaleClientWatch() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (import.meta.env.PROD && !isNativePlatform) installStaleClientWatch();
  }, []);
  useEffect(() => {
    if (import.meta.env.PROD && !isNativePlatform) onRouteChange();
  }, [pathname]);
  return null;
}
