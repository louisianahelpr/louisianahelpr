/**
 * Per-route status bar style. Drop into any page that has a non-cream
 * background (e.g. dark hero, full-bleed image header).
 *
 *   useStatusBar("dark");   // light text/icons on dark bg
 *   useStatusBar("light");  // dark text/icons on light bg (default)
 */
import { useEffect } from "react";
import { setStatusBarStyle } from "@/lib/nativeInit";

export function useStatusBar(style: "light" | "dark") {
  useEffect(() => {
    setStatusBarStyle(style);
    // restore default on unmount
    return () => {
      setStatusBarStyle("light");
    };
  }, [style]);
}
