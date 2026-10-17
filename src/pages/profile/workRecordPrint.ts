import { isNativePlatform } from "@/lib/nativeInit";

// Why the Print button is conditional: `window.print()` is a NO-OP in every
// WKWebView-hosted context this record actually gets opened from. The shipped
// app has no `server.url` (capacitor.config.ts), so it runs the bundled dist/
// inside WKWebView, which ships no print dialog at all; an iOS home-screen
// install hits the same wall, because manifest.webmanifest declares
// `display: standalone` and standalone WebKit has no print UI either. The tap
// fired, nothing happened, and a helper standing in a leasing office concluded
// the app was broken. So detect those contexts and never render a control that
// promises a printer that isn't there — route them to the share path instead
// (which already works: Capacitor Share → OS share sheet) and say plainly where
// the printable copy lives.
const isIosStandalonePwa =
  typeof navigator !== "undefined" &&
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const canPrintDocument =
  !isNativePlatform &&
  !isIosStandalonePwa &&
  typeof window !== "undefined" &&
  typeof window.print === "function";
