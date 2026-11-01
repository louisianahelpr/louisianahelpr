import type { ReactNode } from "react";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";

/**
 * Renders its children only on the wide desktop website (the useIsWebDesktop
 * gate: not native, and matchMedia "(min-width: 900px)"). App.tsx wraps the
 * desktop rail and top bar in it, so a phone never fetches their lazy chunks:
 * a lazy chunk is fetched as soon as it RENDERS, even when it then returns
 * null, and on Slow 4G the rail's chunks (DesktopSidebarNav, adminRailBadges,
 * the top bar) started in the same window as Home's own (B85 lab, 11-01).
 *
 * No layout shift: the hook answers synchronously on the first render, so a
 * desktop load mounts them on the same frame as before. Resizing a phone-width
 * window to desktop width mounts them then (each component still checks the
 * same gate itself).
 *
 * Guard: src/test/phoneSkipsDesktopRailChunks.test.tsx.
 */
export function WebDesktopOnly({ children }: { children: ReactNode }) {
  return useIsWebDesktop() ? <>{children}</> : null;
}
