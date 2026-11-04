import { useNativePushSetup } from "@/lib/nativePush";

/**
 * The native push + deep-link setup, in its own chunk (Q2705/Q2706 boot cut, 11-04).
 *
 * useNativePushSetup is a no-op on the web, yet it sat in the boot path of every page (nativePush.ts and
 * what only it pulls in). SessionManager now mounts this component only in the native app, where the
 * chunk is read from the app bundle, so the web never downloads it before first paint.
 */
export default function NativePushSetup() {
  useNativePushSetup();
  return null;
}
